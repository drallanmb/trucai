'use strict';
// Testes das partes puras do Truco.Avatars (js/gfx/avatars.js): node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const Avatars = require('../js/gfx/avatars.js');

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

test('os quatro estilos prontos existem e têm o visual pedido', () => {
  const L = (style) => Avatars.resolveLook({ style });
  assert.deepEqual(Object.keys(Avatars.LOOKS).sort(), ['bigode', 'bone', 'coque', 'topete']);
  assert.equal(L('bigode').hair, 'careca');
  assert.equal(L('bigode').face, 'bigodao');
  assert.equal(L('bone').cap, true);
  assert.equal(L('coque').hair, 'coque');
  assert.equal(L('coque').glasses, true);
  assert.equal(L('topete').hair, 'topete');
  const outfits = new Set(['bigode', 'bone', 'coque', 'topete'].map((s) => L(s).outfit));
  for (const o of outfits) assert.ok(Avatars.OUTFITS.includes(o));
  assert.ok(outfits.size >= 3, 'camisa lisa, listrada e de time aparecem nos estilos');
});

test('estilos antigos (só cabelo) continuam aceitos; careca ganha bigode se face não vier', () => {
  for (const hair of Avatars.HAIRS) assert.equal(Avatars.resolveLook({ style: hair }).hair, hair);
  assert.equal(Avatars.resolveLook({ style: 'careca' }).face, 'bigode');
  assert.equal(Avatars.resolveLook({ style: 'careca', face: 'nenhum' }).face, 'nenhum');
});

test('sem estilo, o assento escolhe; estilo desconhecido também cai no padrão do assento', () => {
  assert.equal(Avatars.resolveLook({ seat: 1 }).style, 'bigode');
  assert.equal(Avatars.resolveLook({ seat: 2 }).style, 'coque');
  assert.equal(Avatars.resolveLook({ seat: 3 }).style, 'topete');
  assert.equal(Avatars.resolveLook({ seat: 2, style: 'moicano' }).style, 'coque');
  assert.equal(Avatars.resolveLook({}).style, 'bigode');
});

test('roupa, rosto e acessório sobrepõem o estilo (com os nomes da ficha de personagem)', () => {
  assert.equal(Avatars.resolveLook({ style: 'bone', outfit: 'camisa-listrada' }).outfit, 'listrada');
  assert.equal(Avatars.resolveLook({ style: 'coque', outfit: 'camisa-de-time' }).outfit, 'time');
  assert.equal(Avatars.resolveLook({ style: 'coque', outfit: 'avental' }).outfit, 'avental');
  assert.equal(Avatars.resolveLook({ style: 'coque', outfit: 'pijama' }).outfit, 'lisa', 'roupa desconhecida mantém a do estilo');
  assert.equal(Avatars.resolveLook({ style: 'topete', face: 'cavanhaque' }).face, 'cavanhaque');
  assert.equal(Avatars.resolveLook({ style: 'topete', accessory: 'oculos' }).glasses, true);
  assert.equal(Avatars.resolveLook({ style: 'topete', accessory: 'bone' }).cap, true);
  const none = Avatars.resolveLook({ style: 'coque', accessory: 'nenhum' });
  assert.equal(none.glasses, false);
  assert.equal(none.cap, false);
});

test('compatibilidade: os três avatares do jogo resolvem igual ao visual antigo', () => {
  const cast = [
    { seat: 1, style: 'bigode', shirt: '#2F5D8A', skin: '#b5835a', hair: '#8a8580' },
    { seat: 2, style: 'coque', shirt: '#9B3B2E', skin: '#e0b48e', hair: '#5a3a24' },
    { seat: 3, style: 'bone', shirt: '#3E6B45', skin: '#8d5a3b', hair: '#1c1512' },
  ];
  const pick = (l) => ({ hair: l.hair, face: l.face, outfit: l.outfit, belly: l.belly, glasses: l.glasses, cap: l.cap, earrings: l.earrings });
  for (const c of cast) {
    const l = Avatars.resolveLook(c);
    assert.deepEqual(pick(l), pick(Object.assign({}, Avatars.LOOKS[c.style])), c.style);
    assert.equal(l.panama, false);
    assert.equal(l.pencil, false);
    assert.equal(l.toothpick, false);
    assert.equal(l.colors.shirt, c.shirt.toLowerCase());
    assert.equal(l.colors.skin, c.skin);
    assert.equal(l.colors.hair, c.hair);
    assert.equal(l.colors.accent, null, 'sem accent: a cor secundária continua derivada da camisa');
  }
  // Sem style nem hairStyle (DEFAULT_AVATARS da cena): o assento escolhe, como antes.
  assert.equal(Avatars.resolveLook({ seat: 2, shirt: '#9B3B2E' }).hair, 'coque');
});

test('spec novo (ficha): hairStyle, face, accessory e outfit com os nomes em português', () => {
  const l = Avatars.resolveLook({
    seat: 2, name: 'Tião', skin: '#b5835a', hair: '#8a8580', shirt: '#2F5D8A', accent: '#F4EFE4',
    hairStyle: 'careca', face: 'bigodao', accessory: 'palito-na-boca', outfit: 'camisa-listrada',
  });
  assert.equal(l.style, null);
  assert.equal(l.hair, 'careca');
  assert.equal(l.face, 'bigodao');
  assert.equal(l.outfit, 'listrada');
  assert.equal(l.toothpick, true);
  assert.equal(l.accessory, 'palito-na-boca');
  assert.equal(l.glasses || l.cap || l.panama || l.pencil || l.earrings, false, 'só o acessório pedido');
  assert.equal(l.colors.accent, '#f4efe4');

  const outfits = { 'camisa-lisa': 'lisa', 'camisa-listrada': 'listrada', 'camisa-de-time': 'time', regata: 'regata', 'camisa-social': 'social', avental: 'avental' };
  for (const [ficha, interno] of Object.entries(outfits)) {
    assert.equal(Avatars.resolveLook({ hairStyle: 'curto', outfit: ficha }).outfit, interno, ficha);
    assert.ok(Avatars.OUTFITS.includes(interno));
  }
  const flags = { bone: 'cap', oculos: 'glasses', 'chapeu-panama': 'panama', 'lapis-na-orelha': 'pencil', 'palito-na-boca': 'toothpick' };
  for (const [acc, flag] of Object.entries(flags)) {
    const r = Avatars.resolveLook({ hairStyle: 'curto', accessory: acc });
    assert.equal(r[flag], true, acc);
    assert.equal(r.accessory, acc);
    for (const other of Object.values(flags)) if (other !== flag) assert.equal(r[other], false, acc + ' não liga ' + other);
  }
  for (const hair of Avatars.HAIRS) assert.equal(Avatars.resolveLook({ hairStyle: hair }).hair, hair);
  // Acentos e maiúsculas da ficha escrita à mão.
  assert.equal(Avatars.resolveLook({ hairStyle: 'Curto', accessory: 'Chapéu-Panamá' }).panama, true);
  assert.equal(Avatars.resolveLook({ hairStyle: 'curto', accessory: 'óculos' }).glasses, true);
  assert.equal(Avatars.resolveLook({ hairStyle: 'curto', face: 'Bigodão' }).face, 'bigodao');
});

test('spec novo: valores inválidos caem nos padrões da ficha (curto, sem rosto, camisa lisa, nenhum)', () => {
  const l = Avatars.resolveLook({ seat: 1, hairStyle: 'moicano', face: 'costeleta', accessory: 'coroa', outfit: 'smoking', skin: 'verde', hair: '#12', shirt: 42, accent: 'nope' });
  assert.equal(l.hair, 'curto');
  assert.equal(l.face, 'nenhum');
  assert.equal(l.outfit, 'lisa');
  assert.equal(l.accessory, 'nenhum');
  assert.equal(l.cap || l.glasses || l.panama || l.pencil || l.toothpick, false);
  assert.equal(l.colors.skin, '#c68a5e');
  assert.equal(l.colors.hair, '#2b1d14');
  assert.equal(l.colors.shirt, '#00002a', 'número 0..0xffffff vale como cor');
  assert.equal(l.colors.accent, null);
  assert.equal(Avatars.resolveLook({ hairStyle: 'curto', shirt: '#abc' }).colors.shirt, '#aabbcc');
  assert.equal(Avatars.resolveLook({ hairStyle: 'curto', shirt: 'red' }).colors.shirt, '#2f5d8a');
  assert.equal(Avatars.resolveLook({ hairStyle: null, seat: 3 }).style, 'topete', 'hairStyle null = spec antigo');
  assert.equal(Avatars.resolveLook(null).style, 'bigode');
  assert.equal(Avatars.resolveLook(undefined).colors.pants, '#2e3a4f');
});

test('style antigo + campos novos: hairStyle troca o cabelo; chapéu e boné se excluem', () => {
  const a = Avatars.resolveLook({ style: 'coque', hairStyle: 'black' });
  assert.equal(a.hair, 'black');
  assert.equal(a.glasses, true, 'o resto do estilo continua');
  const b = Avatars.resolveLook({ style: 'bone', accessory: 'chapeu-panama' });
  assert.equal(b.panama, true);
  assert.equal(b.cap, false);
  const c = Avatars.resolveLook({ style: 'coque', accessory: 'nenhum' });
  assert.equal(c.glasses || c.cap || c.panama, false);
  assert.equal(c.earrings, true, 'brinco é do estilo, não é acessório');
});

test('sinais: nomes aceitos, linhas do tempo de ~1 s que voltam ao repouso', () => {
  assert.deepEqual(Avatars.SIGNALS, ['piscar', 'levantar-sobrancelha', 'bochecha-com-lingua', 'ponta-da-lingua', 'levantar-ombro', 'encher-bochechas', 'cocar-nariz']);
  assert.equal(Avatars.normalizeSignal('Coçar-nariz'), 'cocar-nariz');
  assert.equal(Avatars.normalizeSignal('bochecha com língua'), 'bochecha-com-lingua');
  assert.equal(Avatars.normalizeSignal('assobiar'), null);
  assert.equal(Avatars.signalSteps('assobiar', 1), null);
  const keys = Object.keys(Avatars.REST);
  for (const g of Avatars.SIGNALS) {
    for (const side of [-1, 1]) {
      const steps = Avatars.signalSteps(g, side);
      const total = steps.reduce((a, s) => a + s[1], 0);
      assert.ok(total >= 0.85 && total <= 1.3, g + ' dura ' + total);
      for (const [props] of steps) for (const k of Object.keys(props)) assert.ok(keys.includes(k), g + ': chave ' + k);
      assert.equal(steps[steps.length - 1][0], Avatars.REST, g + ' termina no repouso');
      // O gesto mexe em algo de verdade (algum peso sai do repouso no 1º trecho).
      const first = steps[0][0];
      assert.ok(Object.keys(first).some((k) => first[k] !== Avatars.REST[k]), g);
    }
  }
  // Gestos de um lado só usam o lado pedido.
  assert.equal(Avatars.signalSteps('piscar', 1)[0][0].winkP, 1);
  assert.equal(Avatars.signalSteps('piscar', -1)[0][0].winkN, 1);
  assert.equal(Avatars.signalSteps('levantar-ombro', -1)[0][0].shrugN, 1);
  const puff = Avatars.signalSteps('encher-bochechas', 1)[0][0];
  assert.ok(puff.cheekP >= 1 && puff.cheekN >= 1, "as duas bochechas");
});

test('IK de dois ossos: comprimentos preservados e punho no alvo alcançável', () => {
  const out = { elbow: [0, 0, 0], wrist: [0, 0, 0] };
  const s = [1, 4.6, 0];
  const t = [0.2, 4.3, 1.5];
  Avatars.solveTwoBone(s, t, 1.45, 1.35, [1, -0.9, -0.35], out);
  assert.ok(Math.abs(dist(s, out.elbow) - 1.45) < 1e-6);
  assert.ok(Math.abs(dist(out.elbow, out.wrist) - 1.35) < 1e-6);
  assert.ok(dist(out.wrist, t) < 1e-6);
});

test('IK: alvo fora de alcance estica o braço na direção dele; o cotovelo vai para o lado do polo', () => {
  const out = { elbow: [0, 0, 0], wrist: [0, 0, 0] };
  const s = [0, 0, 0];
  Avatars.solveTwoBone(s, [10, 0, 0], 1, 1, [0, -1, 0], out);
  assert.ok(Math.abs(dist(s, out.wrist) - 2) < 1e-3);
  assert.ok(out.wrist[0] > 1.99 && Math.abs(out.wrist[1]) < 1e-9);

  Avatars.solveTwoBone(s, [1.2, 0, 0], 1, 1, [0, -1, 0], out);
  assert.ok(out.elbow[1] < -0.5, 'cotovelo para baixo, como o polo: ' + out.elbow);
  Avatars.solveTwoBone(s, [1.2, 0, 0], 1, 1, [0, 1, 0], out);
  assert.ok(out.elbow[1] > 0.5, 'cotovelo para cima: ' + out.elbow);
});

test('IK: casos degenerados (alvo no ombro, polo paralelo) não geram NaN', () => {
  const out = { elbow: [0, 0, 0], wrist: [0, 0, 0] };
  Avatars.solveTwoBone([0, 0, 0], [0, 0, 0], 1, 1, [0, -1, 0], out);
  Avatars.solveTwoBone([0, 0, 0], [1, 0, 0], 1, 1, [1, 0, 0], out);
  for (const v of out.elbow.concat(out.wrist)) assert.ok(Number.isFinite(v));
});

test('accessory em lista: boné/chapéu + óculos + lápis/palito juntos; string continua valendo', () => {
  const v = Avatars.resolveLook({ seat: 2, hairStyle: 'curto', face: 'barba', accessory: ['bone-frente', 'oculos-fino'], capColor: '#1B1B1E', capMark: 'tres-quadrados' });
  assert.equal(v.cap, true);
  assert.equal(v.capFront, true);
  assert.equal(v.glasses, true);
  assert.equal(v.glassesThin, true);
  assert.equal(v.panama || v.pencil || v.toothpick, false);
  assert.deepEqual(v.accessories, ['bone-frente', 'oculos-fino']);
  assert.equal(v.capMark, 'tres-quadrados');
  assert.equal(v.colors.cap, '#1b1b1e');
  assert.equal(v.face, 'barba');

  const all = Avatars.resolveLook({ hairStyle: 'curto', accessory: ['Chapéu-Panamá', 'óculos', 'lapis-na-orelha', 'palito-na-boca'] });
  assert.deepEqual(all.accessories, ['chapeu-panama', 'oculos', 'lapis-na-orelha', 'palito-na-boca']);
  // Mesmo grupo: vale o último (boné × chapéu; óculos × óculos fino).
  const g = Avatars.resolveLook({ hairStyle: 'curto', accessory: ['bone', 'chapeu-panama', 'oculos-fino', 'oculos'] });
  assert.equal(g.panama, true);
  assert.equal(g.cap, false);
  assert.equal(g.glasses, true);
  assert.equal(g.glassesThin, false);
  assert.deepEqual(g.accessories, ['chapeu-panama', 'oculos']);
  // 'nenhum' no meio da lista limpa o que veio antes; inválidos são ignorados.
  const n = Avatars.resolveLook({ style: 'coque', accessory: ['nenhum', 'coroa', 'bone-frente', 42, null] });
  assert.deepEqual(n.accessories, ['bone-frente']);
  assert.equal(n.glasses, false);
  // String: 'bone' continua o boné de sempre (aba levantada), 'bone-frente' é o novo.
  const b = Avatars.resolveLook({ hairStyle: 'curto', accessory: 'bone' });
  assert.equal(b.cap && !b.capFront, true);
  assert.equal(b.accessory, 'bone');
  assert.deepEqual(b.accessories, ['bone']);
  const bf = Avatars.resolveLook({ hairStyle: 'curto', accessory: 'bone-frente' });
  assert.equal(bf.cap && bf.capFront, true);
  assert.equal(bf.accessory, 'bone-frente');
  const of = Avatars.resolveLook({ hairStyle: 'curto', accessory: 'oculos-fino' });
  assert.equal(of.glasses && of.glassesThin, true);
  for (const a of ['bone-frente', 'oculos-fino']) assert.ok(Avatars.ACCESSORIES.includes(a));
  assert.equal(Avatars.ACCESSORY_GROUP['bone-frente'], Avatars.ACCESSORY_GROUP['chapeu-panama']);
  assert.equal(Avatars.ACCESSORY_GROUP['oculos-fino'], Avatars.ACCESSORY_GROUP.oculos);
});

test('capColor, capMark, earrings, lashes e belly: válidos entram, inválidos caem no padrão', () => {
  const d = Avatars.resolveLook({ hairStyle: 'curto' });
  assert.equal(d.colors.cap, null, 'sem capColor: cor do boné derivada (accent)');
  assert.equal(d.capMark, null);
  assert.equal(d.lashes, false);
  assert.equal(d.earrings, false);
  assert.equal(d.belly, 0.4);
  const x = Avatars.resolveLook({ hairStyle: 'curto', capColor: 'preto', capMark: 'logo-real', earrings: 'sim', lashes: 1, belly: 'magra' });
  assert.equal(x.colors.cap, null);
  assert.equal(x.capMark, null);
  assert.equal(x.earrings, false);
  assert.equal(x.lashes, false);
  assert.equal(x.belly, 0.4);
  const f = Avatars.resolveLook({ seat: 3, hairStyle: 'rabo-de-cavalo', earrings: true, lashes: true, belly: -2, capMark: 'Tres Quadrados' });
  assert.equal(f.hair, 'rabo-de-cavalo');
  assert.equal(f.earrings, true);
  assert.equal(f.lashes, true);
  assert.equal(f.belly, 0);
  assert.equal(f.capMark, 'tres-quadrados');
  assert.equal(Avatars.resolveLook({ hairStyle: 'curto', belly: 0.25 }).belly, 0.25);
  // O brinco do estilo coque pode ser desligado.
  assert.equal(Avatars.resolveLook({ style: 'coque', earrings: false }).earrings, false);
  assert.ok(Avatars.HAIRS.includes('rabo-de-cavalo'));
  assert.deepEqual(Avatars.CAP_MARKS, ['tres-quadrados']);
});
