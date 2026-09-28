'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Rules = require('../js/core/rules.js');

const C = (id) => Rules.cardFromId(id);

test('carrega em globalThis.Truco.Rules', () => {
  assert.equal(globalThis.Truco.Rules, Rules);
});

test('constantes do contrato', () => {
  assert.deepEqual([...Rules.DECKS.limpo], ['Q', 'J', 'K', 'A', '2', '3']);
  assert.deepEqual([...Rules.DECKS.sujo], ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3']);
  assert.deepEqual([...Rules.ALL_RANKS], ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3']);
  assert.deepEqual([...Rules.SUITS], ['diamonds', 'spades', 'hearts', 'clubs']);
  assert.deepEqual([...Rules.VALUES], [1, 3, 6, 9, 12]);
  assert.deepEqual({ ...Rules.CALL_NAMES }, { 3: 'Truco', 6: 'Seis', 9: 'Nove', 12: 'Doze' });
  assert.deepEqual({ ...Rules.MANILHA_NAMES }, {
    clubs: 'Zap', hearts: 'Copas', spades: 'Espadilha', diamonds: 'Pica-fumo',
  });
  assert.deepEqual({ ...Rules.SUIT_INFO.clubs }, { name: 'Paus', symbol: '♣', color: 'black', letter: 'c' });
  assert.deepEqual({ ...Rules.SUIT_INFO.hearts }, { name: 'Copas', symbol: '♥', color: 'red', letter: 'h' });
  assert.deepEqual({ ...Rules.SUIT_INFO.spades }, { name: 'Espadas', symbol: '♠', color: 'black', letter: 's' });
  assert.deepEqual({ ...Rules.SUIT_INFO.diamonds }, { name: 'Ouros', symbol: '♦', color: 'red', letter: 'd' });
  for (const r of Rules.ALL_RANKS) assert.equal(typeof Rules.RANK_NAMES[r], 'string');
  assert.equal(Rules.RANK_NAMES.A, 'Ás');
  assert.equal(Rules.RANK_NAMES.J, 'Valete');
  assert.equal(Rules.RANK_NAMES.Q, 'Dama');
  assert.equal(Rules.RANK_NAMES.K, 'Rei');
});

test('makeDeck: limpo 24 e sujo 40, ids únicos, ordem fixa', () => {
  const limpo = Rules.makeDeck();
  const sujo = Rules.makeDeck('sujo');
  assert.equal(limpo.length, 24);
  assert.equal(sujo.length, 40);
  assert.equal(new Set(limpo.map((c) => c.id)).size, 24);
  assert.equal(new Set(sujo.map((c) => c.id)).size, 40);
  assert.deepEqual(Rules.makeDeck('limpo'), limpo);
  for (const c of limpo) {
    assert.ok(Rules.DECKS.limpo.includes(c.rank));
    assert.equal(c.id, c.rank + Rules.SUIT_INFO[c.suit].letter);
  }
  for (const r of ['4', '5', '6', '7']) assert.ok(!limpo.some((c) => c.rank === r));
  // Cada posto aparece uma vez em cada naipe.
  for (const r of Rules.DECKS.sujo) assert.equal(sujo.filter((c) => c.rank === r).length, 4);
  assert.throws(() => Rules.makeDeck('mineiro'));
});

test('cardFromId: ida e volta e ids inválidos', () => {
  for (const c of Rules.makeDeck('sujo')) assert.deepEqual(Rules.cardFromId(c.id), c);
  assert.deepEqual(C('Qc'), { id: 'Qc', rank: 'Q', suit: 'clubs' });
  assert.deepEqual(C('3d'), { id: '3d', rank: '3', suit: 'diamonds' });
  assert.deepEqual(C('7h'), { id: '7h', rank: '7', suit: 'hearts' });
  for (const bad of ['', '8c', '10h', 'Qx', 'qc', null, 7, 'Q']) assert.throws(() => Rules.cardFromId(bad));
  assert.equal(Rules.isValidId('As'), true);
  assert.equal(Rules.isValidId('9s'), false);
});

test('Apêndice C.1 — manilha pela vira (sequência circular)', () => {
  assert.equal(Rules.manilhaRankFor('3'), 'Q');
  assert.equal(Rules.manilhaRankFor('K'), 'A');
  assert.equal(Rules.manilhaRankFor('Q'), 'J');
  assert.equal(Rules.manilhaRankFor('3', 'sujo'), '4');
  assert.equal(Rules.manilhaRankFor('7', 'sujo'), 'Q');
});

test('manilha: tabelas completas de RULES.md §4.3', () => {
  const limpo = { Q: 'J', J: 'K', K: 'A', A: '2', 2: '3', 3: 'Q' };
  for (const [vira, m] of Object.entries(limpo)) assert.equal(Rules.manilhaRankFor(vira, 'limpo'), m);
  const sujo = { 4: '5', 5: '6', 6: '7', 7: 'Q', Q: 'J', J: 'K', K: 'A', A: '2', 2: '3', 3: '4' };
  for (const [vira, m] of Object.entries(sujo)) assert.equal(Rules.manilhaRankFor(vira, 'sujo'), m);
  assert.throws(() => Rules.manilhaRankFor('4', 'limpo'));
});

test('Apêndice C.2 — força (limpo, vira K, manilha A)', () => {
  const m = Rules.manilhaRankFor('K');
  assert.equal(m, 'A');
  const desc = ['Ac', 'Ah', 'As', 'Ad', '3c', '2h', 'Ks', 'Jd', 'Qh'].map(C);
  for (let i = 0; i + 1 < desc.length; i++) {
    assert.equal(Rules.compare(desc[i], desc[i + 1], m), 1, `${desc[i].id} > ${desc[i + 1].id}`);
    assert.equal(Rules.compare(desc[i + 1], desc[i], m), -1);
  }
  assert.equal(Rules.compare(C('3c'), C('3d'), m), 0, '3♣ = 3♦');
  assert.equal(Rules.strength(C('Ac'), m), 103);
  assert.equal(Rules.strength(C('Ah'), m), 102);
  assert.equal(Rules.strength(C('As'), m), 101);
  assert.equal(Rules.strength(C('Ad'), m), 100);
  assert.equal(Rules.strength(C('3h'), m), 5);
  assert.equal(Rules.strength(C('Qh'), m), 0);
});

test('§5.3 — hierarquias completas de exemplo', () => {
  const ascending = (ids, vira, deck) => {
    const m = Rules.manilhaRankFor(vira, deck);
    const cards = ids.map(C);
    for (let i = 0; i + 1 < cards.length; i++) {
      assert.equal(Rules.compare(cards[i], cards[i + 1], m, deck), -1, `${cards[i].id} < ${cards[i + 1].id} (${deck})`);
    }
  };
  ascending(['Qh', 'Jh', 'Kh', '2h', '3h', 'Ad', 'As', 'Ah', 'Ac'], 'K', 'limpo');
  ascending(['Jh', 'Kh', 'Ah', '2h', '3h', 'Qd', 'Qs', 'Qh', 'Qc'], '3', 'limpo');
  ascending(['4h', '5h', '7h', 'Qh', 'Jh', 'Kh', 'Ah', '2h', '3h', '6d', '6s', '6h', '6c'], '5', 'sujo');
});

test('comuns do mesmo posto empatam; manilhas nunca empatam', () => {
  for (const deck of ['limpo', 'sujo']) {
    for (const vira of Rules.DECKS[deck]) {
      const m = Rules.manilhaRankFor(vira, deck);
      for (const a of Rules.makeDeck(deck)) {
        for (const b of Rules.makeDeck(deck)) {
          const cmp = Rules.compare(a, b, m, deck);
          if (a.rank === m && b.rank === m) assert.equal(cmp === 0, a.suit === b.suit);
          else if (a.rank === m) assert.equal(cmp, 1);
          else if (b.rank === m) assert.equal(cmp, -1);
          else if (a.rank === b.rank) assert.equal(cmp, 0);
          else assert.notEqual(cmp, 0);
        }
      }
    }
  }
});

test('strength: faixas por baralho e carta fora do baralho', () => {
  const sujo = Rules.makeDeck('sujo');
  for (const c of sujo) {
    const s = Rules.strength(c, '6', 'sujo');
    if (c.rank === '6') assert.ok(s >= 100 && s <= 103);
    else assert.ok(s >= 0 && s <= 9);
  }
  assert.throws(() => Rules.strength(C('4c'), 'J', 'limpo'));
  assert.equal(Rules.isManilha(C('Jd'), 'J'), true);
  assert.equal(Rules.isManilha(C('Qd'), 'J'), false);
});

test('nextValue: escada 1 → 3 → 6 → 9 → 12', () => {
  assert.equal(Rules.nextValue(1), 3);
  assert.equal(Rules.nextValue(3), 6);
  assert.equal(Rules.nextValue(6), 9);
  assert.equal(Rules.nextValue(9), 12);
  assert.equal(Rules.nextValue(12), null);
});

test('label e fullName', () => {
  assert.equal(Rules.label(C('7h')), '7♥');
  assert.equal(Rules.label('Qc'), 'Q♣');
  assert.equal(Rules.fullName(C('7h')), 'Sete de Copas');
  assert.equal(Rules.fullName(C('Qc'), 'Q'), 'Zap (Dama de Paus)');
  assert.equal(Rules.fullName(C('Qh'), 'Q'), 'Copas (Dama de Copas)');
  assert.equal(Rules.fullName(C('As'), 'A'), 'Espadilha (Ás de Espadas)');
  assert.equal(Rules.fullName(C('4d'), '4'), 'Pica-fumo (Quatro de Ouros)');
  assert.equal(Rules.fullName(C('Kd'), 'A'), 'Rei de Ouros');
});
