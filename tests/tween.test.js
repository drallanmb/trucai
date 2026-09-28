'use strict';
// Testes do Truco.Tween (js/gfx/tween.js): node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const Tween = require('../js/gfx/tween.js');

function reset() {
  Tween.killAll();
  Tween.speed = 1;
  Tween.reducedMotion = false;
}

function step(seconds, fps = 60) {
  const dt = 1 / fps;
  for (let t = 0; t < seconds - 1e-9; t += dt) Tween.update(dt);
}

test('to interpola até o valor final e resolve a promessa', async () => {
  reset();
  const o = { x: 0, y: 10 };
  let resolved = false;
  const p = Tween.to(o, { x: 1, y: 0 }, { duration: 0.5, ease: 'linear' }).then(() => (resolved = true));
  step(0.25);
  assert.ok(Math.abs(o.x - 0.5) < 0.05, 'metade do caminho em x: ' + o.x);
  assert.ok(Math.abs(o.y - 5) < 0.5, 'metade do caminho em y: ' + o.y);
  step(0.3);
  await p;
  assert.equal(resolved, true);
  assert.equal(o.x, 1);
  assert.equal(o.y, 0);
  assert.equal(Tween.activeCount(), 0);
});

test('delay segura o início e captura o valor inicial só quando começa', async () => {
  reset();
  const o = { x: 0 };
  const p = Tween.to(o, { x: 10 }, { duration: 0.2, delay: 0.3, ease: 'linear' });
  step(0.2);
  assert.equal(o.x, 0);
  o.x = 5; // muda antes de começar: o tween parte de 5
  step(0.2);
  assert.ok(o.x > 5 && o.x < 10, 'partiu do valor atual: ' + o.x);
  step(0.2);
  await p;
  assert.equal(o.x, 10);
});

test('speed acelera o relógio global', async () => {
  reset();
  Tween.speed = 4;
  const o = { x: 0 };
  const p = Tween.to(o, { x: 1 }, { duration: 1 });
  step(0.26);
  await p;
  assert.equal(o.x, 1);
});

test('duração zero aplica na hora', async () => {
  reset();
  const o = { x: 0 };
  await Tween.to(o, { x: 3 }, { duration: 0 });
  assert.equal(o.x, 3);
});

test('novo tween nas mesmas propriedades substitui o anterior e a promessa antiga resolve', async () => {
  reset();
  const o = { x: 0, y: 0 };
  let firstDone = false;
  const first = Tween.to(o, { x: 1, y: 1 }, { duration: 1, ease: 'linear' }).then(() => (firstDone = true));
  step(0.2);
  const second = Tween.to(o, { x: -1 }, { duration: 0.2, ease: 'linear' });
  step(0.25);
  await second;
  assert.equal(o.x, -1, 'x é do segundo tween');
  step(1);
  await first;
  assert.equal(firstDone, true);
  assert.equal(o.y, 1, 'y continuou com o primeiro');
  assert.equal(o.x, -1, 'x não voltou para o primeiro');
});

test('kill com complete pula para o fim; sem complete congela', async () => {
  reset();
  const a = { v: 0 };
  const b = { v: 0 };
  const pa = Tween.to(a, { v: 1 }, { duration: 1 });
  const pb = Tween.to(b, { v: 1 }, { duration: 1 });
  step(0.1);
  const mid = b.v;
  Tween.kill(a, { complete: true });
  Tween.kill(b);
  await Promise.all([pa, pb]);
  assert.equal(a.v, 1);
  assert.equal(b.v, mid);
});

test('run chama fn com valor suavizado e termina em 1', async () => {
  reset();
  const seen = [];
  const p = Tween.run(0.3, (e, t) => seen.push([e, t]), { ease: 'inQuad' });
  step(0.4);
  await p;
  assert.ok(seen.length > 3);
  const last = seen[seen.length - 1];
  assert.deepEqual(last, [1, 1]);
  const mid = seen[Math.floor(seen.length / 2)];
  assert.ok(mid[0] < mid[1], 'inQuad fica abaixo do linear no meio');
});

test('delay() resolve depois do tempo pedido', async () => {
  reset();
  let done = false;
  const p = Tween.delay(0.5).then(() => (done = true));
  step(0.3);
  await Promise.resolve();
  assert.equal(done, false);
  step(0.3);
  await p;
  assert.equal(done, true);
});

test('reducedMotion encurta as durações', async () => {
  reset();
  Tween.reducedMotion = true;
  const o = { x: 0 };
  const p = Tween.to(o, { x: 1 }, { duration: 1, ease: 'linear' });
  step(0.65);
  await p;
  assert.equal(o.x, 1);
  Tween.reducedMotion = false;
});

test('erro dentro de um tween não trava os outros', async () => {
  reset();
  const origError = console.error;
  console.error = () => {};
  const o = { x: 0 };
  const bad = Tween.run(0.2, () => {
    throw new Error('falha');
  });
  const good = Tween.to(o, { x: 1 }, { duration: 0.2 });
  step(0.3);
  await Promise.all([bad, good]);
  console.error = origError;
  assert.equal(o.x, 1);
});

test('funções de suavização começam em 0 e terminam em 1', () => {
  for (const [name, fn] of Object.entries(Tween.ease)) {
    assert.ok(Math.abs(fn(0)) < 1e-9, name + '(0)');
    assert.ok(Math.abs(fn(1) - 1) < 1e-9, name + '(1)');
  }
});

test('guard resolve pelo limite quando a promessa não termina', async () => {
  const never = new Promise(() => {});
  const t0 = Date.now();
  await Tween.guard(never, 0.05);
  assert.ok(Date.now() - t0 >= 40);
});

test('exceção dentro de um tween vai para Truco.reportError (ou console.error sem ele) e a promessa resolve', async () => {
  reset();
  const T = globalThis.Truco;
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    delete T.reportError;
    const p = Tween.run(0.1, () => {
      throw new Error('boom');
    });
    step(0.05);
    await p;
    assert.equal(logged.length, 1, 'sem Truco.reportError cai no console.error');
    assert.equal(logged[0][0], 'animação (tween)');
    assert.equal(logged[0][1].message, 'boom');

    const got = [];
    T.reportError = (err, where) => got.push([err.message, where]);
    const p2 = Tween.run(0.1, () => {
      throw new Error('bam');
    });
    step(0.05);
    await p2;
    assert.deepEqual(got, [['bam', 'animação (tween)']]);
    assert.equal(logged.length, 1, 'com o relator do jogo, nada vai para o console');
    assert.equal(Tween.activeCount(), 0);
  } finally {
    console.error = original;
    delete T.reportError;
  }
});

test('GfxUtil: família da fonte CSS e fontes sem document (node) contam como prontas', () => {
  const U = Tween.util;
  assert.equal(U, globalThis.Truco.GfxUtil);
  assert.equal(U.familyOf('700 40px "Barlow Condensed", "Arial Narrow", Arial, sans-serif'), 'Barlow Condensed');
  assert.equal(U.familyOf('italic 700 92px "Barlow Condensed", Arial'), 'Barlow Condensed');
  assert.equal(U.familyOf('400 150px Shrikhand, "Cooper Black", Georgia, serif'), 'Shrikhand');
  assert.equal(U.fontsReady(['400 60px Shrikhand']), true);
  let called = 0;
  assert.equal(U.onFonts(['400 60px Shrikhand'], () => called++), false, 'sem document.fonts não fica esperando');
  assert.equal(called, 0);
});
