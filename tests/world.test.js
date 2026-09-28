'use strict';
// Testes das partes puras do Truco.World (js/gfx/world.js): node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const World = require('../js/gfx/world.js');
const Cards3D = require('../js/gfx/cards3d.js');

const D2R = Math.PI / 180;

test('adereços da mesa ficam fora das zonas de cartas/placar (2 e 4 jogadores) e dentro do tampo', () => {
  for (const players of [2, 4]) {
    const zones = Cards3D.layout(players).keepOut();
    assert.ok(zones.length > 0);
    assert.deepEqual(World.checkProps(zones, 3.5), [], 'conflitos com ' + players + ' jogadores');
  }
});

test('checkProps acusa sobreposição com uma zona reservada', () => {
  const zones = [{ kind: 'circle', x: -3.0, z: 2.3, r: 0.5 }];
  const problems = World.checkProps(zones, 3.5);
  assert.ok(problems.some((p) => p.id === 'pingado'), JSON.stringify(problems));
  const rect = [{ kind: 'rect', x: 2.95, z: 2.95, w: 0.4, d: 0.4 }];
  assert.ok(World.checkProps(rect, 3.5).some((p) => p.id === 'garrafa'));
});

test('o toldo cobre a mesa e a luminária; a mureta fica atrás do parceiro', () => {
  const A = World.LAYOUT.awning;
  assert.ok(A.x0 < -3.5 && A.x1 > 3.5, 'toldo cobre a largura da mesa');
  assert.ok(A.z0 < -3.5 && A.z1 > 3.5, 'toldo cobre a profundidade da mesa');
  assert.ok(A.yWall > A.yEdge, 'toldo cai da parede para a frente');
  assert.ok(World.LAYOUT.murZ < -8, 'mureta atrás da cadeira do parceiro (assento em z = −5)');
  assert.ok(World.LAYOUT.facadeX > 7.5, 'fachada depois da cadeira do assento 1 (x = 5)');
});

test('engradados da xicrinha ficam fora da mesa e da cadeira do assento 3', () => {
  const c = World.LAYOUT.crate;
  const cos = Math.cos(c.yaw);
  const sin = Math.sin(c.yaw);
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sz]) => {
    const x = (sx * c.w) / 2;
    const z = (sz * c.d) / 2;
    return [c.x + x * cos + z * sin, c.z - x * sin + z * cos];
  });
  const minX = Math.min(...corners.map((p) => p[0]));
  const maxX = Math.max(...corners.map((p) => p[0]));
  const minZ = Math.min(...corners.map((p) => p[1]));
  // Tampo: |x|, |z| ≤ 3,5. Cadeira do assento 3 (atrás do Zé): x de −7,75 a −3,65 e z de −1,95 a 1,95.
  assert.ok(maxX < -3.5, 'fora do tampo: ' + maxX);
  const hitsChair = maxX > -7.75 && minX < -3.65 && minZ < 1.95;
  assert.ok(!hitsChair, 'invade a cadeira: ' + JSON.stringify(corners));
});

test('faixa do fundo: paisagem, retrato e câmera nivelada', () => {
  // Câmera de paisagem sentada (~35°, FOV 54): o topo da tela fica ~8° abaixo do horizonte.
  const land = World.backdropBand(7.07, 9.06, -35 * D2R, 54, -5.3, -16);
  assert.ok(Math.abs(land.top / D2R - 8) < 0.5, 'topo da tela ~8° abaixo do horizonte: ' + land.top / D2R);
  assert.ok(land.bottom > land.top, 'mureta abaixo da borda de cima');
  assert.ok(land.center > land.top && land.center < land.bottom);
  assert.ok(land.k >= 0.45 && land.k <= 1.5);

  const port = World.backdropBand(12.58, 7.48, -68 * D2R, 80, -5.3, -16);
  assert.ok(Math.abs(port.top / D2R - 28) < 0.5, 'retrato: ' + port.top / D2R);
  assert.ok(port.bottom > port.top);

  const level = World.backdropBand(4, 20, 0, 40, -5.3, -16);
  assert.ok(level.center >= 2 * D2R - 1e-9, 'nunca acima do horizonte');
  assert.ok(level.bottom > level.top);
});

test('calçada: placas brancas, pretas e divididas na diagonal, em zigue-zague contínuo e periódico', () => {
  const S = World.SIDEWALK;
  assert.equal(S.bumps, 8, 'grade de 8 × 8 quadradinhos por placa');
  assert.ok(S.tile >= 2 && S.tile <= 4, 'placa de 20 a 40 cm');
  const kinds = { branca: 0, preta: 0, dividida: 0 };
  for (let j = 0; j < S.period; j++) {
    for (let i = 0; i < S.period; i++) {
      const t = World.sidewalkTile(i, j);
      kinds[t.kind]++;
      assert.ok(t.diag === 'anti' || t.diag === 'main');
      if (t.kind === 'dividida') assert.notEqual(t.a, t.b);
      else assert.equal(t.a, t.b);
      // Periódico nos dois eixos (a textura repete sem emenda).
      assert.deepEqual(World.sidewalkTile(i + S.period, j), t);
      assert.deepEqual(World.sidewalkTile(i, j - S.period), t);
    }
  }
  for (const k of Object.keys(kinds)) assert.ok(kinds[k] > 0, 'tem placa ' + k);
  // O desenho é contínuo: dos dois lados de cada rejunte a cor é a mesma (a fronteira preto/branco
  // só passa pela diagonal das placas, nunca pelo rejunte).
  const e = 1e-3;
  for (let j = -4; j < 4; j++) {
    for (let i = -4; i < 4; i++) {
      for (const f of [0.2, 0.5, 0.8]) {
        assert.equal(World.sidewalkField(i + 1 - e, j + f), World.sidewalkField(i + 1 + e, j + f), 'rejunte vertical ' + i + ',' + j);
        assert.equal(World.sidewalkField(i + f, j + 1 - e), World.sidewalkField(i + f, j + 1 + e), 'rejunte horizontal ' + i + ',' + j);
      }
    }
  }
  // Metade preta, metade branca.
  let black = 0;
  const n = 64;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) black += World.sidewalkField(((x + 0.5) / n) * S.period, ((y + 0.5) / n) * S.period);
  assert.ok(Math.abs(black / (n * n) - 0.5) < 0.02, 'fração preta ' + black / (n * n));
});

test('lousa de preços tem os itens do boteco e do café', () => {
  const names = World.PRICES.map((p) => p[0]);
  for (const n of ['Cafezinho', 'Pingado', 'Pão na chapa', 'Cerveja 600 ml']) assert.ok(names.includes(n), n);
  for (const [, price] of World.PRICES) assert.match(price, /^R\$ \d+(,\d\d)?$/);
});

test('mapa do tampo em retrato (cartas maiores): nada se sobrepõe e os adereços continuam livres', () => {
  assert.equal(Cards3D.tableScaleFor(1.6), Cards3D.TABLE_SCALE);
  assert.equal(Cards3D.tableScaleFor(390 / 844), Cards3D.TABLE_SCALE_PORTRAIT);
  assert.ok(Cards3D.TABLE_SCALE_PORTRAIT > Cards3D.TABLE_SCALE);
  const { W, H } = Cards3D.CARD;
  // Retângulo da carta deitada (topo para −Z, girado `yaw` em Y) e teste de separação de eixos.
  const rect = (x, z, yaw, s, rot90) => {
    const a = yaw + (rot90 ? Math.PI / 2 : 0);
    return { c: [x, z], ax: [[Math.cos(a), -Math.sin(a)], [Math.sin(a), Math.cos(a)]], h: [(W * s) / 2, (H * s) / 2] };
  };
  const overlaps = (a, b, margin) => {
    for (const ax of [...a.ax, ...b.ax]) {
      const pr = (r) => {
        const c = r.c[0] * ax[0] + r.c[1] * ax[1];
        const e = r.h[0] * Math.abs(r.ax[0][0] * ax[0] + r.ax[0][1] * ax[1]) + r.h[1] * Math.abs(r.ax[1][0] * ax[0] + r.ax[1][1] * ax[1]);
        return [c - e, c + e];
      };
      const p = pr(a);
      const q = pr(b);
      if (p[1] + margin < q[0] || q[1] + margin < p[0]) return false;
    }
    return true;
  };
  for (const players of [2, 4]) {
    for (const s of [Cards3D.TABLE_SCALE, Cards3D.TABLE_SCALE_PORTRAIT]) {
      const L = Cards3D.layout(players, s);
      const items = [];
      for (let seat = 0; seat < players; seat++) {
        for (let r = 0; r < 3; r++) {
          const p = L.slot(seat, r);
          items.push({ id: 'slot' + seat + ':' + r, seat, R: rect(p.x, p.z, p.yaw, s) });
        }
      }
      items.push({ id: 'monte', R: rect(L.deckHome.x, L.deckHome.z, 0, s) });
      items.push({ id: 'vira', R: rect(L.viraHome.x, L.viraHome.z, 0, s, true) });
      const caps = [0, 1].map((t) => {
        const a = L.capRow(t, 0);
        const b = L.capRow(t, 11);
        return { id: 'tampinhas' + t, R: { c: [a.x, (a.z + b.z) / 2], ax: [[1, 0], [0, 1]], h: [0.157, (b.z - a.z) / 2 + 0.137] } };
      });
      const where = players + ' jogadores, escala ' + s + ': ';
      for (let i = 0; i < items.length; i++) {
        const a = items[i];
        for (let j = i + 1; j < items.length; j++) {
          const b = items[j];
          if (a.seat != null && a.seat === b.seat) continue; // as rodadas do mesmo assento se empilham
          if (a.id === 'monte' && b.id === 'vira') continue; // a vira sai de baixo do monte
          assert.ok(!overlaps(a.R, b.R, 0.01), where + a.id + ' × ' + b.id);
        }
        for (const c of caps) assert.ok(!overlaps(a.R, c.R, 0.01), where + a.id + ' × ' + c.id);
      }
      for (let seat = 0; seat < players; seat++) {
        const d = L.dealerSpot(seat);
        const R = rect(d.x, d.z, d.yaw, s);
        for (const c of caps) assert.ok(!overlaps(R, c.R, 0.01), where + 'monte do carteador ' + seat + ' × ' + c.id);
      }
      assert.deepEqual(World.checkProps(L.keepOut(), 3.5), [], where + 'adereços');
    }
  }
});
