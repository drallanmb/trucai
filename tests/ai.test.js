'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../js/core/rules.js');
require('../js/core/engine.js');
require('../js/core/ai.js');

const { Rules, Engine, AI } = globalThis.Truco;
const C = (id) => Rules.cardFromId(id);
const DIFFICULTIES = ['facil', 'medio', 'dificil'];

// ---------- utilitários ----------

/** Partida com o mão definido: `mao` abre a primeira rodada. */
function newMatch({ players = 2, mao = 0, seed = 1, deck = 'limpo', format = 'single' } = {}) {
  return Engine.createMatch({ players, seed, firstDealer: (mao - 1 + players) % players, options: { deck, format } });
}

/**
 * Começa a mão com o placar dado e troca vira e cartas (antes de qualquer jogada). Assentos com menos
 * de 3 ids recebem cartas de enchimento.
 */
function rigHand(state, { score, vira, hands }) {
  if (score) state.score = score.slice();
  Engine.apply(state, { type: 'START_HAND' });
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
  return state;
}

/** Partida nova (mão, seed, baralho) já com a mão arrumada (placar, vira, cartas). */
function deal({ players = 2, mao = 0, seed = 1, deck = 'limpo', score, vira, hands }) {
  return rigHand(newMatch({ players, mao, seed, deck }), { score, vira, hands });
}

const play = (s, seat, cardId, faceDown = false) => Engine.apply(s, { type: 'PLAY', seat, cardId, faceDown });
const act = (s, type, seat) => Engine.apply(s, { type, seat });

function bot(seat, difficulty, seed = 1, personality) {
  return AI.create({ seat, difficulty, seed, personality, strict: true });
}

/** Decisão do bot no assento que o motor espera (primeiro do time, se for resposta). */
function botAction(state, b, seat = b.seat) {
  return b.decide(Engine.viewFor(state, seat), Engine.getDecision(state));
}

/**
 * Pede a jogada ao bot. Se ele pedir truco antes, o outro time aceita e o bot decide de novo
 * (é o que o motor faz: depois do aceite a vez continua com ele). Devolve { action, called }.
 */
function botPlay(state, b) {
  let called = false;
  for (;;) {
    const action = botAction(state, b);
    assertLegal(state, action, 'jogada do bot');
    if (action.type !== 'CALL') return { action, called };
    called = true;
    Engine.apply(state, action);
    const d = Engine.getDecision(state);
    Engine.apply(state, { type: 'ACCEPT', seat: d.seats[0] });
  }
}

function sameAction(a, b) {
  if (a.type !== b.type || a.seat !== b.seat) return false;
  if (b.cardId !== undefined && a.cardId !== b.cardId) return false;
  if (b.index !== undefined && a.index !== b.index) return false;
  if (b.accept !== undefined && a.accept !== b.accept) return false;
  if (b.faceDown !== undefined && !!a.faceDown !== !!b.faceDown) return false;
  if (a.cardId !== undefined && b.cardId === undefined) return false;
  if (a.index !== undefined && b.index === undefined) return false;
  return true;
}

function assertLegal(state, action, context) {
  const legal = Engine.legalActions(state);
  assert.ok(
    legal.some((l) => sameAction(action, l)),
    `ação ilegal ${JSON.stringify(action)} (${context}); decisão ${JSON.stringify(Engine.getDecision(state))}`,
  );
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/**
 * Joga uma partida só com bots. `diffs[team]` define a dificuldade de cada time. Confere toda ação
 * contra legalActions, congela as visões (o bot não pode alterá-las) e devolve o time vencedor.
 */
function playMatch({ players, deck = 'limpo', format = 'single', diffs, seed, onDecision, onEvents }) {
  const state = Engine.createMatch({ players, seed, options: { deck, format } });
  const bots = [];
  for (let s = 0; s < players; s++) {
    bots.push(AI.create({ seat: s, difficulty: diffs[s % 2], seed: seed * 7919 + s, strict: true }));
  }
  let steps = 0;
  while (state.phase !== 'matchOver') {
    const d = Engine.getDecision(state);
    let action;
    if (d.kind === 'startHand') {
      action = { type: 'START_HAND' };
    } else {
      const seat = d.kind === 'play' ? d.seat : d.seats[0];
      const view = deepFreeze(Engine.viewFor(state, seat));
      action = bots[seat].decide(view, d);
      if (d.kind === 'play' && action.type === 'CALL') assert.equal(d.canCall, true, 'pediu com canCall falso');
      if (onDecision) onDecision({ state, decision: d, seat, view, action, bots });
    }
    assertLegal(state, action, `partida seed ${seed}, passo ${steps}`);
    const events = Engine.apply(state, action);
    if (onEvents) onEvents(events);
    steps++;
    assert.ok(steps < 5000, 'partida não terminou');
  }
  return { winnerTeam: state.winnerTeam, steps, score: state.score.slice() };
}

// ---------- API ----------

test('API do contrato: create, decide, advise, phrase e handStrength', () => {
  assert.equal(typeof AI.create, 'function');
  assert.equal(typeof AI.handStrength, 'function');
  const b = AI.create({ seat: 1, difficulty: 'dificil', seed: 3 });
  assert.equal(typeof b.decide, 'function');
  assert.equal(typeof b.advise, 'function');
  assert.equal(typeof b.phrase, 'function');
  assert.equal(b.seat, 1);
  assert.equal(b.difficulty, 'dificil');
  assert.ok(b.personality.bluff >= 0 && b.personality.bluff <= 1);
  assert.ok(b.personality.caution >= 0 && b.personality.caution <= 1);
  const p = AI.create({ seat: 0, difficulty: 'facil', personality: { bluff: 0.9, caution: 0.1 }, seed: 1 });
  assert.deepEqual({ ...p.personality }, { bluff: 0.9, caution: 0.1 });
  assert.equal(AI.create({ seat: 0, difficulty: 'impossivel' }).difficulty, 'medio');
  // Personalidade padrão varia por bot (derivada do seed).
  const personalities = new Set();
  for (let seed = 0; seed < 20; seed++) personalities.add(JSON.stringify(AI.create({ seat: 0, seed }).personality));
  assert.ok(personalities.size > 15);
});

test('handStrength: 0..1, ordena mãos de forma sensata e considera o baralho', () => {
  const hs = (ids, m, deck) => AI.handStrength(ids.map(C), m, deck);
  const casalMaior = hs(['Kc', 'Kh', 'Qd'], 'K');
  const lixo = hs(['Qd', 'Js', 'Qh'], 'K');
  const media = hs(['2d', 'As', 'Jh'], 'K');
  for (const v of [casalMaior, lixo, media]) assert.ok(v >= 0 && v <= 1);
  assert.ok(casalMaior > 0.8, `casal maior ${casalMaior}`);
  assert.ok(lixo < 0.1, `lixo ${lixo}`);
  assert.ok(casalMaior > media && media > lixo);
  assert.ok(hs(['Kc'], 'K') > hs(['Kd'], 'K'), 'Zap > Pica-fumo');
  assert.ok(hs(['3c', '3d', '2h'], 'K') > hs(['Ac', 'Ad', 'Jh'], 'K'));
  // No sujo um 3 é relativamente mais forte (há mais cartas comuns fracas); no limpo as manilhas pesam mais.
  assert.ok(hs(['3c', '2d', 'Ah'], 'K', 'sujo') > hs(['3c', '2d', 'Ah'], 'K', 'limpo'));
  assert.equal(hs(['4c', '5d', '6h'], '7'), hs(['4c', '5d', '6h'], '7', 'sujo'), 'deduz o sujo pelas cartas');
  assert.equal(AI.handStrength([], 'K'), 0);
  assert.equal(AI.handStrength([{ hidden: true, index: 0 }], 'K'), 0);
});

test('winChance: tabela de chance de vencer o jogo é coerente', () => {
  assert.equal(AI.winChance(12, 3), 1);
  assert.equal(AI.winChance(3, 12), 0);
  assert.ok(Math.abs(AI.winChance(0, 0) - 0.5) < 1e-9);
  assert.ok(Math.abs(AI.winChance(11, 11) - 0.5) < 1e-9);
  for (let a = 0; a < 12; a++) {
    for (let b = 0; b < 12; b++) {
      assert.ok(Math.abs(AI.winChance(a, b) + AI.winChance(b, a) - 1) < 1e-9, `simetria ${a}x${b}`);
      if (a < 11) assert.ok(AI.winChance(a + 1, b) >= AI.winChance(a, b) - 1e-9, `monótona ${a}x${b}`);
    }
  }
});

// ---------- jogo de carta ----------
// As jogadas exatas são conferidas no difícil: o médio erra de propósito (3% de cartas ao acaso) e o
// fácil bem mais; as partidas completas conferem que nenhum deles joga carta ilegal.

test('cobre a carta do adversário com a MENOR carta que vence (1x1 e 2x2)', () => {
  const difficulty = 'dificil';
  for (let seed = 1; seed <= 12; seed++) {
    // 1x1, vira Q (manilha J): adversário abre K; bot tem Q, A, 3 → cobre com A.
    const s = deal({ seed, vira: 'Qc', hands: [['Kd', 'Qs', 'Jd'], ['Qh', 'Ah', '3s']] });
    play(s, 0, 'Kd');
    const { action: a } = botPlay(s, bot(1, difficulty, seed));
    assert.equal(a.cardId, 'Ah', `${difficulty} seed ${seed}: ${JSON.stringify(a)}`);

    // 2x2, último a jogar: adversários com K e A, parceiro com Q; bot tem Q, 2 e o Zap → cobre com 2.
    const t = deal({
      players: 4,
      seed,
      vira: 'Qd',
      hands: [['Kd'], ['Qc'], ['As'], ['Qs', '2h', 'Jc']],
    });
    play(t, 0, 'Kd');
    play(t, 1, 'Qc');
    play(t, 2, 'As');
    const { action: b } = botPlay(t, bot(3, difficulty, seed));
    assert.equal(b.cardId, '2h', `${difficulty} seed ${seed} (2x2): ${JSON.stringify(b)}`);
  }
});

test('não cobre a carta do parceiro que já está ganhando: descarta a menor', () => {
  const difficulty = 'dificil';
  for (let seed = 1; seed <= 12; seed++) {
    // Último a jogar: parceiro (1) com 3, adversários com K e A. Bot tem Zap, 2 e Q → joga Q.
    const s = deal({
      players: 4,
      seed,
      vira: 'Qd',
      hands: [['Kd'], ['3h'], ['As'], ['Jc', '2h', 'Qs']],
    });
    play(s, 0, 'Kd');
    play(s, 1, '3h');
    play(s, 2, 'As');
    const { action: a } = botPlay(s, bot(3, difficulty, seed));
    assert.equal(a.cardId, 'Qs', `${difficulty} seed ${seed}: ${JSON.stringify(a)}`);

    // Terceiro a jogar: parceiro (0) abriu com o Zap, que ninguém cobre. Bot tem 3, 2 e Q → joga Q.
    const t = deal({
      players: 4,
      seed,
      vira: 'Qd',
      hands: [['Jc'], ['Kd'], ['3s', '2h', 'Qh'], ['As']],
    });
    play(t, 0, 'Jc');
    play(t, 1, 'Kd');
    const { action: b } = botPlay(t, bot(2, difficulty, seed));
    assert.equal(b.cardId, 'Qh', `${difficulty} seed ${seed} (3º): ${JSON.stringify(b)}`);
  }
});

test('canga de propósito quando o empate garante a mão (3 contra 3 na 1ª, segurando o Zap)', () => {
  const difficulty = 'dificil';
  for (let seed = 1; seed <= 12; seed++) {
    // 1x1, vira Q (manilha J). Adversário abre 3♠. Bot: 3♥, Zap (J♣), Q. Cangar e depois o Zap ganha a 2ª.
    const s = deal({ seed, vira: 'Qd', hands: [['3s', 'Kd', 'Ad'], ['3h', 'Jc', 'Qs']] });
    play(s, 0, '3s');
    const { action: a } = botPlay(s, bot(1, difficulty, seed));
    assert.equal(a.cardId, '3h', `${difficulty} seed ${seed}: ${JSON.stringify(a)}`);
  }
});

test('guarda a manilha forte: depois de ganhar a 1ª, abre a 2ª com a carta menor', () => {
  for (let seed = 1; seed <= 12; seed++) {
    // 1x1, vira Q (manilha J). Bot ganha a 1ª (3 × K) e abre a 2ª com Zap e K: o K basta, o Zap fica
    // para a 3ª (ganhar ou cangar a 3ª já dá a mão a quem fez a primeira).
    const s = deal({ seed, vira: 'Qd', hands: [['Kd', '2s', 'As'], ['3h', 'Jc', 'Kh']] });
    play(s, 0, 'Kd');
    play(s, 1, '3h');
    const { action: a } = botPlay(s, bot(1, 'dificil', seed));
    assert.equal(a.cardId, 'Kh', `seed ${seed}: ${JSON.stringify(a)}`);
  }
});

test('carta encoberta só quando permitida e sem mudar a rodada', () => {
  // 2x2, vira Q (manilha J). O time 0 ganha a 1ª com o 3 do assento 0, que abre a 2ª com o Zap.
  // O bot (2) só pode descartar: joga a menor (2♥) e, por ser carta boa, encoberta.
  const difficulty = 'dificil';
  for (let seed = 1; seed <= 12; seed++) {
    const s = deal({
      players: 4,
      seed,
      vira: 'Qd',
      hands: [['3s', 'Jc'], ['Ks', 'Kh'], ['Qh', '3d', '2h'], ['As']],
    });
    play(s, 0, '3s');
    play(s, 1, 'Ks');
    play(s, 2, 'Qh');
    play(s, 3, 'As');
    play(s, 0, 'Jc');
    play(s, 1, 'Kh');
    assert.equal(Engine.getDecision(s).canFaceDown, true);
    const { action: a } = botPlay(s, bot(2, difficulty, seed));
    assert.deepEqual([a.cardId, a.faceDown], ['2h', true], `${difficulty} seed ${seed}: ${JSON.stringify(a)}`);
  }


  // Nunca encobre na 1ª rodada nem quando a carta pode mudar a rodada.
  for (const difficulty of DIFFICULTIES) {
    for (let seed = 1; seed <= 20; seed++) {
      const s = deal({ seed, vira: 'Qd', hands: [['Kd', 'Ks', 'Ah'], ['Qh', 'Ac', '3s']] });
      play(s, 0, 'Kd');
      const { action: a } = botPlay(s, bot(1, difficulty, seed));
      assert.equal(a.faceDown, false);
      // 2ª rodada: o adversário abre com 2; o 3 do bot vence, então vai aberto se for o escolhido.
      const t = deal({ seed, vira: 'Qd', hands: [['Ad', '2s', 'Ks'], ['Kh', '3c', 'Qs']] });
      play(t, 0, 'Ad');
      play(t, 1, 'Kh');
      play(t, 0, '2s');
      const { action: b } = botPlay(t, bot(1, difficulty, seed));
      if (b.cardId === '3c') assert.equal(b.faceDown, false, `${difficulty} seed ${seed}`);
    }
  }
});

test('mão de ferro: escolhe uma posição válida às cegas, sem cardId e sem pedir', () => {
  const seen = new Set();
  for (const difficulty of DIFFICULTIES) {
    for (let seed = 1; seed <= 15; seed++) {
      const s = newMatch({ players: 2, mao: 0, seed });
      s.score = [11, 11];
      Engine.apply(s, { type: 'START_HAND' });
      const d = Engine.getDecision(s);
      assert.equal(d.blind, true);
      const a = botAction(s, bot(0, difficulty, seed));
      assert.equal(a.type, 'PLAY');
      assert.equal(a.cardId, undefined);
      assert.ok(d.playableIndexes.includes(a.index));
      assertLegal(s, a, 'mão de ferro');
      seen.add(a.index);
    }
  }
  assert.ok(seen.size >= 2, 'a posição deveria variar (PRNG)');
});

// ---------- pedidos e respostas ----------

test('aceita (ou aumenta) truco com Zap + Copas', () => {
  for (const difficulty of DIFFICULTIES) {
    for (let seed = 1; seed <= 8; seed++) {
      // 1x1, vira Q (manilha J): bot tem Zap (J♣) e Copas (J♥).
      const s = deal({ seed, score: [3, 2], vira: 'Qd', hands: [['3s', 'Kd', 'Ad'], ['Jc', 'Jh', 'Qs']] });
      act(s, 'CALL', 0);
      const a = botAction(s, bot(1, difficulty, seed));
      assert.ok(['ACCEPT', 'RAISE'].includes(a.type), `${difficulty} seed ${seed}: ${JSON.stringify(a)}`);

      // 2x2: responde o time 0; o bot (0) tem o casal maior.
      const t = deal({
        players: 4,
        mao: 1,
        seed,
        vira: 'Qd',
        hands: [['Jc', 'Jh', 'Qs'], ['3s'], ['Kd'], ['Ad']],
      });
      act(t, 'CALL', 1);
      const b = botAction(t, bot(0, difficulty, seed));
      assert.ok(['ACCEPT', 'RAISE'].includes(b.type), `${difficulty} seed ${seed} (2x2): ${JSON.stringify(b)}`);
    }
  }
});

test('corre com mão fraquíssima quando correr não perde a partida', () => {
  for (const difficulty of ['medio', 'dificil']) {
    for (let seed = 1; seed <= 8; seed++) {
      for (const score of [[0, 0], [4, 6], [7, 3]]) {
        // Vira J (manilha K): bot tem Q, Q, J — as menores cartas do baralho.
        const s = deal({ seed, score, vira: 'Jd', hands: [['3s', 'Ad', '2c'], ['Qd', 'Qs', 'Jh']] });
        act(s, 'CALL', 0);
        const a = botAction(s, bot(1, difficulty, seed, { bluff: 0.5, caution: 0.5 }));
        assert.equal(a.type, 'RUN', `${difficulty} seed ${seed} placar ${score}: ${JSON.stringify(a)}`);
      }
    }
  }
});

test('aceita quando correr daria 12 ao adversário, mesmo com mão fraca', () => {
  for (const difficulty of DIFFICULTIES) {
    for (let seed = 1; seed <= 8; seed++) {
      // Placar 10x5 para o time 0. O bot (1) trucou, o time 0 aceitou (vale 3) e pediu seis.
      // Correr daria 3 ao time 0 → 13: fim de jogo. O bot aceita (ou aumenta).
      const s = deal({ mao: 1, seed, score: [10, 5], vira: 'Jd', hands: [['3s', 'Ad', '2c'], ['Qd', 'Qs', 'Jh']] });
      act(s, 'CALL', 1);
      act(s, 'ACCEPT', 0);
      play(s, 1, 'Jh');
      act(s, 'CALL', 0);
      const d = Engine.getDecision(s);
      assert.equal(d.kind, 'callResponse');
      assert.equal(d.currentValue, 3);
      const a = botAction(s, bot(1, difficulty, seed, { bluff: 0.2, caution: 0.95 }));
      assert.notEqual(a.type, 'RUN', `${difficulty} seed ${seed}: ${JSON.stringify(a)}`);
      assertLegal(s, a, 'resposta');
    }
  }
});

test('com a carta que já ganhou na última (adversário já jogou): às vezes pede, nunca erra a carta', () => {
  // 1x1, vira Q (manilha J). 1ª: bot ganha (3 × K); 2ª: adversário ganha (2 × A);
  // 3ª: adversário abre com Q e o bot, último, tem um 3. Pedir aqui é ritual (o outro já jogou e quase
  // sempre corre): o bot às vezes pede, às vezes só joga o 3 — nunca outra coisa.
  let calls = 0;
  let total = 0;
  for (const difficulty of ['medio', 'dificil']) {
    for (let seed = 1; seed <= 12; seed++) {
      const s = deal({ seed, vira: 'Qd', hands: [['Kd', '2s', 'Qh'], ['3c', 'As', '3h']] });
      play(s, 0, 'Kd');
      play(s, 1, '3c');
      play(s, 1, 'As');
      play(s, 0, '2s');
      assert.deepEqual(Engine.viewFor(s, 1).roundResults, [1, 0]);
      play(s, 0, 'Qh');
      const d = Engine.getDecision(s);
      assert.equal(d.seat, 1);
      assert.equal(d.canCall, true);
      const a = botAction(s, bot(1, difficulty, seed));
      total++;
      if (a.type === 'CALL') calls++;
      else assert.deepEqual([a.type, a.cardId], ['PLAY', '3h'], `${difficulty} seed ${seed}`);
    }
  }
  assert.ok(calls > 0 && calls < total, `pediu ${calls}/${total}`);
});

test('conta as cartas: sabendo que manilhas e 3s já saíram, pede truco com o último 3', () => {
  // 2x2, vira A (manilha 2). Na 1ª e na 2ª rodada saíram as 4 manilhas e os outros três 3s; o time 1
  // ganhou a 1ª e o bot (0) a 2ª. O 3♥ do bot abre a 3ª e nada o vence nem empata: pedir não tem risco.
  // Quem não conta (fácil) ainda teme manilhas nas mãos adversárias.
  const setup = (seed) => {
    const s = deal({
      players: 4,
      seed,
      vira: 'Ad',
      hands: [['3c', '2h', '3h'], ['2c', '3d'], ['3s', '2s'], ['2d', 'Qc']],
    });
    const plays = [[0, '3c'], [1, '2c'], [2, '3s'], [3, '2d'], [1, '3d'], [2, '2s'], [3, 'Qc'], [0, '2h']];
    for (const [seat, id] of plays) play(s, seat, id);
    assert.deepEqual(Engine.viewFor(s, 0).roundResults, [1, 0]);
    assert.equal(Engine.getDecision(s).seat, 0);
    return s;
  };
  for (const difficulty of ['medio', 'dificil']) {
    for (let seed = 1; seed <= 12; seed++) {
      const s = setup(seed);
      const a = botAction(s, bot(0, difficulty, seed, { bluff: 0, caution: 0.5 }));
      assert.equal(a.type, 'CALL', `${difficulty} seed ${seed}: ${JSON.stringify(a)}`);
    }
  }
  let easyCalls = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const s = setup(seed);
    if (botAction(s, bot(0, 'facil', seed, { bluff: 0, caution: 0.5 })).type === 'CALL') easyCalls++;
  }
  assert.ok(easyCalls < 12, 'o fácil não conta cartas e às vezes deveria hesitar');
});

test('nunca pede quando canCall é falso (depois do aceite, na mão de onze)', () => {
  for (const difficulty of DIFFICULTIES) {
    for (let seed = 1; seed <= 10; seed++) {
      const bold = { bluff: 1, caution: 0 };
      const s = deal({ seed, vira: 'Qd', hands: [['Jc', 'Jh', 'Js'], ['Qs', 'Kh', 'Ad']] });
      act(s, 'CALL', 0);
      act(s, 'ACCEPT', 1);
      assert.equal(Engine.getDecision(s).canCall, false);
      assert.equal(botAction(s, bot(0, difficulty, seed, bold)).type, 'PLAY');

      // Mão de onze aceita: ninguém pode pedir, nem com o casal maior na mão.
      const t = deal({ seed, score: [11, 4], vira: 'Qd', hands: [['Jc', 'Jh', 'Js'], ['Qs', 'Kh', 'Ad']] });
      Engine.apply(t, { type: 'MAO_DE_ONZE', seat: 0, accept: true });
      const players = [bot(0, difficulty, seed, bold), bot(1, difficulty, seed, bold)];
      while (Engine.getDecision(t).kind === 'play') {
        const d = Engine.getDecision(t);
        assert.equal(d.canCall, false);
        const a = botAction(t, players[d.seat]);
        assert.equal(a.type, 'PLAY');
        Engine.apply(t, a);
      }
    }
  }
});

// ---------- mão de onze ----------

test('mão de onze: joga com mão forte (própria + parceiro) e corre com lixo perto do fim', () => {
  for (const difficulty of ['medio', 'dificil']) {
    for (let seed = 1; seed <= 6; seed++) {
      // 2x2, time 0 com 11. Bot (0) tem Zap e 3; parceiro (2) tem Copas e 2.
      const s = deal({
        players: 4,
        seed,
        score: [11, 6],
        vira: 'Qd',
        hands: [['Jc', '3d', 'Kd'], ['Qs'], ['Jh', '2s', 'Ks'], ['Qh']],
      });
      const view = Engine.viewFor(s, 0);
      assert.equal(view.partnerHand.length, 3);
      const a = botAction(s, bot(0, difficulty, seed));
      assert.deepEqual([a.type, a.accept], ['MAO_DE_ONZE', true], `${difficulty} seed ${seed}: ${JSON.stringify(a)}`);
      assert.equal(bot(0, difficulty, seed).advise(Engine.viewFor(s, 2), Engine.getDecision(s)), 'accept');

      // Adversário com 9: perder a mão (vale 3) dá o jogo a eles. Com lixo nas duas mãos, corre.
      const t = deal({
        players: 4,
        seed,
        score: [11, 9],
        vira: 'Jd',
        hands: [['Qd', 'Qs', 'Jh'], ['3s'], ['Qh', 'Js', 'Ac'], ['2d']],
      });
      const b = botAction(t, bot(0, difficulty, seed));
      const msg = `${difficulty} seed ${seed} (lixo): ${JSON.stringify(b)}`;
      assert.deepEqual([b.type, b.accept], ['MAO_DE_ONZE', false], msg);
      assert.equal(bot(2, difficulty, seed).advise(Engine.viewFor(t, 2), Engine.getDecision(t)), 'run');
    }
  }
  // 1x1: só com as próprias cartas.
  const u = deal({ seed: 3, score: [2, 11], vira: 'Qd', hands: [['Qs'], ['Jc', 'Jh', '3d']] });
  assert.equal(Engine.viewFor(u, 1).partnerHand, null);
  const c = botAction(u, bot(1, 'dificil', 3));
  assert.deepEqual([c.type, c.seat, c.accept], ['MAO_DE_ONZE', 1, true]);
});

test('mão de onze: o limiar depende do placar do adversário (contra 8 joga, contra 9 corre)', () => {
  // Mesma mão média (3, 2, K; vira Q), bot é o mão com 11. Contra 8, perder dá 11x11 (mão de ferro) e
  // correr dá 11x9: joga. Contra 9, perder dá o jogo ao adversário: corre.
  const decide = (opp, seed) => {
    const s = deal({ mao: 1, seed, score: [opp, 11], vira: 'Qd', hands: [[], ['3h', '2d', 'Kd']] });
    return botAction(s, bot(1, 'dificil', seed)).accept;
  };
  let playsVs8 = 0;
  let playsVs9 = 0;
  for (let seed = 1; seed <= 20; seed++) {
    if (decide(8, seed)) playsVs8++;
    if (decide(9, seed)) playsVs9++;
  }
  assert.ok(playsVs8 >= 18, `contra 8 jogou só ${playsVs8}/20`);
  assert.ok(playsVs9 <= 2, `contra 9 jogou ${playsVs9}/20`);
});

// ---------- conselho e falas ----------

test('advise: conselho ao humano coerente com a mão do parceiro', () => {
  for (let seed = 1; seed <= 6; seed++) {
    // Adversário (1) truca; responde o time 0 (humano no 0, parceiro-bot no 2).
    const strong = deal({
      players: 4,
      mao: 1,
      seed,
      vira: 'Qd',
      hands: [['Kd'], ['3s'], ['Jc', 'Jh', '3h'], ['Ad']],
    });
    act(strong, 'CALL', 1);
    const partner = bot(2, 'dificil', seed);
    const view = Engine.viewFor(strong, 2);
    const advice = partner.advise(view, Engine.getDecision(strong));
    assert.ok(['accept', 'raise'].includes(advice), `forte: ${advice}`);
    // Determinístico para a mesma situação e sem gastar o PRNG das jogadas.
    assert.equal(partner.advise(view, Engine.getDecision(strong)), advice);

    const weak = deal({
      players: 4,
      mao: 1,
      seed,
      vira: 'Jd',
      hands: [['Kd'], ['3s'], ['Qd', 'Qs', 'Jh'], ['Ad']],
    });
    act(weak, 'CALL', 1);
    assert.equal(bot(2, 'dificil', seed).advise(Engine.viewFor(weak, 2), Engine.getDecision(weak)), 'run');
  }
  // Sem aumento possível (doze), nunca aconselha 'raise'; fora de resposta/mão de onze devolve null.
  const s = deal({ seed: 1, vira: 'Qd', hands: [['Kd'], ['Jc', 'Jh', 'Js']] });
  assert.equal(bot(1, 'dificil').advise(Engine.viewFor(s, 1), Engine.getDecision(s)), null);
  act(s, 'CALL', 0);
  act(s, 'RAISE', 1);
  act(s, 'RAISE', 0);
  act(s, 'RAISE', 1);
  const d = Engine.getDecision(s);
  assert.equal(d.canRaise, false);
  const advice = bot(0, 'dificil').advise(Engine.viewFor(s, 0), d);
  assert.ok(['accept', 'run'].includes(advice));
});

/**
 * Cópia isolada de ai.js (num contexto vm) com os níveis alteráveis: no módulo normal LEVELS é
 * congelado. Serve para forçar um parâmetro do nível e ver o que ele afeta.
 */
function loadMutableAI() {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');
  const ctx = vm.createContext({ Truco: { Rules } });
  vm.runInContext('Object.freeze = (o) => o;', ctx);
  const file = path.join(__dirname, '../js/core/ai.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  return ctx.Truco.AI;
}

test('advise: o conselho do fácil não herda o viés de aceitar do nível (acceptBias)', () => {
  // Com acceptBias exagerado, o fácil passa a aceitar/jogar mão de onze de outro jeito (decide muda),
  // mas o conselho ao humano continua o mesmo: o viés é defeito do jogador, não do conselheiro.
  const Biased = loadMutableAI();
  Biased.LEVELS.facil.acceptBias = 0.6;
  let checked = 0;
  let decideChanged = 0;
  let onze = 0;
  for (let g = 0; g < 40; g++) {
    playMatch({
      players: g % 2 ? 4 : 2,
      deck: g % 4 < 2 ? 'limpo' : 'sujo',
      diffs: ['facil', 'facil'],
      seed: 52000 + g,
      onDecision: ({ decision, seat, view }) => {
        if (decision.kind !== 'callResponse' && decision.kind !== 'maoDeOnze') return;
        const normal = AI.create({ seat, difficulty: 'facil', seed: g + seat, strict: true });
        const biased = Biased.create({ seat, difficulty: 'facil', seed: g + seat, strict: true });
        const advice = normal.advise(view, decision);
        assert.equal(biased.advise(view, decision), advice, `jogo ${g}: conselho mudou com o viés`);
        if (JSON.stringify(normal.decide(view, decision)) !== JSON.stringify(biased.decide(view, decision))) {
          decideChanged++;
        }
        if (decision.kind === 'maoDeOnze') onze++;
        checked++;
      },
    });
  }
  assert.ok(checked >= 100 && onze > 0, `poucas decisões conferidas: ${checked} (mão de onze: ${onze})`);
  assert.ok(decideChanged > 0, 'o viés forçado deveria mudar alguma decisão do próprio bot');
});

const FORBIDDEN_LINES = /\b(jorge|truca|troco|turco|suco|parda|mata|deixa pra mim|seis-tão)\b/i;
const PROFANITY = /\b(porra|caralho|merda|puta|foda|cacete|bosta|droga)\b/i;

test('phrase: falas brasileiras variadas por evento, sem as proibidas de §11.3', () => {
  const b = AI.create({ seat: 1, difficulty: 'medio', seed: 5 });
  const kinds = [
    'call', 'raise', 'accept', 'run', 'winRound', 'loseRound', 'tie', 'maoDeOnzePlay', 'maoDeOnzeRun', 'idle',
    'winHand', 'loseHand', 'winMatch', 'loseMatch', 'faceDown',
  ];
  const forbidden = FORBIDDEN_LINES;
  const profanity = PROFANITY;
  for (const kind of kinds) {
    const lines = new Set();
    for (let i = 0; i < 80; i++) {
      const line = b.phrase(kind);
      assert.equal(typeof line, 'string');
      assert.ok(line.length > 0 && line.length <= 40, `${kind}: "${line}"`);
      assert.ok(!forbidden.test(line), `${kind}: fala proibida "${line}"`);
      assert.ok(!profanity.test(line), `${kind}: palavrão "${line}"`);
      lines.add(line);
    }
    assert.ok(lines.size >= 3, `${kind}: pouca variedade (${[...lines]})`);
  }
  // Pedidos por valor e a primeira rodada.
  const byValue = (v) => new Set(Array.from({ length: 60 }, () => b.phrase('call', v)));
  assert.ok([...byValue(3)].every((l) => /truco/i.test(l)));
  assert.ok([...byValue(6)].every((l) => /seis|meio-pau/i.test(l)));
  assert.ok([...byValue(9)].every((l) => /nove/i.test(l)));
  assert.ok([...byValue(12)].every((l) => /doze|queda/i.test(l)));
  const raises = new Set(Array.from({ length: 60 }, () => b.phrase('raise', { value: 6 })));
  assert.ok([...raises].every((l) => /seis|meio-pau/i.test(l)));
  const first = new Set(Array.from({ length: 60 }, () => b.phrase('winRound', { roundIndex: 0 })));
  assert.ok([...first].some((l) => /primeira vai à missa/i.test(l)));
  // Não repete a mesma fala duas vezes seguidas.
  let prev = null;
  for (let i = 0; i < 50; i++) {
    const line = b.phrase('accept');
    assert.notEqual(line, prev);
    prev = line;
  }
  assert.equal(b.phrase('inexistente'), '');
});

test('phrase: cada fala está numa lista só; encobrir tem ao menos 6 falas', () => {
  const b = AI.create({ seat: 2, difficulty: 'facil', seed: 11 });
  const sample = (kind, ctx) => new Set(Array.from({ length: 300 }, () => b.phrase(kind, ctx)));
  const lists = {};
  const kinds = [
    'accept', 'run', 'winRound', 'loseRound', 'tie', 'maoDeOnzePlay', 'maoDeOnzeRun', 'idle', 'winHand', 'loseHand',
    'winMatch', 'loseMatch', 'faceDown',
  ];
  for (const kind of kinds) lists[kind] = sample(kind);
  for (const v of [3, 6, 9, 12]) lists[`call${v}`] = sample('call', v);
  for (const v of [6, 9, 12]) lists[`raise${v}`] = sample('raise', v);
  lists.raise = sample('raise'); // sem valor: falas genéricas de aumento
  // Na primeira rodada saem as falas próprias misturadas com as de winRound.
  lists.firstRound = new Set([...sample('winRound', { roundIndex: 0 })].filter((l) => !lists.winRound.has(l)));
  assert.ok(lists.firstRound.size >= 3, [...lists.firstRound].join(' | '));
  const owner = new Map();
  for (const [name, set] of Object.entries(lists)) {
    for (const line of set) {
      assert.ok(!owner.has(line), `"${line}" aparece em ${owner.get(line)} e em ${name}`);
      owner.set(line, name);
    }
  }
  assert.ok(lists.faceDown.size >= 6, `encobrir: só ${lists.faceDown.size} falas`);
  for (const line of lists.faceDown) {
    assert.ok(line.length > 0 && line.length <= 40, line);
    assert.ok(!FORBIDDEN_LINES.test(line) && !PROFANITY.test(line), line);
  }
});

// ---------- robustez e determinismo ----------

test('determinismo: mesmo seed → mesmas decisões e mesma partida', () => {
  const run = () => {
    const log = [];
    const onDecision = ({ action }) => log.push(JSON.stringify(action));
    const r = playMatch({ players: 4, deck: 'limpo', diffs: ['dificil', 'medio'], seed: 42, onDecision });
    return { r, log };
  };
  const a = run();
  const b = run();
  assert.deepEqual(a.r, b.r);
  assert.deepEqual(a.log, b.log);
});

test('visão inesperada: fora do modo estrito devolve uma ação válida em vez de lançar', () => {
  const s = deal({ seed: 1, vira: 'Qd', hands: [['Kd'], ['Jc']] });
  const loose = AI.create({ seat: 0, difficulty: 'dificil', seed: 1 });
  const d = Engine.getDecision(s);
  const a = loose.decide({}, d);
  assertLegal(s, a, 'fallback');
  assert.throws(() => AI.create({ seat: 0, difficulty: 'dificil', strict: true }).decide({}, d));
  assert.deepEqual(loose.decide({}, { kind: 'startHand' }), { type: 'START_HAND' });
  assert.equal(loose.decide(Engine.viewFor(s, 0), { kind: 'matchOver', winnerTeam: 0 }), null);
});

test('600 partidas bot×bot (1x1 e 2x2, limpo e sujo, toda dificuldade): sem ação ilegal, todas terminam', () => {
  const combos = [];
  for (const a of DIFFICULTIES) for (const b of DIFFICULTIES) combos.push([a, b]);
  const counts = { games: 0, calls: 0, raises: 0, runs: 0, faceDown: 0, onze: 0, ferro: 0, advice: 0 };
  let g = 0;
  for (const players of [2, 4]) {
    for (const deck of ['limpo', 'sujo']) {
      for (let i = 0; i < 150; i++, g++) {
        const diffs = combos[g % combos.length];
        const format = i % 5 === 0 ? 'bestOf3' : 'single';
        const r = playMatch({
          players,
          deck,
          format,
          diffs,
          seed: 1000 + g,
          onDecision: ({ state, decision, seat, action, bots }) => {
            if (action.type === 'CALL') counts.calls++;
            if (action.type === 'RAISE') counts.raises++;
            if (action.type === 'RUN') counts.runs++;
            if (action.faceDown) counts.faceDown++;
            if (decision.kind === 'maoDeOnze') counts.onze++;
            if (decision.kind === 'play' && decision.blind) counts.ferro++;
            // O parceiro também sabe aconselhar (como faria para o humano).
            if ((decision.kind === 'callResponse' || decision.kind === 'maoDeOnze') && players === 4 && i % 3 === 0) {
              const partner = (seat + 2) % 4;
              const advice = bots[partner].advise(deepFreeze(Engine.viewFor(state, partner)), decision);
              const canRaise = decision.kind === 'callResponse' && decision.canRaise;
              const allowed = canRaise ? ['accept', 'run', 'raise'] : ['accept', 'run'];
              assert.ok(allowed.includes(advice), `conselho inválido ${advice}`);
              counts.advice++;
            }
          },
        });
        assert.ok(r.winnerTeam === 0 || r.winnerTeam === 1);
        counts.games++;
      }
    }
  }
  assert.equal(counts.games, 600);
  // Os bots de fato usam o repertório todo.
  for (const k of ['calls', 'raises', 'runs', 'faceDown', 'onze', 'ferro', 'advice']) {
    assert.ok(counts[k] > 0, `${k} = 0`);
  }
});

test('estados estranhos (partidas com jogadas ao acaso): todo bot responde com ação legal', () => {
  // Jogadas aleatórias levam a situações que bots não criariam (encobertas, pedidos malucos). Em cada
  // decisão, um bot de dificuldade qualquer responde; a partida segue com a jogada aleatória.
  let seedState = 12345;
  const rand = () => {
    seedState = (Math.imul(seedState, 1103515245) + 12345) >>> 0;
    return seedState / 4294967296;
  };
  let checked = 0;
  for (let g = 0; g < 200; g++) {
    const players = g % 2 ? 4 : 2;
    const deck = g % 4 < 2 ? 'limpo' : 'sujo';
    const state = Engine.createMatch({ players, seed: 7000 + g, options: { deck } });
    const bots = [];
    for (let s = 0; s < players; s++) {
      bots.push(AI.create({ seat: s, difficulty: DIFFICULTIES[(g + s) % 3], seed: g + s, strict: true }));
    }
    let steps = 0;
    while (state.phase !== 'matchOver' && steps < 400) {
      const d = Engine.getDecision(state);
      if (d.kind !== 'startHand') {
        const seats = d.kind === 'play' ? [d.seat] : d.seats;
        for (const seat of seats) {
          const action = bots[seat].decide(deepFreeze(Engine.viewFor(state, seat)), d);
          assertLegal(state, action, `fuzz ${g}/${steps}`);
          if (d.kind === 'callResponse' || d.kind === 'maoDeOnze') {
            const advice = bots[seat].advise(Engine.viewFor(state, seat), d);
            assert.ok(['accept', 'run', 'raise'].includes(advice));
            if (advice === 'raise') assert.equal(d.canRaise, true);
          }
          checked++;
        }
      }
      const legal = Engine.legalActions(state);
      Engine.apply(state, legal[Math.floor(rand() * legal.length)]);
      steps++;
    }
  }
  assert.ok(checked > 5000, `poucas decisões conferidas: ${checked}`);
});

/** Difícil × fácil: `games` partidas alternando os lados; devolve a fração vencida pelo difícil. */
function strongVsWeak(players, games, firstSeed) {
  let wins = 0;
  for (let g = 0; g < games; g++) {
    const strongTeam = g % 2;
    const diffs = strongTeam === 0 ? ['dificil', 'facil'] : ['facil', 'dificil'];
    const deck = g % 4 < 2 ? 'limpo' : 'sujo';
    const r = playMatch({ players, deck, diffs, seed: firstSeed + g });
    if (r.winnerTeam === strongTeam) wins++;
  }
  return wins / games;
}

test("'dificil' vence 'facil' em pelo menos 60% de 400 partidas 1x1", (t) => {
  const rate = strongVsWeak(2, 400, 20000);
  t.diagnostic(`difícil venceu ${(rate * 100).toFixed(1)}% no 1x1`);
  assert.ok(rate >= 0.6, `difícil venceu só ${(rate * 100).toFixed(1)}%`);
});

test("time 'dificil' vence time 'facil' em pelo menos 60% de 400 partidas 2x2", (t) => {
  const rate = strongVsWeak(4, 400, 30000);
  t.diagnostic(`time difícil venceu ${(rate * 100).toFixed(1)}% no 2x2`);
  assert.ok(rate >= 0.6, `difícil venceu só ${(rate * 100).toFixed(1)}%`);
});

test('difícil × difícil: nove e doze são raros (lê quem pede alto e só sobe com mão)', (t) => {
  let hands = 0;
  let nineOrMore = 0;
  let twelve = 0;
  for (let g = 0; g < 200; g++) {
    const players = g % 2 ? 4 : 2;
    let maxValue = 1;
    let special = null;
    playMatch({
      players,
      deck: g % 4 < 2 ? 'limpo' : 'sujo',
      diffs: ['dificil', 'dificil'],
      seed: 40000 + g,
      onEvents: (events) => {
        for (const e of events) {
          if (e.type === 'handStarted') {
            maxValue = 1;
            special = e.special;
          }
          if (e.type === 'call') maxValue = Math.max(maxValue, e.to);
          if (e.type === 'handEnded' && !special) {
            hands++;
            if (maxValue >= 9) nineOrMore++;
            if (maxValue >= 12) twelve++;
          }
        }
      },
    });
  }
  const pct = (x) => (100 * x) / hands;
  const summary = `nove ou mais pedido em ${pct(nineOrMore).toFixed(1)}%, doze em ${pct(twelve).toFixed(1)}%`;
  t.diagnostic(`${hands} mãos: ${summary}`);
  assert.ok(pct(nineOrMore) < 15, `nove ou mais em ${pct(nineOrMore).toFixed(1)}% das mãos`);
  assert.ok(pct(twelve) < 5, `doze em ${pct(twelve).toFixed(1)}% das mãos`);
});
