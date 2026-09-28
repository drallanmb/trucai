'use strict';
// Testes das texturas das cartas (js/gfx/cardtex.js) com um canvas 2D falso que só registra as
// chamadas: node --test tests/
// Foco nos easter eggs (Qh anime, bananinha dos 2, Clawd no Ás de espadas): a carta continua
// valendo o que diz — mesma contagem de pips, cores de naipe e nenhum texto extra.
const test = require('node:test');
const assert = require('node:assert/strict');

let log = [];

function makeCtx() {
  const props = {};
  const stub = {
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    measureText: () => ({ width: 10 }),
  };
  return new Proxy(props, {
    get(target, name) {
      if (name in target) return target[name];
      return (...args) => {
        log.push({ name, args, fillStyle: target.fillStyle });
        return stub[name] ? stub[name](...args) : undefined;
      };
    },
    set(target, name, value) {
      target[name] = value;
      return true;
    },
  });
}

globalThis.OffscreenCanvas = class {
  constructor(w, h) {
    this.width = w;
    this.height = h;
    this.ctx = makeCtx();
  }
  getContext() {
    return this.ctx;
  }
};

const CardTex = require('../js/gfx/cardtex.js');

const RED = '#C0272D';
const INK = '#1B1B1F';
const SUITS = { c: INK, h: RED, s: INK, d: RED };

/** Pinta a carta (cada id só é pintado uma vez por causa do cache) e devolve as chamadas. */
function paint(id) {
  log = [];
  if (id === 'back') CardTex.backCanvas();
  else CardTex.faceCanvas(id);
  return log;
}

function pipFills(calls, color) {
  return calls.filter((c) => c.name === 'fill' && c.args[0] === 'nonzero' && c.fillStyle === color).length;
}

test('os 2 continuam com 2 pips (+2 dos índices) na cor do naipe, e ganham a bananinha', () => {
  const tilts = new Set();
  for (const s of 'chsd') {
    const calls = paint('2' + s);
    assert.equal(pipFills(calls, SUITS[s]), 4, '2' + s + ': 2 pips centrais + 2 dos índices');
    const texts = calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]);
    assert.deepEqual(texts, ['2', '2'], '2' + s + ': só os índices');
    const rot = calls.find((c) => c.name === 'rotate' && c.args[0] !== Math.PI);
    assert.ok(rot, '2' + s + ': banana inclinada');
    tilts.add(rot.args[0]);
    assert.ok(calls.some((c) => c.name === 'ellipse'), '2' + s + ': banana desenhada');
  }
  assert.equal(tilts.size, 4, 'cada naipe tem sua inclinação');
});

test('o 3 segue com 3 pips (a banana é só dos 2)', () => {
  const calls = paint('3h');
  assert.equal(pipFills(calls, RED), 5);
});

test('Ás de espadas: Clawd em pixel-art (fillRect em coordenadas inteiras), sem mexer no índice', () => {
  const calls = paint('As');
  const clawd = calls.filter((c) => c.name === 'fillRect' && c.fillStyle === '#D97757');
  assert.ok(clawd.length >= 60, 'grade do Clawd: ' + clawd.length + ' pixels');
  for (const c of clawd) assert.ok(c.args.every(Number.isInteger), 'pixel em coordenada inteira: ' + c.args);
  const eyes = calls.filter((c) => c.name === 'fillRect' && c.fillStyle === INK);
  assert.equal(eyes.length, 4, 'dois olhos de 1×2 pixels');
  const texts = calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]);
  assert.deepEqual(texts.slice(-2), ['A', 'A'], 'índices A (desenhados por último; antes vem a fita)');
});

test('Dama de copas (anime/Hermes): mesmos índices e pips, nenhum texto extra', () => {
  const calls = paint('Qh');
  const texts = calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]);
  assert.deepEqual(texts, ['Q', 'Q']);
  // 2 pips dos índices + 1 pip por metade da figura.
  assert.equal(pipFills(calls, RED), 4);
});

// Por último: depois disso tudo fica no cache e não repinta.
test('as 40 faces e o verso pintam sem erro', () => {
  for (const s of 'chsd') {
    for (const r of ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3']) {
      assert.doesNotThrow(() => paint(r + s), r + s);
    }
  }
  assert.doesNotThrow(() => paint('back'));
});
