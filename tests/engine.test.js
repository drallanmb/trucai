'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../js/core/rules.js');
require('../js/core/engine.js');

const { Rules, Engine } = globalThis.Truco;
const C = (id) => Rules.cardFromId(id);
const VALUES = [1, 3, 6, 9, 12];

// ---------- utilitários de teste ----------

/** Partida com o mão no assento 0 (pé = último assento). */
function newMatch(o = {}) {
  const players = o.players || 4;
  return Engine.createMatch({
    players,
    seed: o.seed === undefined ? 1 : o.seed,
    firstDealer: o.firstDealer === undefined ? players - 1 : o.firstDealer,
    options: o.options,
  });
}

function startHand(state, score) {
  if (score) state.score = score.slice();
  return Engine.apply(state, { type: 'START_HAND' });
}

/**
 * Troca a vira e as cartas da mão atual (antes de qualquer jogada). Assentos com menos de 3 ids
 * recebem cartas de enchimento que não serão jogadas.
 */
function rig(state, vira, hands) {
  const deck = Rules.makeDeck(state.options.deck);
  const used = [vira, ...hands.flat()];
  assert.equal(new Set(used).size, used.length, 'cartas repetidas no rig');
  const spare = deck.filter((c) => !used.includes(c.id));
  const hand = state.hand;
  hand.vira = C(vira);
  hand.manilhaRank = Rules.manilhaRankFor(hand.vira.rank, state.options.deck);
  hand.hands = hands.map((ids) => {
    const cards = ids.map(C);
    while (cards.length < 3) cards.push(spare.shift());
    return cards;
  });
}

const play = (state, seat, cardId, faceDown = false) => Engine.apply(state, { type: 'PLAY', seat, cardId, faceDown });
const call = (state, seat) => Engine.apply(state, { type: 'CALL', seat });
const answer = (state, type, seat) => Engine.apply(state, { type, seat });
const onze = (state, seat, accept) => Engine.apply(state, { type: 'MAO_DE_ONZE', seat, accept });

/** Joga uma sequência [[seat, cardId, faceDown?], ...] e devolve todos os eventos. */
function playAll(state, plays) {
  const events = [];
  for (const [seat, id, fd] of plays) events.push(...play(state, seat, id, !!fd));
  return events;
}

function ofType(events, type) {
  return events.filter((e) => e.type === type);
}

function rejects(state, action, code) {
  const before = JSON.stringify(state);
  assert.throws(
    () => Engine.apply(state, action),
    (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.code, code, `${JSON.stringify(action)}: esperado ${code}, veio ${err.code} (${err.message})`);
      return true;
    },
  );
  assert.equal(JSON.stringify(state), before, `estado alterado por ação ilegal ${JSON.stringify(action)}`);
}

/** Joga a primeira carta de quem estiver na vez até a mão acabar, checando uma condição a cada vez. */
function playOut(state, onTurn) {
  const events = [];
  while (Engine.getDecision(state).kind === 'play') {
    const d = Engine.getDecision(state);
    if (onTurn) onTurn(d);
    const action = d.blind ? { type: 'PLAY', seat: d.seat, index: 0 } : { type: 'PLAY', seat: d.seat, cardId: d.playableCardIds[0] };
    events.push(...Engine.apply(state, action));
  }
  return events;
}

/** Faz `team` ganhar exatamente `points` (1 ou 3) nesta mão, via corrida. */
function awardHand(state, team, points) {
  const callerTeam = points === 1 ? team : 1 - team;
  const events = [];
  for (;;) {
    const d = Engine.getDecision(state);
    if (d.kind === 'play') {
      if (d.canCall && Engine.teamOf(d.seat) === callerTeam) events.push(...call(state, d.seat));
      else events.push(...play(state, d.seat, d.playableCardIds[0]));
    } else if (d.kind === 'callResponse') {
      if (points === 1) events.push(...answer(state, 'RUN', d.seats[0]));
      else if (d.team === team) events.push(...answer(state, 'RAISE', d.seats[0]));
      else events.push(...answer(state, 'RUN', d.seats[0]));
    } else {
      break;
    }
    if (ofType(events, 'handEnded').length) break;
  }
  const ended = ofType(events, 'handEnded')[0];
  assert.equal(ended.winnerTeam, team);
  assert.equal(ended.points, points);
  return events;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- API e criação ----------

test('carrega em globalThis.Truco.Engine com a API do contrato', () => {
  for (const fn of ['createMatch', 'getDecision', 'legalActions', 'apply', 'viewFor', 'teamOf', 'nextSeat', 'clone']) {
    assert.equal(typeof Engine[fn], 'function', fn);
  }
  assert.equal(Engine.teamOf(0), 0);
  assert.equal(Engine.teamOf(3), 1);
  assert.equal(Engine.nextSeat(3, 4), 0);
  assert.equal(Engine.nextSeat(1, 2), 0);
});

test('createMatch: padrões, validação e decisão inicial', () => {
  const s = Engine.createMatch({ players: 4, seed: 7 });
  assert.deepEqual(s.options, { deck: 'limpo', format: 'single' });
  assert.equal(s.phase, 'playing');
  assert.deepEqual(s.score, [0, 0]);
  assert.deepEqual(s.gamesWon, [0, 0]);
  assert.deepEqual(Engine.getDecision(s), { kind: 'startHand' });
  assert.deepEqual(Engine.legalActions(s), [{ type: 'START_HAND' }]);
  const bad = [
    { players: 3, seed: 1 },
    { players: 4, seed: 1, options: { deck: 'mineiro' } },
    { players: 4, seed: 1, options: { format: 'bestOf5' } },
    { players: 4, seed: 1, firstDealer: 4 },
    { players: 2, seed: 1, firstDealer: 2 },
    { players: 2, seed: 1, firstDealer: 0.5 },
  ];
  for (const cfg of bad) {
    assert.throws(() => Engine.createMatch(cfg), (e) => e.code === 'BAD_OPTIONS', JSON.stringify(cfg));
  }
});

test('primeiro carteador: sorteado com o PRNG, determinístico, cobre todos os assentos', () => {
  for (const players of [2, 4]) {
    const seen = new Set();
    for (let seed = 0; seed < 200; seed++) {
      const a = Engine.createMatch({ players, seed });
      const b = Engine.createMatch({ players, seed });
      assert.equal(a.firstDealer, b.firstDealer);
      assert.ok(a.firstDealer >= 0 && a.firstDealer < players);
      seen.add(a.firstDealer);
    }
    assert.equal(seen.size, players);
  }
  assert.equal(Engine.createMatch({ players: 4, seed: 5, firstDealer: 2 }).firstDealer, 2);
});

test('distribuição: 3 cartas por jogador + vira, distintas, do baralho certo; mão abre', () => {
  for (const deck of ['limpo', 'sujo']) {
    for (const players of [2, 4]) {
      for (let seed = 1; seed <= 30; seed++) {
        const s = Engine.createMatch({ players, seed, options: { deck } });
        const [ev] = startHand(s);
        assert.equal(ev.type, 'handStarted');
        assert.equal(ev.handNumber, 1);
        assert.equal(ev.dealer, s.firstDealer);
        assert.equal(ev.mao, (ev.dealer + 1) % players);
        assert.equal(ev.value, 1);
        assert.equal(ev.special, null);
        const ids = [ev.vira.id, ...ev.hands.flat().map((c) => c.id)];
        assert.equal(ids.length, 3 * players + 1);
        assert.equal(new Set(ids).size, ids.length);
        const deckIds = Rules.makeDeck(deck).map((c) => c.id);
        for (const id of ids) assert.ok(deckIds.includes(id), `${id} fora do baralho ${deck}`);
        assert.equal(ev.manilhaRank, Rules.manilhaRankFor(ev.vira.rank, deck));
        const d = Engine.getDecision(s);
        assert.equal(d.kind, 'play');
        assert.equal(d.seat, ev.mao);
        assert.equal(d.canFaceDown, false);
        assert.equal(d.blind, false);
      }
    }
  }
});

test('embaralhamento depende do seed; mesmo seed repete a partida inteira', () => {
  const run = (seed) => {
    const s = Engine.createMatch({ players: 4, seed });
    const rand = mulberry32(99);
    const log = [];
    while (s.phase !== 'matchOver') {
      const legal = Engine.legalActions(s);
      log.push(...Engine.apply(s, legal[Math.floor(rand() * legal.length)]));
    }
    return JSON.stringify(log);
  };
  assert.equal(run(123), run(123));
  assert.notEqual(run(123), run(124));
});

// ---------- Apêndice C ----------

test('Apêndice C.3 — empate entre times (vira Q): K, 3♠, 3♥, 2 → empate, abre o 1', () => {
  const s = newMatch();
  startHand(s);
  rig(s, 'Qc', [['Kc'], ['3s'], ['3h'], ['2d']]);
  const ev = playAll(s, [[0, 'Kc'], [1, '3s'], [2, '3h'], [3, '2d']]);
  const [r] = ofType(ev, 'roundEnded');
  assert.equal(r.tie, true);
  assert.equal(r.winnerTeam, null);
  assert.equal(r.winnerSeat, null);
  assert.equal(r.nextLeader, 1);
  assert.equal(r.winningCard.rank, '3');
  const d = Engine.getDecision(s);
  assert.equal(d.kind, 'play');
  assert.equal(d.seat, 1);
  assert.equal(d.canFaceDown, false, 'quem abre a rodada não encobre');
  assert.deepEqual(Engine.viewFor(s, 0).roundResults, ['tie']);

  const pure = Engine.resolveRound(
    [
      { seat: 0, card: C('Kc'), faceDown: false },
      { seat: 1, card: C('3s'), faceDown: false },
      { seat: 2, card: C('3h'), faceDown: false },
      { seat: 3, card: C('2d'), faceDown: false },
    ],
    'J',
    'limpo',
  );
  assert.equal(pure.tie, true);
  assert.equal(pure.nextLeader, 1);
});

test('Apêndice C.4 — parceiros com a mesma maior carta: 3♣, 2, 3♦, K → time 0, abre o 0', () => {
  const s = newMatch();
  startHand(s);
  rig(s, 'Qc', [['3c'], ['2h'], ['3d'], ['Kh']]);
  const ev = playAll(s, [[0, '3c'], [1, '2h'], [2, '3d'], [3, 'Kh']]);
  const [r] = ofType(ev, 'roundEnded');
  assert.equal(r.tie, false);
  assert.equal(r.winnerTeam, 0);
  assert.equal(r.winnerSeat, 0);
  assert.equal(r.nextLeader, 0);
  assert.equal(r.winningCard.id, '3c');
  assert.equal(Engine.getDecision(s).seat, 0);
});

test('Apêndice C.5 — carta encoberta (2ª rodada, vira A, manilha 2)', () => {
  const s = newMatch();
  startHand(s);
  rig(s, 'Ah', [['3c', 'Jc'], ['Kc', 'Kd'], ['Qh', 'Ks'], ['Qs', 'Qd']]);
  assert.equal(s.hand.manilhaRank, '2');

  // 1ª rodada: ninguém encobre.
  rejects(s, { type: 'PLAY', seat: 0, cardId: '3c', faceDown: true }, 'FACE_DOWN_NOT_ALLOWED');
  play(s, 0, '3c');
  assert.equal(Engine.getDecision(s).canFaceDown, false);
  rejects(s, { type: 'PLAY', seat: 1, cardId: 'Kc', faceDown: true }, 'FACE_DOWN_NOT_ALLOWED');
  play(s, 1, 'Kc');
  rejects(s, { type: 'PLAY', seat: 2, cardId: 'Qh', faceDown: true }, 'FACE_DOWN_NOT_ALLOWED');
  play(s, 2, 'Qh');
  rejects(s, { type: 'PLAY', seat: 3, cardId: 'Qs', faceDown: true }, 'FACE_DOWN_NOT_ALLOWED');
  const r1 = ofType(play(s, 3, 'Qs'), 'roundEnded')[0];
  assert.equal(r1.winnerSeat, 0);

  // 2ª rodada: o abridor (0) não encobre; os demais podem.
  assert.equal(Engine.getDecision(s).canFaceDown, false);
  rejects(s, { type: 'PLAY', seat: 0, cardId: 'Jc', faceDown: true }, 'FACE_DOWN_NOT_ALLOWED');
  play(s, 0, 'Jc');
  assert.equal(Engine.getDecision(s).canFaceDown, true);
  play(s, 1, 'Kd', true);
  play(s, 2, 'Ks', true);

  // O motor não revela as encobertas a ninguém além do dono.
  const v3 = Engine.viewFor(s, 3);
  assert.deepEqual(
    v3.rounds[1].plays.map((p) => [p.seat, p.card && p.card.id, p.faceDown]),
    [[0, 'Jc', false], [1, null, true], [2, null, true]],
  );
  assert.ok(!JSON.stringify(v3).includes('"Kd"'));
  assert.ok(!JSON.stringify(v3).includes('"Ks"'));
  assert.ok(!Engine.viewFor(s, 3).seenCards.some((c) => c.id === 'Kd' || c.id === 'Ks'));
  assert.equal(Engine.viewFor(s, 1).rounds[1].plays[1].card.id, 'Kd');
  assert.equal(Engine.viewFor(s, 0).rounds[1].plays[1].card, null);
  assert.equal(Engine.viewFor(s, 2).rounds[1].plays[1].card, null, 'nem o parceiro vê a encoberta');

  const ev = play(s, 3, 'Qd');
  const r2 = ofType(ev, 'roundEnded')[0];
  assert.equal(r2.winnerTeam, 0, 'J > Q; as encobertas (K) valem −1');
  assert.equal(r2.winnerSeat, 0);
  assert.equal(r2.nextLeader, 0);
  assert.equal(r2.winningCard.id, 'Jc');

  // Com as duas mais altas encobertas, a encoberta nunca empata nem vence.
  const pure = Engine.resolveRound(
    [
      { seat: 0, card: C('Qh'), faceDown: false },
      { seat: 1, card: C('2c'), faceDown: true },
      { seat: 2, card: C('Kd'), faceDown: false },
      { seat: 3, card: C('Kh'), faceDown: true },
    ],
    '2',
    'limpo',
  );
  assert.equal(pure.winnerTeam, 0);
  assert.equal(pure.winnerSeat, 2);
});

test('Apêndice C.6 — resolveHand (tabela §7.2 completa, com papéis trocados)', () => {
  const T = 'tie';
  const cases = [
    [[0, 0], 0], [[0, 1, 0], 0], [[0, 1, 1], 1], [[0, 1, T], 0], [[0, T], 0], [[T, 0], 0],
    [[T, T, 0], 0], [[T, T, T], 'none'],
    [[1, 1], 1], [[1, 0, 1], 1], [[1, 0, 0], 0], [[1, 0, T], 1], [[1, T], 1], [[T, 1], 1], [[T, T, 1], 1],
    [[0], null], [[1], null], [[T], null], [[0, 1], null], [[1, 0], null], [[T, T], null],
  ];
  for (const [results, expected] of cases) {
    assert.equal(Engine.resolveHand(results), expected, JSON.stringify(results));
  }
});

test('Apêndice C.6 — [0, EMPATE] → 0 sem 3ª rodada', () => {
  const s = newMatch();
  startHand(s);
  rig(s, 'Qc', [['3c', '2c'], ['Ks', '2h'], ['Qh', 'Kh'], ['Ad', 'Qs']]);
  const ev = playAll(s, [[0, '3c'], [1, 'Ks'], [2, 'Qh'], [3, 'Ad'], [0, '2c'], [1, '2h'], [2, 'Kh'], [3, 'Qs']]);
  assert.equal(ofType(ev, 'roundEnded').length, 2);
  const [h] = ofType(ev, 'handEnded');
  assert.deepEqual(h, { type: 'handEnded', winnerTeam: 0, points: 1, reason: 'rounds', score: [1, 0], roundWinners: [0, 'tie'] });
  assert.equal(s.hand.hands.every((cards) => cards.length === 1), true, 'a 3ª carta não é jogada');
  assert.deepEqual(Engine.getDecision(s), { kind: 'startHand' });
});

test('Apêndice C.6 — [EMPATE, 1] → 1', () => {
  const s = newMatch();
  startHand(s);
  rig(s, 'Qc', [['3c', 'Qh'], ['3d', 'Ah'], ['Kc', 'Ks'], ['Kd', 'Qs']]);
  const ev = playAll(s, [[0, '3c'], [1, '3d'], [2, 'Kc'], [3, 'Kd'], [0, 'Qh'], [1, 'Ah'], [2, 'Ks'], [3, 'Qs']]);
  const rounds = ofType(ev, 'roundEnded');
  assert.equal(rounds[0].tie, true);
  assert.equal(rounds[0].nextLeader, 0);
  const [h] = ofType(ev, 'handEnded');
  assert.equal(h.winnerTeam, 1);
  assert.deepEqual(h.roundWinners, ['tie', 1]);
  assert.deepEqual(s.score, [0, 1]);
});

test('Apêndice C.6 — [0, 1, EMPATE] → 0 (quem ganhou a 1ª)', () => {
  const s = newMatch();
  startHand(s);
  rig(s, 'Qc', [['3c', 'Qd', 'Ad'], ['Kd', 'Ah', '2d'], ['Qh', 'Kc', '2h'], ['Qs', 'Ks', 'Kh']]);
  const ev = playAll(s, [
    [0, '3c'], [1, 'Kd'], [2, 'Qh'], [3, 'Qs'],
    [0, 'Qd'], [1, 'Ah'], [2, 'Kc'], [3, 'Ks'],
    [1, '2d'], [2, '2h'], [3, 'Kh'], [0, 'Ad'],
  ]);
  const rounds = ofType(ev, 'roundEnded');
  assert.deepEqual(rounds.map((r) => r.nextLeader), [0, 1, 1]);
  assert.equal(rounds[2].tie, true);
  const [h] = ofType(ev, 'handEnded');
  assert.equal(h.winnerTeam, 0);
  assert.deepEqual(h.roundWinners, [0, 1, 'tie']);
});

test('Apêndice C.6 — [EMPATE, EMPATE, 1] → 1', () => {
  const s = newMatch();
  startHand(s);
  rig(s, 'Qc', [['3c', '2c', 'Ac'], ['3d', '2d', '3h'], ['Qh', 'Kh', 'Kc'], ['Qs', 'Ks', 'Kd']]);
  const ev = playAll(s, [
    [0, '3c'], [1, '3d'], [2, 'Qh'], [3, 'Qs'],
    [0, '2c'], [1, '2d'], [2, 'Kh'], [3, 'Ks'],
    [0, 'Ac'], [1, '3h'], [2, 'Kc'], [3, 'Kd'],
  ]);
  const [h] = ofType(ev, 'handEnded');
  assert.equal(h.winnerTeam, 1);
  assert.deepEqual(h.roundWinners, ['tie', 'tie', 1]);
});

test('Apêndice C.6 — três empates: ninguém pontua, mesmo valendo 3; o pé gira', () => {
  const s = newMatch();
  startHand(s);
  rig(s, 'Qc', [['3c', '2c', 'Ac'], ['3d', '2d', 'Ad'], ['Qh', 'Kh', 'Kc'], ['Qs', 'Ks', 'Kd']]);
  call(s, 0);
  answer(s, 'ACCEPT', 1);
  assert.equal(s.hand.value, 3);
  const ev = playAll(s, [
    [0, '3c'], [1, '3d'], [2, 'Qh'], [3, 'Qs'],
    [0, '2c'], [1, '2d'], [2, 'Kh'], [3, 'Ks'],
    [0, 'Ac'], [1, 'Ad'], [2, 'Kc'], [3, 'Kd'],
  ]);
  const [h] = ofType(ev, 'handEnded');
  assert.deepEqual(h, { type: 'handEnded', winnerTeam: null, points: 0, reason: 'allTied', score: [0, 0], roundWinners: ['tie', 'tie', 'tie'] });
  const [next] = startHand(s);
  assert.equal(next.dealer, 0);
  assert.equal(next.mao, 1);
});

test('empates também em 1x1 (2 jogadores): abre quem abriu a rodada empatada', () => {
  const s = newMatch({ players: 2 });
  startHand(s);
  rig(s, 'Qc', [['3c', 'Kh', 'Ah'], ['3d', 'Ks', '2s']]);
  let ev = playAll(s, [[0, '3c'], [1, '3d']]);
  assert.equal(ofType(ev, 'roundEnded')[0].tie, true);
  assert.equal(ofType(ev, 'roundEnded')[0].nextLeader, 0);
  ev = playAll(s, [[0, 'Kh'], [1, 'Ks']]);
  assert.equal(ofType(ev, 'roundEnded')[0].nextLeader, 0);
  ev = playAll(s, [[0, 'Ah'], [1, '2s']]);
  const [h] = ofType(ev, 'handEnded');
  assert.equal(h.winnerTeam, 1);
  assert.deepEqual(h.roundWinners, ['tie', 'tie', 1]);
});

test('Apêndice C.7 — corrida: pontos = último valor aceito', () => {
  // Truco, corre → +1.
  let s = newMatch();
  startHand(s);
  let ev = call(s, 0);
  assert.deepEqual(ev, [{ type: 'call', seat: 0, team: 0, from: 1, to: 3, name: 'Truco', isRaise: false }]);
  ev = answer(s, 'RUN', 1);
  assert.deepEqual(ev[0], { type: 'run', seat: 1, team: 1, awardedTeam: 0, points: 1 });
  assert.equal(ev[1].type, 'handEnded');
  assert.equal(ev[1].reason, 'run');
  assert.deepEqual(s.score, [1, 0]);

  // Truco, seis, corre → +3 para o time 1.
  s = newMatch();
  startHand(s);
  call(s, 0);
  ev = answer(s, 'RAISE', 1);
  assert.deepEqual(ev, [{ type: 'call', seat: 1, team: 1, from: 3, to: 6, name: 'Seis', isRaise: true }]);
  ev = answer(s, 'RUN', 0);
  assert.deepEqual(ev[0], { type: 'run', seat: 0, team: 0, awardedTeam: 1, points: 3 });
  assert.deepEqual(s.score, [0, 3]);

  // Truco, seis, nove, doze, corre → +9 para o time 1.
  s = newMatch();
  startHand(s);
  call(s, 0);
  answer(s, 'RAISE', 1);
  ev = answer(s, 'RAISE', 0);
  assert.deepEqual(ev[0], { type: 'call', seat: 0, team: 0, from: 6, to: 9, name: 'Nove', isRaise: true });
  ev = answer(s, 'RAISE', 3);
  assert.deepEqual(ev[0], { type: 'call', seat: 3, team: 1, from: 9, to: 12, name: 'Doze', isRaise: true });
  const d = Engine.getDecision(s);
  assert.equal(d.kind, 'callResponse');
  assert.equal(d.canRaise, false);
  assert.equal(d.raiseValue, null);
  assert.equal(d.currentValue, 9);
  assert.equal(d.proposedValue, 12);
  assert.ok(!Engine.legalActions(s).some((a) => a.type === 'RAISE'));
  rejects(s, { type: 'RAISE', seat: 0 }, 'RAISE_NOT_ALLOWED');
  ev = answer(s, 'RUN', 2);
  assert.deepEqual(ev[0], { type: 'run', seat: 2, team: 0, awardedTeam: 1, points: 9 });
  assert.deepEqual(s.score, [0, 9]);
});

test('Apêndice C.8 — alternância depois de truco aceito', () => {
  const s = newMatch();
  startHand(s);
  call(s, 0);
  const ev = answer(s, 'ACCEPT', 3);
  assert.deepEqual(ev, [{ type: 'accept', seat: 3, team: 1, value: 3 }]);
  // A vez não muda e o time 0 não pode pedir.
  let d = Engine.getDecision(s);
  assert.equal(d.kind, 'play');
  assert.equal(d.seat, 0);
  assert.equal(d.canCall, false);
  rejects(s, { type: 'CALL', seat: 0 }, 'CALL_NOT_ALLOWED');
  play(s, 0, d.playableCardIds[0]);
  d = Engine.getDecision(s);
  assert.equal(d.seat, 1);
  assert.equal(d.canCall, true);
  assert.equal(d.callValue, 6);
  assert.equal(d.callName, 'Seis');
  play(s, 1, d.playableCardIds[0]);
  d = Engine.getDecision(s);
  assert.equal(d.seat, 2);
  assert.equal(d.canCall, false);
  rejects(s, { type: 'CALL', seat: 2 }, 'CALL_NOT_ALLOWED');
  play(s, 2, d.playableCardIds[0]);
  d = Engine.getDecision(s);
  assert.equal(d.seat, 3);
  assert.equal(d.canCall, true);
  assert.equal(Engine.canCall(s, 3), true);
  for (const seat of [0, 1, 2]) assert.equal(Engine.canCall(s, seat), false);
});

test('Apêndice C.8 — depois de "time 1 seis, time 0 aceita", só o time 0 pede nove (aumento posterior)', () => {
  const s = newMatch();
  startHand(s);
  call(s, 0);
  answer(s, 'ACCEPT', 1);
  play(s, 0, Engine.getDecision(s).playableCardIds[0]);
  // Aumento posterior: o time 1 pede seis na sua vez.
  call(s, 1);
  let d = Engine.getDecision(s);
  assert.equal(d.kind, 'callResponse');
  assert.equal(d.team, 0);
  assert.deepEqual(d.seats, [2, 0], 'respondente designado: primeiro do time desafiado a partir da vez');
  assert.equal(d.callerSeat, 1);
  assert.equal(d.currentValue, 3);
  assert.equal(d.proposedValue, 6);
  assert.equal(d.callName, 'Seis');
  assert.equal(d.canRaise, true);
  assert.equal(d.raiseValue, 9);
  assert.equal(d.raiseName, 'Nove');
  answer(s, 'ACCEPT', 0);
  assert.equal(s.hand.value, 6);
  assert.equal(Engine.viewFor(s, 0).lastCallTeam, 1);
  const checked = [];
  playOut(s, (dec) => {
    // O assento 1 já iniciou pedido nesta vez; depois disso só o time 0 tem direito a pedir.
    assert.equal(dec.canCall, Engine.teamOf(dec.seat) === 0, `assento ${dec.seat}`);
    if (dec.canCall) assert.equal(dec.callValue, 9);
    checked.push(dec.seat);
  });
  assert.ok(checked.length >= 3);
});

test('§8.3(6): no máximo uma sequência de pedido iniciada por vez', () => {
  const s = newMatch();
  startHand(s);
  call(s, 0);
  answer(s, 'RAISE', 1);
  answer(s, 'ACCEPT', 2);
  assert.equal(s.hand.value, 6);
  const d = Engine.getDecision(s);
  assert.equal(d.seat, 0);
  assert.equal(d.canCall, false, 'o time 0 teria direito pela alternância, mas já iniciou pedido nesta vez');
  rejects(s, { type: 'CALL', seat: 0 }, 'CALL_NOT_ALLOWED');
  play(s, 0, d.playableCardIds[0]);
  assert.equal(Engine.getDecision(s).canCall, false, 'time 1 fez o último pedido');
  play(s, 1, Engine.getDecision(s).playableCardIds[0]);
  assert.equal(Engine.getDecision(s).canCall, true, 'na vez seguinte o time 0 pode pedir nove');
  assert.equal(Engine.getDecision(s).callValue, 9);
});

test('pedido: só na própria vez; parceiro não pede; resposta só do time desafiado', () => {
  const s = newMatch();
  startHand(s);
  rejects(s, { type: 'CALL', seat: 2 }, 'NOT_YOUR_TURN');
  rejects(s, { type: 'CALL', seat: 1 }, 'NOT_YOUR_TURN');
  rejects(s, { type: 'ACCEPT', seat: 1 }, 'UNEXPECTED_ACTION');
  rejects(s, { type: 'RUN', seat: 1 }, 'UNEXPECTED_ACTION');
  call(s, 0);
  const d = Engine.getDecision(s);
  assert.deepEqual(d.seats, [1, 3]);
  rejects(s, { type: 'ACCEPT', seat: 0 }, 'WRONG_TEAM');
  rejects(s, { type: 'ACCEPT', seat: 2 }, 'WRONG_TEAM');
  rejects(s, { type: 'RUN', seat: 2 }, 'WRONG_TEAM');
  rejects(s, { type: 'RAISE', seat: 0 }, 'WRONG_TEAM');
  rejects(s, { type: 'PLAY', seat: 0, cardId: s.hand.hands[0][0].id }, 'UNEXPECTED_ACTION');
  rejects(s, { type: 'CALL', seat: 0 }, 'UNEXPECTED_ACTION');
  rejects(s, { type: 'START_HAND' }, 'UNEXPECTED_ACTION');
  assert.deepEqual(
    Engine.legalActions(s),
    [
      { type: 'ACCEPT', seat: 1 }, { type: 'RUN', seat: 1 }, { type: 'RAISE', seat: 1 },
      { type: 'ACCEPT', seat: 3 }, { type: 'RUN', seat: 3 }, { type: 'RAISE', seat: 3 },
    ],
  );
  // Qualquer jogador do time desafiado pode responder (vale a primeira resposta).
  answer(s, 'ACCEPT', 3);
  assert.equal(Engine.getDecision(s).kind, 'play');
});

test('Apêndice C.9 — valor 12: ninguém pede', () => {
  const s = newMatch();
  startHand(s);
  call(s, 0);
  answer(s, 'RAISE', 1);
  answer(s, 'RAISE', 2);
  answer(s, 'RAISE', 3);
  answer(s, 'ACCEPT', 0);
  assert.equal(s.hand.value, 12);
  const ev = playOut(s, (d) => {
    assert.equal(d.canCall, false);
    assert.equal(d.callValue, null);
    for (let seat = 0; seat < 4; seat++) assert.equal(Engine.canCall(s, seat), false);
    rejects(s, { type: 'CALL', seat: d.seat }, 'CALL_NOT_ALLOWED');
  });
  const [h] = ofType(ev, 'handEnded');
  assert.ok(h.winnerTeam === null || h.points === 12);
});

test('Apêndice C.9 — 10x5 + mão de 3 vencida pelo time 0 → 13x5, fim de jogo', () => {
  const s = newMatch();
  startHand(s, [10, 5]);
  rig(s, 'Qc', [['3c', '3h'], ['Kd', 'Ks'], ['Qh', 'Kc'], ['Qs', 'Ad']]);
  call(s, 0);
  answer(s, 'ACCEPT', 1);
  const ev = playAll(s, [[0, '3c'], [1, 'Kd'], [2, 'Qh'], [3, 'Qs'], [0, '3h'], [1, 'Ks'], [2, 'Kc'], [3, 'Ad']]);
  assert.deepEqual(ev.slice(-3).map((e) => e.type), ['handEnded', 'gameEnded', 'matchEnded']);
  assert.deepEqual(ofType(ev, 'handEnded')[0].score, [13, 5]);
  assert.deepEqual(ofType(ev, 'gameEnded')[0], { type: 'gameEnded', winnerTeam: 0, score: [13, 5], gamesWon: [1, 0] });
  assert.deepEqual(ofType(ev, 'matchEnded')[0], { type: 'matchEnded', winnerTeam: 0, score: [13, 5], gamesWon: [1, 0] });
  assert.deepEqual(s.score, [13, 5], 'o motor guarda o placar real');
  assert.deepEqual(Engine.viewFor(s, 0).score.map((x) => Math.min(x, 12)), [12, 5], 'a interface exibe 12x5');
  assert.equal(s.phase, 'matchOver');
  assert.deepEqual(Engine.getDecision(s), { kind: 'matchOver', winnerTeam: 0 });
  assert.deepEqual(Engine.legalActions(s), []);
  rejects(s, { type: 'START_HAND' }, 'MATCH_OVER');
});

test('§8.9 — placar 10: pode trucar e aumentar normalmente', () => {
  const s = newMatch();
  startHand(s, [10, 10]);
  assert.equal(s.hand.special, null);
  const d = Engine.getDecision(s);
  assert.equal(d.canCall, true);
  call(s, 0);
  answer(s, 'RAISE', 1);
  answer(s, 'RUN', 0);
  assert.deepEqual(s.score, [10, 13]);
  assert.equal(s.phase, 'matchOver');
});

test('Apêndice C.10 — mão de onze: 11x7, T11 corre → 11x8 e a próxima é de onze', () => {
  const s = newMatch();
  const [hs] = startHand(s, [11, 7]);
  assert.equal(hs.special, 'maoDeOnze');
  assert.equal(hs.specialTeam, 0);
  assert.equal(hs.value, 1);
  const d = Engine.getDecision(s);
  assert.deepEqual(d, { kind: 'maoDeOnze', team: 0, seats: [0, 2] });
  assert.deepEqual(Engine.legalActions(s), [
    { type: 'MAO_DE_ONZE', seat: 0, accept: true }, { type: 'MAO_DE_ONZE', seat: 0, accept: false },
    { type: 'MAO_DE_ONZE', seat: 2, accept: true }, { type: 'MAO_DE_ONZE', seat: 2, accept: false },
  ]);
  rejects(s, { type: 'MAO_DE_ONZE', seat: 1, accept: false }, 'WRONG_TEAM');
  rejects(s, { type: 'MAO_DE_ONZE', seat: 0 }, 'BAD_ACTION');
  rejects(s, { type: 'PLAY', seat: 0, cardId: s.hand.hands[0][0].id }, 'UNEXPECTED_ACTION');
  rejects(s, { type: 'CALL', seat: 0 }, 'UNEXPECTED_ACTION');
  const ev = onze(s, 2, false);
  assert.deepEqual(ev[0], { type: 'maoDeOnzeDecided', team: 0, seat: 2, accept: false, value: 1 });
  assert.deepEqual(ev[1], { type: 'handEnded', winnerTeam: 1, points: 1, reason: 'maoDeOnzeRun', score: [11, 8], roundWinners: [] });
  assert.equal(ev.length, 2);
  const [next] = startHand(s);
  assert.equal(next.special, 'maoDeOnze');
  assert.equal(next.specialTeam, 0);
  assert.equal(next.dealer, 0, 'rotação normal');
});

test('Apêndice C.10 — 11x8, T11 joga e perde → 11x11 e a próxima é de ferro', () => {
  const s = newMatch();
  startHand(s, [11, 8]);
  rig(s, 'Qc', [['Qh', 'Ks'], ['3c', '3d'], ['Qs', 'Kc'], ['Kd', 'Ad']]);
  const ev0 = onze(s, 0, true);
  assert.deepEqual(ev0, [{ type: 'maoDeOnzeDecided', team: 0, seat: 0, accept: true, value: 3 }]);
  assert.equal(s.hand.value, 3);
  const noCalls = (d) => {
    assert.equal(d.canCall, false);
    for (let seat = 0; seat < 4; seat++) assert.equal(Engine.canCall(s, seat), false);
    rejects(s, { type: 'CALL', seat: d.seat }, 'CALL_NOT_ALLOWED');
  };
  const ev = [];
  for (const [seat, id] of [[0, 'Qh'], [1, '3c'], [2, 'Qs'], [3, 'Kd'], [1, '3d'], [2, 'Kc'], [3, 'Ad'], [0, 'Ks']]) {
    noCalls(Engine.getDecision(s));
    ev.push(...play(s, seat, id));
  }
  const [h] = ofType(ev, 'handEnded');
  assert.equal(h.winnerTeam, 1);
  assert.equal(h.points, 3);
  assert.deepEqual(h.score, [11, 11]);
  const [next] = startHand(s);
  assert.equal(next.special, 'maoDeFerro');
  assert.equal(next.specialTeam, null);
});

test('Apêndice C.10 — 11x7, T11 joga e vence → 14x7, fim de jogo', () => {
  const s = newMatch();
  startHand(s, [11, 7]);
  rig(s, 'Qc', [['3c', '3h'], ['Kd', 'Ks'], ['Qh', 'Kc'], ['Qs', 'Ad']]);
  onze(s, 0, true);
  const ev = [];
  for (const [seat, id] of [[0, '3c'], [1, 'Kd'], [2, 'Qh'], [3, 'Qs'], [0, '3h'], [1, 'Ks'], [2, 'Kc'], [3, 'Ad']]) {
    assert.equal(Engine.getDecision(s).canCall, false);
    ev.push(...play(s, seat, id));
  }
  assert.deepEqual(ofType(ev, 'handEnded')[0].score, [14, 7]);
  assert.equal(ofType(ev, 'gameEnded')[0].winnerTeam, 0);
  assert.equal(s.phase, 'matchOver');
});

test('Apêndice C.10 — mão de onze: ninguém pede em nenhuma vez (time 1 com 11, 4 jogadores)', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = newMatch({ seed });
    startHand(s, [7, 11]);
    assert.deepEqual(Engine.getDecision(s), { kind: 'maoDeOnze', team: 1, seats: [1, 3] });
    onze(s, 3, true);
    playOut(s, (d) => {
      assert.equal(d.canCall, false);
      for (let seat = 0; seat < 4; seat++) assert.equal(Engine.canCall(s, seat), false);
      assert.ok(!Engine.legalActions(s).some((a) => a.type === 'CALL'));
      rejects(s, { type: 'CALL', seat: d.seat }, 'CALL_NOT_ALLOWED');
    });
  }
});

test('mão de onze: encoberta segue a regra geral', () => {
  const s = newMatch();
  startHand(s, [11, 3]);
  rig(s, 'Qc', [['3c', 'Kh'], ['Kd', 'Ks'], ['Qh', 'Kc'], ['Qs', 'Ad']]);
  onze(s, 0, true);
  playAll(s, [[0, '3c'], [1, 'Kd'], [2, 'Qh'], [3, 'Qs'], [0, 'Kh']]);
  assert.equal(Engine.getDecision(s).canFaceDown, true);
  play(s, 1, 'Ks', true);
  assert.equal(Engine.viewFor(s, 0).rounds[1].plays[1].card, null);
});

test('mão de onze: time com 11 vê a mão do parceiro só durante a decisão (4 jogadores)', () => {
  const s = newMatch();
  startHand(s, [11, 4]);
  const hands = s.hand.hands.map((h) => h.map((c) => c.id));
  const v0 = Engine.viewFor(s, 0);
  const v2 = Engine.viewFor(s, 2);
  assert.deepEqual(v0.partnerHand.map((c) => c.id), hands[2]);
  assert.deepEqual(v2.partnerHand.map((c) => c.id), hands[0]);
  for (const seat of [1, 3]) {
    const v = Engine.viewFor(s, seat);
    assert.equal(v.partnerHand, null);
    const json = JSON.stringify(v);
    for (const other of [0, 2, (seat + 2) % 4]) for (const id of hands[other]) assert.ok(!json.includes(`"${id}"`));
  }
  // O time com 11 não vê as cartas dos adversários.
  for (const id of [...hands[1], ...hands[3]]) assert.ok(!JSON.stringify(v0).includes(`"${id}"`));
  onze(s, 0, true);
  assert.equal(Engine.viewFor(s, 0).partnerHand, null);
  assert.equal(Engine.viewFor(s, 2).partnerHand, null);
  for (const id of hands[2]) assert.ok(!JSON.stringify(Engine.viewFor(s, 0)).includes(`"${id}"`));
});

test('mão de onze em 1x1: sem parceiro; correr dá +1 ao adversário', () => {
  const s = newMatch({ players: 2 });
  startHand(s, [4, 11]);
  assert.deepEqual(Engine.getDecision(s), { kind: 'maoDeOnze', team: 1, seats: [1] });
  assert.equal(Engine.viewFor(s, 1).partnerHand, null);
  const ev = onze(s, 1, false);
  assert.equal(ev[1].winnerTeam, 0);
  assert.deepEqual(s.score, [5, 11]);
});

test('Apêndice C.11 — mão de ferro: às cegas, sem pedidos; três empates → nova mão de ferro', () => {
  const s = newMatch();
  const [hs] = startHand(s, [11, 11]);
  assert.equal(hs.special, 'maoDeFerro');
  assert.equal(hs.value, 1);
  rig(s, 'Qc', [['3c', '2c', 'Ac'], ['3d', '2d', 'Ad'], ['Qh', 'Kh', 'Kc'], ['Qs', 'Ks', 'Kd']]);
  for (let seat = 0; seat < 4; seat++) {
    const v = Engine.viewFor(s, seat);
    assert.equal(v.blind, true);
    assert.deepEqual(v.myHand, [{ hidden: true, index: 0 }, { hidden: true, index: 1 }, { hidden: true, index: 2 }]);
    assert.equal(v.partnerHand, null);
    const json = JSON.stringify(v);
    for (const cards of s.hand.hands) for (const c of cards) assert.ok(!json.includes(`"${c.id}"`), `vazou ${c.id} para ${seat}`);
  }
  const d = Engine.getDecision(s);
  assert.equal(d.blind, true);
  assert.equal(d.canCall, false);
  assert.equal(d.canFaceDown, false);
  assert.deepEqual(d.playableCardIds, []);
  assert.deepEqual(d.playableIndexes, [0, 1, 2]);
  assert.deepEqual(Engine.legalActions(s), [0, 1, 2].map((index) => ({ type: 'PLAY', seat: 0, index, faceDown: false })));
  rejects(s, { type: 'CALL', seat: 0 }, 'CALL_NOT_ALLOWED');

  const ev = [];
  for (let i = 0; i < 12; i++) {
    const dec = Engine.getDecision(s);
    assert.equal(dec.canCall, false);
    for (let seat = 0; seat < 4; seat++) assert.equal(Engine.canCall(s, seat), false);
    if (dec.seat !== s.hand.rounds[s.hand.roundIndex].leader) {
      assert.equal(dec.canFaceDown, false);
      rejects(s, { type: 'PLAY', seat: dec.seat, index: 0, faceDown: true }, 'FACE_DOWN_NOT_ALLOWED');
    }
    ev.push(...Engine.apply(s, { type: 'PLAY', seat: dec.seat, index: 0 }));
  }
  const played = ofType(ev, 'cardPlayed');
  assert.ok(played.every((e) => e.blind === true && e.faceDown === false));
  assert.deepEqual(played.slice(0, 4).map((e) => e.card.id), ['3c', '3d', 'Qh', 'Qs']);
  // Carta jogada é revelada (face para cima) a todos.
  const [h] = ofType(ev, 'handEnded');
  assert.equal(h.reason, 'allTied');
  assert.deepEqual(s.score, [11, 11]);
  const [next] = startHand(s);
  assert.equal(next.special, 'maoDeFerro');
  assert.equal(next.dealer, 0, 'o pé avança');
});

test('mão de ferro: PLAY por cardId é rejeitado (joga-se às cegas, por posição)', () => {
  for (const players of [2, 4]) {
    const s = newMatch({ players });
    startHand(s, [11, 11]);
    assert.equal(s.hand.special, 'maoDeFerro');
    const seat = Engine.getDecision(s).seat;
    const id = s.hand.hands[seat][1].id;
    rejects(s, { type: 'PLAY', seat, cardId: id }, 'BAD_ACTION');
    rejects(s, { type: 'PLAY', seat, cardId: id, index: 1 }, 'BAD_ACTION');
    // O mesmo lance por posição funciona e joga a carta daquela posição.
    const ev = Engine.apply(s, { type: 'PLAY', seat, index: 1 });
    const [played] = ofType(ev, 'cardPlayed');
    assert.equal(played.card.id, id);
    assert.equal(played.blind, true);
  }
  // Fora da mão de ferro, o cardId continua valendo.
  const t = newMatch({ players: 2 });
  startHand(t);
  const seat = Engine.getDecision(t).seat;
  assert.equal(ofType(play(t, seat, t.hand.hands[seat][0].id), 'cardPlayed').length, 1);
});

test('mão de ferro: quem vence chega a 12 e vence o jogo', () => {
  const s = newMatch({ players: 2 });
  startHand(s, [11, 11]);
  rig(s, 'Qc', [['3c', '3h'], ['Kd', 'Ks']]);
  const ev = [];
  for (let i = 0; i < 4; i++) ev.push(...Engine.apply(s, { type: 'PLAY', seat: Engine.getDecision(s).seat, index: 0 }));
  assert.deepEqual(ofType(ev, 'handEnded')[0].score, [12, 11]);
  assert.equal(ofType(ev, 'matchEnded')[0].winnerTeam, 0);
});

// ---------- rotação e formato ----------

test('rotação do pé em toda mão: vencida, corrida, três empates e mão de onze corrida', () => {
  const s = newMatch({ firstDealer: 2 });
  const dealers = [];
  const record = (ev) => dealers.push(ofType(ev, 'handStarted')[0].dealer);
  record(startHand(s));
  awardHand(s, 0, 1); // corrida
  record(startHand(s));
  playOut(s); // mão jogada até o fim
  record(startHand(s, [11, 2]));
  onze(s, Engine.getDecision(s).seats[0], false); // mão de onze corrida
  record(startHand(s, [3, 3]));
  rig(s, 'Qc', [['3c', '2c', 'Ac'], ['3d', '2d', 'Ad'], ['Qh', 'Kh', 'Kc'], ['Qs', 'Ks', 'Kd']]);
  assert.equal(s.hand.mao, 2);
  // Jogando sempre a 1ª carta restante, as três rodadas empatam (3♣×3♦, 2♣×2♦, A♣×A♦).
  const tied = [];
  for (let i = 0; i < 12; i++) tied.push(...Engine.apply(s, { type: 'PLAY', seat: Engine.getDecision(s).seat, index: 0 }));
  assert.equal(ofType(tied, 'handEnded')[0].reason, 'allTied');
  record(startHand(s));
  assert.deepEqual(dealers, [2, 3, 0, 1, 2]);
});

test('melhor de 3: placar volta a 0x0, pé continua, partida termina com 2 jogos', () => {
  const s = Engine.createMatch({ players: 2, seed: 3, firstDealer: 0, options: { format: 'bestOf3' } });
  let lastDealer = null;
  const nextHand = (score) => {
    const [ev] = startHand(s, score);
    if (lastDealer !== null) assert.equal(ev.dealer, (lastDealer + 1) % 2);
    lastDealer = ev.dealer;
  };

  nextHand([10, 4]);
  let ev = awardHand(s, 0, 3);
  assert.deepEqual(ev.slice(-2).map((e) => e.type), ['handEnded', 'gameEnded']);
  assert.deepEqual(ofType(ev, 'gameEnded')[0], { type: 'gameEnded', winnerTeam: 0, score: [13, 4], gamesWon: [1, 0] });
  assert.deepEqual(s.score, [0, 0]);
  assert.deepEqual(s.gamesWon, [1, 0]);
  assert.equal(s.phase, 'playing');
  assert.equal(s.gameNumber, 2);
  assert.deepEqual(Engine.getDecision(s), { kind: 'startHand' });
  assert.deepEqual(Engine.viewFor(s, 0).gamesWon, [1, 0]);

  nextHand();
  assert.equal(s.hand.special, null);
  awardHand(s, 1, 1);
  assert.deepEqual(s.score, [0, 1]);
  nextHand([2, 10]);
  ev = awardHand(s, 1, 3);
  assert.equal(ofType(ev, 'matchEnded').length, 0);
  assert.deepEqual(s.gamesWon, [1, 1]);
  assert.deepEqual(s.score, [0, 0]);

  nextHand([9, 0]);
  ev = awardHand(s, 0, 3);
  assert.deepEqual(ev.slice(-3).map((e) => e.type), ['handEnded', 'gameEnded', 'matchEnded']);
  assert.deepEqual(ofType(ev, 'matchEnded')[0], { type: 'matchEnded', winnerTeam: 0, score: [12, 0], gamesWon: [2, 1] });
  assert.equal(s.phase, 'matchOver');
  assert.deepEqual(s.score, [12, 0]);
});

// ---------- validação ----------

test('ações ilegais lançam Error com code e não alteram o estado', () => {
  const s = newMatch();
  rejects(s, null, 'BAD_ACTION');
  rejects(s, {}, 'BAD_ACTION');
  rejects(s, { type: 'DANCE' }, 'BAD_ACTION');
  rejects(s, { type: 'PLAY', seat: 0, cardId: 'Qc' }, 'UNEXPECTED_ACTION');
  rejects(s, { type: 'CALL', seat: 0 }, 'UNEXPECTED_ACTION');
  startHand(s);
  const mine = s.hand.hands[0].map((c) => c.id);
  const other = s.hand.hands[1][0].id;
  rejects(s, { type: 'START_HAND' }, 'UNEXPECTED_ACTION');
  rejects(s, { type: 'PLAY', seat: 4, cardId: mine[0] }, 'BAD_SEAT');
  rejects(s, { type: 'PLAY', seat: -1, cardId: mine[0] }, 'BAD_SEAT');
  rejects(s, { type: 'PLAY', seat: '0', cardId: mine[0] }, 'BAD_SEAT');
  rejects(s, { type: 'PLAY', cardId: mine[0] }, 'BAD_SEAT');
  rejects(s, { type: 'PLAY', seat: 1, cardId: other }, 'NOT_YOUR_TURN');
  rejects(s, { type: 'PLAY', seat: 0, cardId: other }, 'CARD_NOT_IN_HAND');
  rejects(s, { type: 'PLAY', seat: 0, cardId: s.hand.vira.id }, 'CARD_NOT_IN_HAND');
  rejects(s, { type: 'PLAY', seat: 0, cardId: '9c' }, 'CARD_NOT_IN_HAND');
  rejects(s, { type: 'PLAY', seat: 0, cardId: 42 }, 'CARD_NOT_IN_HAND');
  rejects(s, { type: 'PLAY', seat: 0 }, 'BAD_ACTION');
  rejects(s, { type: 'PLAY', seat: 0, index: 3 }, 'BAD_INDEX');
  rejects(s, { type: 'PLAY', seat: 0, index: -1 }, 'BAD_INDEX');
  rejects(s, { type: 'PLAY', seat: 0, index: 1.5 }, 'BAD_INDEX');
  rejects(s, { type: 'PLAY', seat: 0, cardId: mine[0], index: 1 }, 'BAD_ACTION');
  rejects(s, { type: 'PLAY', seat: 0, cardId: mine[0], faceDown: 'sim' }, 'BAD_ACTION');
  rejects(s, { type: 'PLAY', seat: 0, cardId: mine[0], faceDown: true }, 'FACE_DOWN_NOT_ALLOWED');
  rejects(s, { type: 'MAO_DE_ONZE', seat: 0, accept: true }, 'UNEXPECTED_ACTION');
  // index e cardId coerentes são aceitos; index sozinho também.
  const ev = Engine.apply(s, { type: 'PLAY', seat: 0, cardId: mine[1], index: 1 });
  assert.equal(ev[0].card.id, mine[1]);
  const idx = Engine.apply(s, { type: 'PLAY', seat: 1, index: 0 });
  assert.equal(idx[0].card.id, other);
});

// ---------- visão ----------

test('viewFor: só as próprias cartas; encobertas só para o dono; nada revelado ao fim da mão', () => {
  const s = newMatch();
  startHand(s);
  rig(s, 'Qc', [['3c', 'Kh', 'Ah'], ['Kd', 'Ks', '2s'], ['Qh', 'Kc', 'Ac'], ['Qs', 'Ad', 'Qd']]);
  for (let seat = 0; seat < 4; seat++) {
    const v = Engine.viewFor(s, seat);
    assert.deepEqual(v.myHand, s.hand.hands[seat]);
    assert.deepEqual(v.handSizes, [3, 3, 3, 3]);
    assert.equal(v.turn, 0);
    assert.deepEqual(v.seenCards, [C('Qc')]);
    const json = JSON.stringify(v);
    for (let other = 0; other < 4; other++) {
      if (other === seat) continue;
      for (const c of s.hand.hands[other]) assert.ok(!json.includes(`"${c.id}"`));
    }
  }
  // Mutar a view não altera o estado.
  const v = Engine.viewFor(s, 0);
  v.myHand[0].id = 'XX';
  v.score[0] = 99;
  assert.equal(s.hand.hands[0][0].id, '3c');
  assert.equal(s.score[0], 0);

  playAll(s, [[0, '3c'], [1, 'Kd'], [2, 'Qh'], [3, 'Qs'], [0, 'Kh'], [1, 'Ks', true]]);
  const v2 = Engine.viewFor(s, 2);
  assert.deepEqual(v2.seenCards.map((c) => c.id), ['Qc', '3c', 'Kd', 'Qh', 'Qs', 'Kh']);
  assert.equal(v2.rounds[1].plays[1].card, null);
  assert.equal(Engine.viewFor(s, 1).rounds[1].plays[1].card.id, 'Ks');
  assert.deepEqual(v2.handSizes, [1, 1, 2, 2]);
  const ev = playAll(s, [[2, 'Kc'], [3, 'Qd']]);
  assert.equal(ofType(ev, 'handEnded')[0].winnerTeam, 0, '3 na 1ª; K×K do mesmo time na 2ª');
  for (let seat = 0; seat < 4; seat++) {
    const json = JSON.stringify(Engine.viewFor(s, seat));
    for (let other = 0; other < 4; other++) {
      if (other === seat) continue;
      for (const c of s.hand.hands[other]) assert.ok(!json.includes(`"${c.id}"`), `carta não jogada ${c.id} revelada`);
    }
    if (seat !== 1) assert.ok(!json.includes('"Ks"'));
    assert.equal(Engine.viewFor(s, seat).turn, null);
  }
  assert.throws(() => Engine.viewFor(s, 4), (e) => e.code === 'BAD_SEAT');
});

test('viewFor antes da primeira mão e pedido pendente', () => {
  const s = newMatch();
  const v = Engine.viewFor(s, 0);
  assert.equal(v.vira, null);
  assert.deepEqual(v.myHand, []);
  assert.equal(v.dealer, 3);
  assert.equal(v.mao, 0);
  startHand(s);
  call(s, 0);
  const vp = Engine.viewFor(s, 1);
  assert.deepEqual(vp.pendingCall, { callerSeat: 0, callerTeam: 0, proposedValue: 3, currentValue: 1 });
  assert.equal(vp.lastCallTeam, 0);
  assert.equal(vp.turn, 0);
  assert.equal(vp.value, 1);
});

// ---------- serialização ----------

test('estado JSON-serializável; clone independente; continuar do JSON dá o mesmo resultado', () => {
  const s = Engine.createMatch({ players: 4, seed: 77, options: { deck: 'sujo', format: 'bestOf3' } });
  const rand = mulberry32(5);
  for (let i = 0; i < 60; i++) {
    const legal = Engine.legalActions(s);
    Engine.apply(s, legal[Math.floor(rand() * legal.length)]);
  }
  const copy = JSON.parse(JSON.stringify(s));
  assert.deepEqual(copy, s);
  const cl = Engine.clone(s);
  assert.deepEqual(cl, s);
  cl.score[0] = 50;
  assert.notEqual(s.score[0], 50);
  const randA = mulberry32(8);
  const randB = mulberry32(8);
  const logA = [];
  const logB = [];
  while (s.phase !== 'matchOver') {
    const la = Engine.legalActions(s);
    const lb = Engine.legalActions(copy);
    assert.deepEqual(la, lb);
    logA.push(...Engine.apply(s, la[Math.floor(randA() * la.length)]));
    logB.push(...Engine.apply(copy, lb[Math.floor(randB() * lb.length)]));
  }
  assert.deepEqual(logA, logB);
  assert.deepEqual(copy, s);
});

// ---------- legalActions × apply ----------

function actionKey(state, a) {
  if (a.type === 'PLAY') {
    // Na mão de ferro só vale jogar por posição: PLAY com cardId nunca coincide com uma ação legal.
    if (a.cardId !== undefined && state.hand && state.hand.special === 'maoDeFerro') return `PLAY-ID|${a.seat}|${a.cardId}`;
    let id = a.cardId;
    if (a.index !== undefined) {
      const cards = state.hand && state.hand.hands[a.seat];
      id = cards && cards[a.index] ? cards[a.index].id : `#${a.index}`;
    }
    return `PLAY|${a.seat}|${id}|${a.faceDown ? 1 : 0}`;
  }
  if (a.type === 'MAO_DE_ONZE') return `MAO_DE_ONZE|${a.seat}|${a.accept}`;
  if (a.type === 'START_HAND') return 'START_HAND';
  return `${a.type}|${a.seat}`;
}

function candidateActions(state) {
  const ids = Rules.makeDeck('sujo').map((c) => c.id);
  const out = [{ type: 'START_HAND' }];
  for (let seat = -1; seat <= state.players; seat++) {
    for (const type of ['CALL', 'ACCEPT', 'RUN', 'RAISE']) out.push({ type, seat });
    out.push({ type: 'MAO_DE_ONZE', seat, accept: true }, { type: 'MAO_DE_ONZE', seat, accept: false });
    for (const cardId of ids) for (const faceDown of [false, true]) out.push({ type: 'PLAY', seat, cardId, faceDown });
    for (let index = 0; index < 4; index++) for (const faceDown of [false, true]) out.push({ type: 'PLAY', seat, index, faceDown });
  }
  return out;
}

test('legalActions ⊆ ações aceitas por apply; toda ação fora dela é rejeitada (amostragem)', () => {
  const rand = mulberry32(2024);
  let sampled = 0;
  let accepted = 0;
  let rejected = 0;
  const kinds = new Set();
  for (let m = 0; m < 48; m++) {
    const cfg = {
      players: m % 2 ? 4 : 2,
      seed: 500 + m,
      options: { deck: m % 4 < 2 ? 'limpo' : 'sujo', format: m % 8 < 4 ? 'single' : 'bestOf3' },
    };
    const s = Engine.createMatch(cfg);
    let step = 0;
    while (s.phase !== 'matchOver') {
      // Força mãos especiais de vez em quando para amostrar essas etapas.
      if (Engine.getDecision(s).kind === 'startHand' && rand() < 0.15) {
        const r = rand();
        s.score = r < 0.33 ? [11, s.score[1] % 11] : r < 0.66 ? [s.score[0] % 11, 11] : [11, 11];
      }
      const legal = Engine.legalActions(s);
      if (step % 3 === 0 || Engine.getDecision(s).kind !== 'play' || s.hand.special) {
        sampled++;
        kinds.add(Engine.getDecision(s).kind + (s.hand && s.hand.special ? `:${s.hand.special}` : ''));
        const legalKeys = new Set(legal.map((a) => actionKey(s, a)));
        assert.equal(legalKeys.size, legal.length, 'legalActions sem duplicatas');
        for (const a of legal) {
          Engine.apply(Engine.clone(s), a);
          accepted++;
        }
        const before = JSON.stringify(s);
        for (const a of candidateActions(s)) {
          const key = actionKey(s, a);
          if (legalKeys.has(key)) {
            Engine.apply(Engine.clone(s), a);
            accepted++;
          } else {
            assert.throws(() => Engine.apply(s, a), (e) => typeof e.code === 'string', `${JSON.stringify(a)} deveria ser rejeitada`);
            rejected++;
          }
        }
        assert.equal(JSON.stringify(s), before);
      }
      Engine.apply(s, legal[Math.floor(rand() * legal.length)]);
      step++;
    }
  }
  for (const k of ['startHand', 'play', 'callResponse', 'maoDeOnze:maoDeOnze', 'play:maoDeOnze', 'play:maoDeFerro']) {
    assert.ok(kinds.has(k), `etapa não amostrada: ${k}`);
  }
  assert.ok(sampled > 1000, `amostras: ${sampled}`);
  assert.ok(accepted > 0 && rejected > 0);
});

// ---------- fuzz ----------

/** Ids que `seat` não pode ver no estado atual. */
function hiddenIdsFor(state, seat) {
  const hand = state.hand;
  const hidden = new Set();
  if (!hand) return hidden;
  const N = state.players;
  const partnerVisible = hand.special === 'maoDeOnze' && hand.stage === 'maoDeOnze' && N === 4 && Engine.teamOf(seat) === hand.specialTeam;
  for (let s = 0; s < N; s++) {
    if (s === seat) {
      if (hand.special === 'maoDeFerro') for (const c of hand.hands[s]) hidden.add(c.id);
      continue;
    }
    if (partnerVisible && s === (seat + 2) % N) continue;
    for (const c of hand.hands[s]) hidden.add(c.id);
  }
  for (const r of hand.rounds) for (const p of r.plays) if (p.faceDown && p.seat !== seat) hidden.add(p.card.id);
  return hidden;
}

function checkViews(state) {
  for (let seat = 0; seat < state.players; seat++) {
    const v = Engine.viewFor(state, seat);
    const json = JSON.stringify(v);
    for (const id of hiddenIdsFor(state, seat)) {
      assert.ok(!json.includes(`"${id}"`), `viewFor(${seat}) vazou ${id}`);
    }
    if (state.hand) {
      assert.equal(v.myHand.length, state.hand.hands[seat].length);
      if (state.hand.special === 'maoDeFerro') assert.ok(v.myHand.every((c) => c.hidden === true && c.id === undefined));
    }
  }
}

function fuzzMatch(cfg, policySeed, stats, opts) {
  const state = Engine.createMatch(cfg);
  const rand = mulberry32(policySeed);
  const N = cfg.players;
  const deckIds = new Set(Rules.makeDeck(cfg.options.deck).map((c) => c.id));
  const needed = cfg.options.format === 'bestOf3' ? 2 : 1;
  let prevDealer = null;
  let dealt = null;
  let playedCount = null;
  let special = null;
  let lastScore = [0, 0];
  let steps = 0;
  let matchEnded = false;

  for (;;) {
    const d = Engine.getDecision(state);
    const legal = Engine.legalActions(state);
    if (d.kind === 'matchOver') {
      assert.equal(legal.length, 0);
      break;
    }
    assert.ok(legal.length > 0, 'decisão sem ação legal');
    if (d.kind === 'play') {
      if (state.hand.special !== null) {
        assert.equal(d.canCall, false);
        assert.ok(!legal.some((a) => a.type === 'CALL'));
      }
      assert.ok(legal.every((a) => a.seat === d.seat));
    }
    const action = legal[Math.floor(rand() * legal.length)];
    const events = Engine.apply(state, action);
    steps++;
    assert.ok(steps < 20000, 'partida não termina');

    for (const ev of events) {
      switch (ev.type) {
        case 'handStarted': {
          const expectedDealer = prevDealer === null ? state.firstDealer : (prevDealer + 1) % N;
          assert.equal(ev.dealer, expectedDealer, 'rotação do pé');
          prevDealer = ev.dealer;
          assert.equal(ev.mao, (ev.dealer + 1) % N);
          assert.equal(ev.hands.length, N);
          const ids = [ev.vira.id];
          for (const h of ev.hands) {
            assert.equal(h.length, 3);
            for (const c of h) ids.push(c.id);
          }
          assert.equal(new Set(ids).size, 3 * N + 1, 'cartas repetidas na mão');
          for (const id of ids) assert.ok(deckIds.has(id), `${id} fora do baralho`);
          const e0 = lastScore[0] === 11;
          const e1 = lastScore[1] === 11;
          assert.equal(ev.special, e0 && e1 ? 'maoDeFerro' : e0 || e1 ? 'maoDeOnze' : null);
          special = ev.special;
          dealt = ev.hands.map((h) => new Set(h.map((c) => c.id)));
          playedCount = new Array(N).fill(0);
          stats.hands++;
          stats[special || 'normal']++;
          break;
        }
        case 'maoDeOnzeDecided':
          assert.equal(special, 'maoDeOnze');
          assert.equal(ev.value, ev.accept ? 3 : 1);
          break;
        case 'cardPlayed':
          playedCount[ev.seat]++;
          assert.ok(playedCount[ev.seat] <= 3, 'jogador jogou mais de 3 cartas');
          assert.ok(dealt[ev.seat].delete(ev.card.id), 'carta que o jogador não tinha');
          if (special === 'maoDeFerro') {
            assert.equal(ev.blind, true);
            assert.equal(ev.faceDown, false);
          }
          if (ev.faceDown) stats.faceDown++;
          break;
        case 'call':
          assert.equal(special, null, 'pedido em mão de onze/ferro');
          assert.equal(ev.to, Rules.nextValue(ev.from));
          stats.calls++;
          if (ev.to === 12) stats.doze++;
          break;
        case 'accept':
          assert.ok(VALUES.includes(ev.value));
          break;
        case 'run':
          assert.ok(VALUES.includes(ev.points));
          break;
        case 'roundEnded':
          if (ev.tie) stats.tiedRounds++;
          break;
        case 'handEnded': {
          assert.ok([0, 1, 3, 6, 9, 12].includes(ev.points));
          if (ev.winnerTeam === null) assert.equal(ev.points, 0);
          for (const t of [0, 1]) assert.ok(ev.score[t] >= lastScore[t], 'placar diminuiu');
          assert.equal(ev.score[0] + ev.score[1], lastScore[0] + lastScore[1] + ev.points);
          if (special === 'maoDeOnze' && ev.reason !== 'maoDeOnzeRun') assert.ok(ev.points === 3 || ev.points === 0);
          if (special === 'maoDeFerro') assert.ok(ev.points === 1 || ev.points === 0);
          lastScore = ev.score.slice();
          stats.reasons[ev.reason] = (stats.reasons[ev.reason] || 0) + 1;
          break;
        }
        case 'gameEnded':
          assert.ok(ev.score[ev.winnerTeam] >= 12);
          assert.ok(ev.score[1 - ev.winnerTeam] < 12);
          stats.games++;
          lastScore = [0, 0];
          break;
        case 'matchEnded':
          matchEnded = true;
          assert.equal(ev.gamesWon[ev.winnerTeam], needed);
          assert.ok(ev.gamesWon[1 - ev.winnerTeam] < needed);
          break;
        default:
          break;
      }
    }
    if (state.hand) assert.ok(VALUES.includes(state.hand.value));
    if (state.phase === 'playing') assert.deepEqual(state.score, lastScore);
    if (opts.views) checkViews(state);
    if (opts.json && steps % 20 === 0) assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
  }
  assert.ok(matchEnded);
  assert.equal(state.phase, 'matchOver');
  stats.matches++;
  stats.steps += steps;
}

test('fuzz: 2000 partidas aleatórias (1000 com 2 e 1000 com 4 jogadores, ambos baralhos e formatos)', (t) => {
  const stats = {
    matches: 0, steps: 0, hands: 0, games: 0, normal: 0, maoDeOnze: 0, maoDeFerro: 0,
    calls: 0, doze: 0, faceDown: 0, tiedRounds: 0, reasons: {},
  };
  const combos = new Set();
  for (let i = 0; i < 2000; i++) {
    const cfg = {
      players: i < 1000 ? 2 : 4,
      seed: 10007 * i + 13,
      options: { deck: i % 2 ? 'sujo' : 'limpo', format: (i >> 1) % 2 ? 'bestOf3' : 'single' },
    };
    combos.add(`${cfg.players}-${cfg.options.deck}-${cfg.options.format}`);
    fuzzMatch(cfg, i + 1, stats, { views: i % 10 === 0, json: i % 50 === 0 });
  }
  assert.equal(stats.matches, 2000);
  assert.equal(combos.size, 8);
  assert.ok(stats.maoDeOnze > 0 && stats.maoDeFerro > 0, JSON.stringify(stats));
  assert.ok(stats.calls > 0 && stats.doze > 0 && stats.faceDown > 0 && stats.tiedRounds > 0);
  for (const reason of ['rounds', 'run', 'maoDeOnzeRun', 'allTied']) {
    assert.ok(stats.reasons[reason] > 0, `nenhuma mão terminou por ${reason}`);
  }
  t.diagnostic(JSON.stringify(stats));
});
