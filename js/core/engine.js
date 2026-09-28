// Truco.Engine — máquina de estados pura do Truco Paulista (docs/ARCHITECTURE.md §3, docs/RULES.md).
//
// O estado é um objeto simples, JSON-serializável e determinístico dado o seed (PRNG mulberry32
// guardado em state.rng). `apply` valida a ação inteira antes de mexer no estado: em ação ilegal lança
// Error com `.code` e o estado fica intacto.
//
// Forma do estado (interna; a UI e a IA devem usar getDecision/legalActions/viewFor):
//   { version, players, options:{deck, format}, rng, phase:'playing'|'matchOver', winnerTeam,
//     score:[a,b], gamesWon:[a,b], gameNumber, handNumber, firstDealer, nextDealer, hand }
//   hand = { number, dealer, mao, vira, manilhaRank, hands:Card[][] (cartas restantes),
//            special:null|'maoDeOnze'|'maoDeFerro', specialTeam, stage:'maoDeOnze'|'play'|'call'|'over',
//            value, lastCallTeam, pending:null|{callerSeat, callerTeam, proposedValue, currentValue},
//            callStartedThisTurn, rounds:[{leader, plays:[{seat, card, faceDown}], done, winnerTeam,
//            winnerSeat, tie, winningCard}], roundIndex, turn, results:(0|1|'tie')[], result }
//
// Os eventos são para o controlador (confiável): `handStarted` traz todas as mãos e `cardPlayed` traz a
// carta real mesmo quando encoberta, para a cena saber qual carta animar. Quem não pode ver algo deve
// ler `viewFor`, que nunca vaza carta oculta.
(function (root) {
  'use strict';
  const Truco = (root.Truco = root.Truco || {});
  const Rules =
    Truco.Rules ||
    (typeof module === 'object' && module.exports && typeof require === 'function' ? require('./rules.js') : null);
  if (!Rules) throw new Error('Truco.Rules precisa ser carregado antes de Truco.Engine');

  const WIN_SCORE = 12;
  const MAO_DE_ONZE_VALUE = 3;
  const MAO_DE_ONZE_RUN_POINTS = 1;
  const MAO_DE_FERRO_VALUE = 1;

  const ERROR_CODES = Object.freeze({
    BAD_OPTIONS: 'BAD_OPTIONS',
    BAD_ACTION: 'BAD_ACTION',
    MATCH_OVER: 'MATCH_OVER',
    UNEXPECTED_ACTION: 'UNEXPECTED_ACTION',
    BAD_SEAT: 'BAD_SEAT',
    NOT_YOUR_TURN: 'NOT_YOUR_TURN',
    WRONG_TEAM: 'WRONG_TEAM',
    CARD_NOT_IN_HAND: 'CARD_NOT_IN_HAND',
    BAD_INDEX: 'BAD_INDEX',
    FACE_DOWN_NOT_ALLOWED: 'FACE_DOWN_NOT_ALLOWED',
    CALL_NOT_ALLOWED: 'CALL_NOT_ALLOWED',
    RAISE_NOT_ALLOWED: 'RAISE_NOT_ALLOWED',
  });

  // Ações esperadas em cada etapa.
  const EXPECTED = Object.freeze({
    startHand: ['START_HAND'],
    maoDeOnze: ['MAO_DE_ONZE'],
    play: ['PLAY', 'CALL'],
    call: ['ACCEPT', 'RUN', 'RAISE'],
  });
  const ACTION_TYPES = ['START_HAND', 'MAO_DE_ONZE', 'PLAY', 'CALL', 'ACCEPT', 'RUN', 'RAISE'];

  function fail(code, message) {
    const err = new Error(message);
    err.code = code;
    throw err;
  }

  // ---------- utilidades ----------

  function teamOf(seat) {
    return seat % 2;
  }

  function nextSeat(seat, players) {
    return (seat + 1) % players;
  }

  function isSeat(seat, players) {
    return Number.isInteger(seat) && seat >= 0 && seat < players;
  }

  function copyCard(card) {
    return { id: card.id, rank: card.rank, suit: card.suit };
  }

  function clone(state) {
    if (typeof structuredClone === 'function') return structuredClone(state);
    return JSON.parse(JSON.stringify(state));
  }

  /** Assentos de `team` em ordem de jogo a partir de `fromSeat` (inclusive). */
  function teamSeatsFrom(team, fromSeat, players) {
    const seats = [];
    for (let k = 0; k < players; k++) {
      const s = (fromSeat + k) % players;
      if (teamOf(s) === team) seats.push(s);
    }
    return seats;
  }

  // ---------- PRNG (mulberry32; estado inteiro em state.rng) ----------

  function seedToUint32(seed) {
    const n = Number(seed);
    if (!Number.isFinite(n)) return 0;
    return Math.trunc(n) >>> 0;
  }

  function nextRandom(state) {
    state.rng = (state.rng + 0x6d2b79f5) >>> 0;
    let t = state.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function randomInt(state, n) {
    return Math.floor(nextRandom(state) * n);
  }

  function shuffle(state, cards) {
    for (let i = cards.length - 1; i > 0; i--) {
      const j = randomInt(state, i + 1);
      const tmp = cards[i];
      cards[i] = cards[j];
      cards[j] = tmp;
    }
    return cards;
  }

  // ---------- regras puras de rodada e de mão ----------

  /**
   * Apura uma rodada (RULES.md §6.4–6.5). `plays` em ordem de jogo: [{seat, card, faceDown}].
   * Encobertas valem −1: nunca vencem nem empatam. `nextLeader` é quem jogou a primeira das
   * cartas abertas mais fortes (vale para vitória e para empate).
   */
  function resolveRound(plays, manilhaRank, deck) {
    let best = -Infinity;
    let top = [];
    for (const p of plays) {
      if (p.faceDown) continue;
      const f = Rules.strength(p.card, manilhaRank, deck);
      if (f > best) {
        best = f;
        top = [p];
      } else if (f === best) {
        top.push(p);
      }
    }
    if (top.length === 0) throw new Error('Rodada sem carta aberta');
    const first = top[0];
    const tie = top.some((p) => teamOf(p.seat) !== teamOf(first.seat));
    return {
      winnerTeam: tie ? null : teamOf(first.seat),
      winnerSeat: tie ? null : first.seat,
      tie,
      winningCard: copyCard(first.card),
      nextLeader: first.seat,
    };
  }

  /**
   * Resolve a mão a partir dos resultados das rodadas (0 | 1 | 'tie'), RULES.md §7.1.
   * Retorna 0 | 1, 'none' (três empates) ou null (joga-se a próxima rodada).
   */
  function resolveHand(results) {
    let v0 = 0;
    let v1 = 0;
    let ties = 0;
    for (const r of results) {
      if (r === 0) v0++;
      else if (r === 1) v1++;
      else ties++;
    }
    if (v0 >= 2) return 0;
    if (v1 >= 2) return 1;
    if (ties >= 1 && v0 + v1 >= 1) return results.find((r) => r !== 'tie');
    if (results.length >= 3) return 'none';
    return null;
  }

  // ---------- consultas sobre o estado ----------

  function stageOf(state) {
    if (state.phase === 'matchOver') return 'matchOver';
    const hand = state.hand;
    if (!hand || hand.stage === 'over') return 'startHand';
    return hand.stage;
  }

  function currentRound(hand) {
    return hand.rounds[hand.roundIndex];
  }

  /** Condições 1–6 de RULES.md §8.3 para o assento `seat` pedir agora. */
  function canCall(state, seat) {
    const hand = state.hand;
    if (state.phase !== 'playing' || !hand || hand.stage !== 'play') return false;
    return (
      hand.turn === seat &&
      hand.pending === null &&
      hand.special === null &&
      hand.value < 12 &&
      hand.lastCallTeam !== teamOf(seat) &&
      !hand.callStartedThisTurn
    );
  }

  /** Encoberta: nunca na 1ª rodada, nunca para quem abre a rodada, nunca na mão de ferro (§6.6). */
  function canFaceDown(hand, seat) {
    return (
      hand.stage === 'play' &&
      hand.turn === seat &&
      hand.special !== 'maoDeFerro' &&
      hand.roundIndex > 0 &&
      currentRound(hand).plays.length > 0
    );
  }

  // ---------- API pública ----------

  function createMatch(config) {
    const cfg = config || {};
    const players = cfg.players === undefined ? 4 : cfg.players;
    if (players !== 2 && players !== 4) fail(ERROR_CODES.BAD_OPTIONS, `players deve ser 2 ou 4 (recebido ${players})`);
    const opts = cfg.options || {};
    const deck = opts.deck === undefined ? 'limpo' : opts.deck;
    if (!Object.prototype.hasOwnProperty.call(Rules.DECKS, deck)) {
      fail(ERROR_CODES.BAD_OPTIONS, `options.deck deve ser 'limpo' ou 'sujo' (recebido ${deck})`);
    }
    const format = opts.format === undefined ? 'single' : opts.format;
    if (format !== 'single' && format !== 'bestOf3') {
      fail(ERROR_CODES.BAD_OPTIONS, `options.format deve ser 'single' ou 'bestOf3' (recebido ${format})`);
    }

    const state = {
      version: 1,
      players,
      options: { deck, format },
      rng: seedToUint32(cfg.seed),
      phase: 'playing',
      winnerTeam: null,
      score: [0, 0],
      gamesWon: [0, 0],
      gameNumber: 1,
      handNumber: 0,
      firstDealer: 0,
      nextDealer: 0,
      hand: null,
    };

    let firstDealer = cfg.firstDealer;
    if (firstDealer === undefined || firstDealer === null) {
      firstDealer = randomInt(state, players);
    } else if (!isSeat(firstDealer, players)) {
      fail(ERROR_CODES.BAD_OPTIONS, `firstDealer inválido: ${firstDealer}`);
    }
    state.firstDealer = firstDealer;
    state.nextDealer = firstDealer;
    return state;
  }

  function getDecision(state) {
    const stage = stageOf(state);
    const hand = state.hand;
    const N = state.players;
    switch (stage) {
      case 'matchOver':
        return { kind: 'matchOver', winnerTeam: state.winnerTeam };
      case 'startHand':
        return { kind: 'startHand' };
      case 'maoDeOnze':
        return {
          kind: 'maoDeOnze',
          team: hand.specialTeam,
          seats: teamSeatsFrom(hand.specialTeam, hand.mao, N),
        };
      case 'call': {
        const p = hand.pending;
        const team = 1 - p.callerTeam;
        const raiseValue = Rules.nextValue(p.proposedValue);
        return {
          kind: 'callResponse',
          team,
          seats: teamSeatsFrom(team, hand.turn, N),
          callerSeat: p.callerSeat,
          currentValue: hand.value,
          proposedValue: p.proposedValue,
          callName: Rules.CALL_NAMES[p.proposedValue],
          canRaise: raiseValue !== null,
          raiseValue,
          raiseName: raiseValue !== null ? Rules.CALL_NAMES[raiseValue] : null,
        };
      }
      case 'play': {
        const seat = hand.turn;
        const blind = hand.special === 'maoDeFerro';
        const call = canCall(state, seat);
        const callValue = call ? Rules.nextValue(hand.value) : null;
        const cards = hand.hands[seat];
        return {
          kind: 'play',
          seat,
          canCall: call,
          callValue,
          callName: callValue !== null ? Rules.CALL_NAMES[callValue] : null,
          canFaceDown: canFaceDown(hand, seat),
          blind,
          // Na mão de ferro ninguém vê as próprias cartas: joga-se por posição (index).
          playableCardIds: blind ? [] : cards.map((c) => c.id),
          playableIndexes: cards.map((_, i) => i),
        };
      }
      default:
        throw new Error(`Etapa desconhecida: ${stage}`);
    }
  }

  function legalActions(state) {
    const d = getDecision(state);
    const actions = [];
    switch (d.kind) {
      case 'startHand':
        actions.push({ type: 'START_HAND' });
        break;
      case 'maoDeOnze':
        for (const seat of d.seats) {
          actions.push({ type: 'MAO_DE_ONZE', seat, accept: true });
          actions.push({ type: 'MAO_DE_ONZE', seat, accept: false });
        }
        break;
      case 'callResponse':
        for (const seat of d.seats) {
          actions.push({ type: 'ACCEPT', seat });
          actions.push({ type: 'RUN', seat });
          if (d.canRaise) actions.push({ type: 'RAISE', seat });
        }
        break;
      case 'play': {
        const seat = d.seat;
        if (d.canCall) actions.push({ type: 'CALL', seat });
        if (d.blind) {
          for (const index of d.playableIndexes) actions.push({ type: 'PLAY', seat, index, faceDown: false });
        } else {
          for (const cardId of d.playableCardIds) actions.push({ type: 'PLAY', seat, cardId, faceDown: false });
          if (d.canFaceDown) {
            for (const cardId of d.playableCardIds) actions.push({ type: 'PLAY', seat, cardId, faceDown: true });
          }
        }
        break;
      }
      default:
        break;
    }
    return actions;
  }

  /** Valida a ação por inteiro, sem mutar nada. Retorna a ação normalizada. */
  function validate(state, action) {
    if (!action || typeof action !== 'object') fail(ERROR_CODES.BAD_ACTION, 'Ação ausente ou inválida');
    const type = action.type;
    if (!ACTION_TYPES.includes(type)) fail(ERROR_CODES.BAD_ACTION, `Tipo de ação desconhecido: ${String(type)}`);
    const stage = stageOf(state);
    if (stage === 'matchOver') fail(ERROR_CODES.MATCH_OVER, 'A partida já terminou');
    if (!EXPECTED[stage].includes(type)) {
      fail(ERROR_CODES.UNEXPECTED_ACTION, `Ação ${type} não é esperada agora (etapa: ${stage})`);
    }
    if (type === 'START_HAND') return { type };

    const hand = state.hand;
    const seat = action.seat;
    if (!isSeat(seat, state.players)) fail(ERROR_CODES.BAD_SEAT, `Assento inválido: ${String(seat)}`);

    switch (type) {
      case 'MAO_DE_ONZE':
        if (teamOf(seat) !== hand.specialTeam) {
          fail(ERROR_CODES.WRONG_TEAM, 'Só o time com 11 pontos decide a mão de onze');
        }
        if (typeof action.accept !== 'boolean') fail(ERROR_CODES.BAD_ACTION, 'MAO_DE_ONZE precisa de accept booleano');
        return { type, seat, accept: action.accept };

      case 'CALL':
        if (seat !== hand.turn) fail(ERROR_CODES.NOT_YOUR_TURN, `Não é a vez do assento ${seat}`);
        if (!canCall(state, seat)) fail(ERROR_CODES.CALL_NOT_ALLOWED, 'Pedido não permitido agora');
        return { type, seat };

      case 'PLAY': {
        if (seat !== hand.turn) fail(ERROR_CODES.NOT_YOUR_TURN, `Não é a vez do assento ${seat}`);
        const cards = hand.hands[seat];
        const hasId = action.cardId !== undefined && action.cardId !== null;
        const hasIndex = action.index !== undefined && action.index !== null;
        if (!hasId && !hasIndex) fail(ERROR_CODES.BAD_ACTION, 'PLAY precisa de cardId ou index');
        // §9.3: na mão de ferro ninguém vê as cartas, então escolher pelo id seria jogar sabendo o valor.
        if (hasId && hand.special === 'maoDeFerro') {
          fail(ERROR_CODES.BAD_ACTION, 'Na mão de ferro joga-se por posição (index)');
        }
        let index = -1;
        if (hasIndex) {
          if (!Number.isInteger(action.index) || action.index < 0 || action.index >= cards.length) {
            fail(ERROR_CODES.BAD_INDEX, `Posição de carta inválida: ${String(action.index)}`);
          }
          index = action.index;
        }
        if (hasId) {
          const i = typeof action.cardId === 'string' ? cards.findIndex((c) => c.id === action.cardId) : -1;
          if (i < 0) fail(ERROR_CODES.CARD_NOT_IN_HAND, `O assento ${seat} não tem a carta ${String(action.cardId)}`);
          if (hasIndex && i !== index) fail(ERROR_CODES.BAD_ACTION, 'cardId e index apontam para cartas diferentes');
          index = i;
        }
        const fd = action.faceDown;
        if (fd !== undefined && fd !== null && typeof fd !== 'boolean') {
          fail(ERROR_CODES.BAD_ACTION, 'faceDown deve ser booleano');
        }
        if (fd === true && !canFaceDown(hand, seat)) {
          fail(ERROR_CODES.FACE_DOWN_NOT_ALLOWED, 'Carta encoberta não permitida agora');
        }
        return { type, seat, index, faceDown: fd === true };
      }

      case 'ACCEPT':
      case 'RUN':
      case 'RAISE': {
        const p = hand.pending;
        if (teamOf(seat) !== 1 - p.callerTeam) {
          fail(ERROR_CODES.WRONG_TEAM, 'Só o time desafiado responde ao pedido');
        }
        if (type === 'RAISE' && Rules.nextValue(p.proposedValue) === null) {
          fail(ERROR_CODES.RAISE_NOT_ALLOWED, 'Não existe aumento acima de 12');
        }
        return { type, seat };
      }
      default:
        return fail(ERROR_CODES.BAD_ACTION, `Tipo de ação desconhecido: ${String(type)}`);
    }
  }

  function apply(state, action) {
    const a = validate(state, action);
    const events = [];
    switch (a.type) {
      case 'START_HAND':
        startHand(state, events);
        break;
      case 'MAO_DE_ONZE':
        decideMaoDeOnze(state, a, events);
        break;
      case 'CALL':
        makeCall(state, a.seat, events);
        break;
      case 'ACCEPT':
        acceptCall(state, a.seat, events);
        break;
      case 'RUN':
        runFromCall(state, a.seat, events);
        break;
      case 'RAISE':
        raiseCall(state, a.seat, events);
        break;
      case 'PLAY':
        playCard(state, a, events);
        break;
      default:
        break;
    }
    return events;
  }

  // ---------- transições ----------

  function startHand(state, events) {
    const N = state.players;
    const deckName = state.options.deck;
    const dealer = state.nextDealer;
    const mao = nextSeat(dealer, N);

    const deck = shuffle(state, Rules.makeDeck(deckName));
    const hands = [];
    for (let s = 0; s < N; s++) hands.push([]);
    let pos = 0;
    // Uma a uma, a partir do mão, em sentido anti-horário (§4.1).
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < N; k++) hands[(mao + k) % N].push(deck[pos++]);
    }
    const vira = deck[pos];
    const manilhaRank = Rules.manilhaRankFor(vira.rank, deckName);

    const eleven = [state.score[0] === 11, state.score[1] === 11];
    let special = null;
    let specialTeam = null;
    if (eleven[0] && eleven[1]) {
      special = 'maoDeFerro';
    } else if (eleven[0] || eleven[1]) {
      special = 'maoDeOnze';
      specialTeam = eleven[0] ? 0 : 1;
    }
    const value = special === 'maoDeFerro' ? MAO_DE_FERRO_VALUE : 1;

    state.handNumber += 1;
    state.hand = {
      number: state.handNumber,
      dealer,
      mao,
      vira,
      manilhaRank,
      hands,
      special,
      specialTeam,
      stage: special === 'maoDeOnze' ? 'maoDeOnze' : 'play',
      value,
      lastCallTeam: null,
      pending: null,
      callStartedThisTurn: false,
      rounds: [newRound(mao)],
      roundIndex: 0,
      turn: mao,
      results: [],
      result: null,
    };

    events.push({
      type: 'handStarted',
      handNumber: state.handNumber,
      dealer,
      mao,
      vira: copyCard(vira),
      manilhaRank,
      hands: hands.map((h) => h.map(copyCard)),
      value,
      special,
      specialTeam,
    });
  }

  function newRound(leader) {
    return { leader, plays: [], done: false, winnerTeam: null, winnerSeat: null, tie: false, winningCard: null };
  }

  function decideMaoDeOnze(state, a, events) {
    const hand = state.hand;
    const team = hand.specialTeam;
    if (a.accept) {
      hand.value = MAO_DE_ONZE_VALUE;
      hand.stage = 'play';
      events.push({ type: 'maoDeOnzeDecided', team, seat: a.seat, accept: true, value: hand.value });
    } else {
      events.push({ type: 'maoDeOnzeDecided', team, seat: a.seat, accept: false, value: hand.value });
      endHand(state, events, 1 - team, MAO_DE_ONZE_RUN_POINTS, 'maoDeOnzeRun');
    }
  }

  function makeCall(state, seat, events) {
    const hand = state.hand;
    const team = teamOf(seat);
    const from = hand.value;
    const to = Rules.nextValue(from);
    hand.pending = { callerSeat: seat, callerTeam: team, proposedValue: to, currentValue: from };
    hand.lastCallTeam = team;
    hand.callStartedThisTurn = true;
    hand.stage = 'call';
    events.push({ type: 'call', seat, team, from, to, name: Rules.CALL_NAMES[to], isRaise: false });
  }

  function acceptCall(state, seat, events) {
    const hand = state.hand;
    hand.value = hand.pending.proposedValue;
    hand.pending = null;
    hand.stage = 'play';
    events.push({ type: 'accept', seat, team: teamOf(seat), value: hand.value });
  }

  function runFromCall(state, seat, events) {
    const hand = state.hand;
    const awardedTeam = hand.pending.callerTeam;
    const points = hand.value; // último valor aceito (§8.7)
    hand.pending = null;
    events.push({ type: 'run', seat, team: teamOf(seat), awardedTeam, points });
    endHand(state, events, awardedTeam, points, 'run');
  }

  function raiseCall(state, seat, events) {
    const hand = state.hand;
    const team = teamOf(seat);
    hand.value = hand.pending.proposedValue; // aumentar = aceitar e subir (§8.4)
    const to = Rules.nextValue(hand.value);
    hand.pending = { callerSeat: seat, callerTeam: team, proposedValue: to, currentValue: hand.value };
    hand.lastCallTeam = team;
    events.push({ type: 'call', seat, team, from: hand.value, to, name: Rules.CALL_NAMES[to], isRaise: true });
  }

  function playCard(state, a, events) {
    const hand = state.hand;
    const N = state.players;
    const card = hand.hands[a.seat].splice(a.index, 1)[0];
    const round = currentRound(hand);
    round.plays.push({ seat: a.seat, card, faceDown: a.faceDown });
    hand.callStartedThisTurn = false;
    events.push({
      type: 'cardPlayed',
      seat: a.seat,
      card: copyCard(card),
      faceDown: a.faceDown,
      roundIndex: hand.roundIndex,
      blind: hand.special === 'maoDeFerro',
    });

    if (round.plays.length < N) {
      hand.turn = nextSeat(a.seat, N);
      return;
    }

    const res = resolveRound(round.plays, hand.manilhaRank, state.options.deck);
    round.done = true;
    round.winnerTeam = res.winnerTeam;
    round.winnerSeat = res.winnerSeat;
    round.tie = res.tie;
    round.winningCard = res.winningCard;
    hand.results.push(res.tie ? 'tie' : res.winnerTeam);
    events.push({
      type: 'roundEnded',
      roundIndex: hand.roundIndex,
      winnerTeam: res.winnerTeam,
      winnerSeat: res.winnerSeat,
      winningCard: copyCard(res.winningCard),
      tie: res.tie,
      nextLeader: res.nextLeader,
    });

    const outcome = resolveHand(hand.results);
    if (outcome === null) {
      hand.roundIndex += 1;
      hand.rounds.push(newRound(res.nextLeader));
      hand.turn = res.nextLeader;
    } else if (outcome === 'none') {
      endHand(state, events, null, 0, 'allTied');
    } else {
      endHand(state, events, outcome, hand.value, 'rounds');
    }
  }

  function endHand(state, events, winnerTeam, points, reason) {
    const hand = state.hand;
    hand.stage = 'over';
    hand.pending = null;
    hand.result = { winnerTeam, points, reason };
    if (winnerTeam !== null) state.score[winnerTeam] += points;
    state.nextDealer = nextSeat(hand.dealer, state.players); // o pé gira em toda mão (§3.6)

    events.push({
      type: 'handEnded',
      winnerTeam,
      points,
      reason,
      score: state.score.slice(),
      roundWinners: hand.results.slice(),
    });

    if (winnerTeam === null || state.score[winnerTeam] < WIN_SCORE) return;

    state.gamesWon[winnerTeam] += 1;
    const finalScore = state.score.slice();
    events.push({ type: 'gameEnded', winnerTeam, score: finalScore, gamesWon: state.gamesWon.slice() });

    const gamesNeeded = state.options.format === 'bestOf3' ? 2 : 1;
    if (state.gamesWon[winnerTeam] >= gamesNeeded) {
      state.phase = 'matchOver';
      state.winnerTeam = winnerTeam;
      events.push({ type: 'matchEnded', winnerTeam, score: finalScore.slice(), gamesWon: state.gamesWon.slice() });
    } else {
      state.score = [0, 0];
      state.gameNumber += 1;
    }
  }

  // ---------- visão por jogador ----------

  function viewFor(state, seat) {
    if (!isSeat(seat, state.players)) fail(ERROR_CODES.BAD_SEAT, `Assento inválido: ${String(seat)}`);
    const N = state.players;
    const team = teamOf(seat);
    const hand = state.hand;

    const view = {
      players: N,
      deck: state.options.deck,
      format: state.options.format,
      seat,
      team,
      phase: state.phase,
      winnerTeam: state.winnerTeam,
      score: state.score.slice(),
      gamesWon: state.gamesWon.slice(),
      gameNumber: state.gameNumber,
      handNumber: state.handNumber,
      dealer: hand ? hand.dealer : state.nextDealer,
      mao: hand ? hand.mao : nextSeat(state.nextDealer, N),
      vira: null,
      manilhaRank: null,
      value: 1,
      special: null,
      specialTeam: null,
      stage: null,
      blind: false,
      myHand: [],
      partnerHand: null,
      handSizes: new Array(N).fill(0),
      rounds: [],
      roundIndex: 0,
      roundResults: [],
      turn: null,
      pendingCall: null,
      lastCallTeam: null,
      seenCards: [],
    };
    if (!hand) return view;

    const blind = hand.special === 'maoDeFerro';
    view.vira = copyCard(hand.vira);
    view.manilhaRank = hand.manilhaRank;
    view.value = hand.value;
    view.special = hand.special;
    view.specialTeam = hand.specialTeam;
    view.stage = hand.stage;
    view.blind = blind;
    view.myHand = blind
      ? hand.hands[seat].map((_, index) => ({ hidden: true, index }))
      : hand.hands[seat].map(copyCard);
    if (hand.special === 'maoDeOnze' && hand.stage === 'maoDeOnze' && N === 4 && team === hand.specialTeam) {
      view.partnerHand = hand.hands[(seat + 2) % N].map(copyCard);
    }
    view.handSizes = hand.hands.map((h) => h.length);
    view.seenCards.push(copyCard(hand.vira));
    view.rounds = hand.rounds.map((r) => ({
      leader: r.leader,
      plays: r.plays.map((p) => {
        if (!p.faceDown) view.seenCards.push(copyCard(p.card));
        return { seat: p.seat, card: p.faceDown && p.seat !== seat ? null : copyCard(p.card), faceDown: p.faceDown };
      }),
      done: r.done,
      winnerTeam: r.winnerTeam,
      winnerSeat: r.winnerSeat,
      tie: r.tie,
    }));
    view.roundIndex = hand.roundIndex;
    view.roundResults = hand.results.slice();
    view.turn = hand.stage === 'play' || hand.stage === 'call' ? hand.turn : null;
    view.pendingCall = hand.pending
      ? {
          callerSeat: hand.pending.callerSeat,
          callerTeam: hand.pending.callerTeam,
          proposedValue: hand.pending.proposedValue,
          currentValue: hand.pending.currentValue,
        }
      : null;
    view.lastCallTeam = hand.lastCallTeam;
    return view;
  }

  const Engine = {
    ERROR_CODES,
    createMatch,
    getDecision,
    legalActions,
    apply,
    viewFor,
    teamOf,
    nextSeat,
    clone,
    canCall,
    resolveRound,
    resolveHand,
  };

  Truco.Engine = Engine;
  if (typeof module === 'object' && module.exports) module.exports = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
