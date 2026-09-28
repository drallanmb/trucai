// Truco.AI — bots do TrucAÍ (docs/ARCHITECTURE.md §4, estratégia de Truco Paulista).
//
// O bot decide só com a `view` do seu assento e a `decision` do motor; nunca lê o estado completo.
// Toda aleatoriedade vem de PRNGs próprios (mulberry32) derivados do `seed`, então o mesmo seed repete
// as mesmas decisões.
//
// Como o bot pensa:
//   • Força da mão: `handStrength` mede cada carta pelo percentil dentro do baralho (no limpo há poucas
//     comuns fortes, então as manilhas pesam mais).
//   • Chance de ganhar a mão: Monte Carlo com determinização. As cartas que o bot não viu (ele conta as
//     que já saíram, conforme a dificuldade) são sorteadas entre os outros jogadores e a mão é jogada até
//     o fim com uma política gulosa (cobre com a menor que vence, descarta a menor quando o time já ganha).
//   • Escolha da carta: as candidatas que de fato mudam a rodada são simuladas com as mesmas amostras e
//     vence a que mais ganha a mão; empate técnico fica com a carta menor (guardar as boas).
//   • Pedidos e respostas: comparam a chance de vencer o JOGO (tabela W(nós, eles) calculada na carga)
//     em cada alternativa: correr, aceitar, aumentar ou pedir, com um modelo de quando o adversário corre.
//     Personalidade (blefe, cautela) e dificuldade entram como deslocamentos, ruído e chance de blefe.
(function (root) {
  'use strict';
  const Truco = (root.Truco = root.Truco || {});
  const Rules =
    Truco.Rules ||
    (typeof module === 'object' && module.exports && typeof require === 'function' ? require('./rules.js') : null);
  if (!Rules) throw new Error('Truco.Rules precisa ser carregado antes de Truco.AI');

  const WIN_SCORE = 12;
  const MANILHA = 100; // Rules.strength: manilhas valem 100..103
  const FACE_DOWN = -1;
  const EPS = 1e-9;
  // Sem blefe, só pede com mão forte (chance de vencer a mão decidida perto de 9 em 10) e só aumenta com
  // mão muito forte; quanto mais alto o valor, mais mão é preciso. Pisos perto de 0,6 fazem alguém pedir
  // em quase toda mão (são até 3 oportunidades por jogador) e a mão escalar até o doze.
  const CALL_FLOOR = Object.freeze({ 3: 0.92, 6: 0.93, 9: 0.95, 12: 0.97 });
  const RAISE_FLOOR = Object.freeze({ 6: 0.82, 9: 0.92, 12: 0.96 });
  // "Com a certa" (sem chance de perder a mão): às vezes o bot esconde o jogo em vez de pedir já.
  // Chance-base por mão (× 0,6 + 0,8·blefe): nas duas primeiras rodadas e na última.
  const CERTAIN_CALL = Object.freeze({ early: 0.2, last: 0.35 });
  // Chance-base (× blefe) de aumentar blefando quando o aumento quase empata com aceitar.
  const RAISE_BLUFF = 0.1;
  // Blefe (pedir ou aumentar sem mão) só até este valor: ninguém sensato blefa nove ou doze.
  const MAX_BLUFF_VALUE = 6;
  // Força (quickPower das cartas que restam) a partir da qual alguém costuma pedir cada valor, e a de
  // quem só aceitou. Servem para ler o adversário: quem pede alto provavelmente tem mão.
  const CALL_POWER_BAR = Object.freeze({ 3: 0.5, 6: 0.62, 9: 0.7, 12: 0.76 });
  const ACCEPT_POWER_BAR = 0.38;
  const READ_SLOPE = 0.05;
  const READ_LEAD_BONUS = 0.08; // cada rodada de vantagem explica parte da ousadia

  // ---------- níveis de dificuldade ----------

  const LEVELS = Object.freeze({
    facil: Object.freeze({
      samples: 20, // amostras para avaliar pedidos (poucas: leitura ruidosa)
      simulatePlay: false, // escolhe a carta por regra simples
      counting: 'none', // esquece o que já saiu nas rodadas anteriores
      inferenceFloor: 1, // 1 = não lê o adversário pelos pedidos
      blunder: 0.2, // chance de jogar uma carta qualquer
      forgetPartner: 0.45, // chance de não reparar que o parceiro já está ganhando
      noise: 0.12, // ruído na leitura da própria chance
      acceptBias: 0.12, // aceita pedido demais
      bluff: 0.025, // chance-base de blefe por mão (sorteio único por mão)
      bluffCriteria: false, // blefa sem olhar a situação
      callMargin: 0,
      sigma: 0.22,
      belief: 0.15,
      keepLowEpsilon: 0,
    }),
    medio: Object.freeze({
      samples: 40,
      simulatePlay: true,
      counting: 'partial', // lembra só manilhas e 3s que já saíram
      inferenceFloor: 0.35, // lê os pedidos só um pouco
      blunder: 0.03,
      forgetPartner: 0,
      noise: 0.04,
      acceptBias: 0.03,
      bluff: 0.018,
      bluffCriteria: true,
      callMargin: 0.004,
      sigma: 0.2,
      belief: 0.15,
      keepLowEpsilon: 0.04,
    }),
    dificil: Object.freeze({
      samples: 110,
      simulatePlay: true,
      counting: 'full',
      inferenceFloor: 0.06, // quem pediu/aceitou provavelmente tem mão: pondera as amostras
      blunder: 0,
      forgetPartner: 0,
      noise: 0,
      acceptBias: 0,
      bluff: 0.022,
      bluffCriteria: true,
      callMargin: 0.002,
      sigma: 0.2,
      belief: 0.15,
      keepLowEpsilon: 0.02,
    }),
  });

  // ---------- PRNG ----------

  function toUint32(seed) {
    const n = Number(seed);
    if (!Number.isFinite(n)) return 0;
    return Math.trunc(n) >>> 0;
  }

  function mix(a, b) {
    let h = Math.imul((a ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ Math.imul(b >>> 0, 0xc2b2ae35);
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15;
    return h >>> 0;
  }

  function createRng(seed) {
    let a = toUint32(seed);
    const rng = {
      next() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      int(n) {
        return Math.floor(rng.next() * n);
      },
      chance(p) {
        return rng.next() < p;
      },
      pick(list) {
        return list[rng.int(list.length)];
      },
      /** Aproximadamente normal(0, 1) (soma de uniformes). */
      gauss() {
        return rng.next() + rng.next() + rng.next() + rng.next() - 2;
      },
    };
    return rng;
  }

  // ---------- utilidades de regra ----------

  function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
  }

  function toCard(cardOrId) {
    return typeof cardOrId === 'string' ? Rules.cardFromId(cardOrId) : cardOrId;
  }

  function inferDeck(cards, manilhaRank) {
    const dirty = ['4', '5', '6', '7'];
    if (dirty.includes(manilhaRank)) return 'sujo';
    return cards.some((c) => dirty.includes(c.rank)) ? 'sujo' : 'limpo';
  }

  /** Resultado da mão pelos resultados das rodadas (RULES.md §7.1): 0 | 1 | 'none' | null. */
  function handResult(results) {
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
    if (ties >= 1 && v0 + v1 >= 1) {
      for (const r of results) if (r !== 'tie') return r;
    }
    if (results.length >= 3) return 'none';
    return null;
  }

  // ---------- força da mão ----------

  /** Percentil da carta no baralho: fração das outras cartas que ela vence (empate conta meio). */
  function cardPower(card, manilhaRank, deck) {
    const s = Rules.strength(card, manilhaRank, deck);
    let below = 0;
    let equal = 0;
    let total = 0;
    for (const other of Rules.makeDeck(deck)) {
      if (other.id === card.id) continue;
      total++;
      const o = Rules.strength(other, manilhaRank, deck);
      if (o < s) below++;
      else if (o === s) equal++;
    }
    return (below + equal / 2) / total;
  }

  const HAND_WEIGHTS = [0.5, 0.32, 0.18];

  /**
   * Força da mão entre 0 e 1 (aproxima a chance de vencer uma mão 1x1 contra cartas ao acaso).
   * `deck` é opcional: sem ele, o baralho é deduzido das cartas (qualquer 4–7 indica o sujo).
   */
  function handStrength(cards, manilhaRank, deck) {
    const list = (cards || []).filter((c) => c && !c.hidden).map(toCard);
    if (!list.length || !manilhaRank) return 0;
    const deckName = deck || inferDeck(list, manilhaRank);
    const powers = list.map((c) => cardPower(c, manilhaRank, deckName)).sort((x, y) => y - x);
    let sum = 0;
    let weight = 0;
    for (let i = 0; i < Math.min(3, powers.length); i++) {
      sum += HAND_WEIGHTS[i] * powers[i];
      weight += HAND_WEIGHTS[i];
    }
    const raw = sum / weight;
    // Curva ajustada contra simulações 1x1: mão média ~0,5; lixo perto de 0; casal maior perto de 1.
    return clamp(1 / (1 + Math.exp(-9.5 * (raw - 0.6))), 0, 1);
  }

  /** Força rápida sobre forças numéricas (para ponderar amostras); `top` = maior força comum do baralho. */
  function quickPower(strengths, top) {
    if (!strengths.length) return 0;
    const powers = strengths
      .map((s) => (s >= MANILHA ? 0.86 + 0.045 * (s - MANILHA) : (0.78 * Math.max(0, s)) / top))
      .sort((x, y) => y - x);
    let sum = 0;
    let weight = 0;
    for (let i = 0; i < Math.min(3, powers.length); i++) {
      sum += HAND_WEIGHTS[i] * powers[i];
      weight += HAND_WEIGHTS[i];
    }
    return sum / weight;
  }

  // ---------- chance de vencer o jogo: W(nós, eles) ----------

  // Distribuição típica do valor de uma mão normal (1, truco, seis, nove, doze).
  const HAND_VALUE_ODDS = [
    [1, 0.55],
    [3, 0.3],
    [6, 0.1],
    [9, 0.035],
    [12, 0.015],
  ];

  function buildWinTable() {
    const memo = [];
    for (let i = 0; i < WIN_SCORE; i++) memo.push(new Array(WIN_SCORE).fill(null));
    function W(a, b) {
      if (a >= WIN_SCORE) return 1;
      if (b >= WIN_SCORE) return 0;
      if (memo[a][b] !== null) return memo[a][b];
      let w;
      if (a === 11 && b === 11) w = 0.5;
      else if (a === 11) w = onze(b);
      else if (b === 11) w = 1 - onze(a);
      else {
        w = 0;
        for (const [v, pr] of HAND_VALUE_ODDS) w += pr * 0.5 * (W(a + v, b) + W(a, b + v));
      }
      memo[a][b] = w;
      return w;
    }
    // Time com 11 contra `b`: joga (vale 3) quando a chance e da mão compensa; e ~ U(0,1).
    function onze(b) {
      const run = W(11, b + 1);
      const lose = W(11, b + 3);
      const cut = lose >= 1 ? 0 : clamp((run - lose) / (1 - lose), 0, 1);
      const play = (1 - cut * cut) / 2 + lose * (1 - cut - (1 - cut * cut) / 2);
      return cut * run + play;
    }
    for (let a = 0; a < WIN_SCORE; a++) for (let b = 0; b < WIN_SCORE; b++) W(a, b);
    return memo;
  }

  const WIN_TABLE = buildWinTable();

  /** Chance de o time com `a` pontos vencer o jogo contra `b` (ambos podem passar de 12). */
  function winChance(a, b) {
    if (a >= WIN_SCORE) return 1;
    if (b >= WIN_SCORE) return 0;
    return WIN_TABLE[a][b];
  }

  function normCdf(x) {
    const z = Math.abs(x) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * z);
    const poly = (((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592;
    const erf = 1 - poly * t * Math.exp(-z * z);
    return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
  }

  function normPdf(x) {
    return Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
  }

  /**
   * Valor (em W) de desafiar o adversário: ele corre e nós levamos `runPoints`, ou aceita e a mão vale
   * `stake`. `share` é a nossa chance de vencer a mão decidida, vista por nós.
   *
   * Modelo: a chance verdadeira T varia em torno de `share` conforme as cartas dele, com desvio que some
   * nas certezas (`sigma`·2·√(share·(1−share))); ele não vê as nossas cartas, então enxerga T com um erro
   * extra `belief`. Corre quando, pelo que enxerga, aceitar nos daria mais W que correr (T acima de tau).
   * Se aceita, a nossa chance cai para E[T | ele aceitou].
   */
  function challengeValue(a, b, share, none, runPoints, stake, sigma, belief) {
    const wRun = winChance(a + runPoints, b);
    const wWin = winChance(a + stake, b);
    const wLose = winChance(a, b + stake);
    const wNone = winChance(a, b);
    const span = wWin - wLose;
    if (span < EPS) {
      const accept = (1 - none) * wWin + none * wNone;
      return Math.min(wRun, accept);
    }
    const tau = (wRun - wLose) / span;
    const sdTruth = sigma * 2 * Math.sqrt(clamp(share * (1 - share), 0, 0.25));
    const sdSeen = Math.sqrt(sdTruth * sdTruth + belief * belief);
    const z = (tau - share) / sdSeen;
    const acceptProb = normCdf(z);
    let shareIfAccepted = share;
    if (acceptProb > 1e-6) {
      shareIfAccepted = clamp(share - ((sdTruth * sdTruth) / sdSeen) * (normPdf(z) / acceptProb), 0, 1);
    }
    const acceptW = (1 - none) * (shareIfAccepted * wWin + (1 - shareIfAccepted) * wLose) + none * wNone;
    return (1 - acceptProb) * wRun + acceptProb * acceptW;
  }

  // ---------- simulação (Monte Carlo com determinização) ----------

  /** Índice da carta que a política gulosa joga, vendo a mesa (`seats`/`strs` em ordem de jogo). */
  function greedyIndex(hand, seats, strs, seat) {
    let hi = 0;
    let lo = 0;
    for (let i = 1; i < hand.length; i++) {
      if (hand[i] > hand[hi]) hi = i;
      if (hand[i] < hand[lo]) lo = i;
    }
    if (seats.length === 0) return hi;
    const team = seat % 2;
    let mine = -2;
    let theirs = -2;
    for (let k = 0; k < seats.length; k++) {
      const s = strs[k];
      if (s < 0) continue;
      if (seats[k] % 2 === team) {
        if (s > mine) mine = s;
      } else if (s > theirs) theirs = s;
    }
    if (mine > theirs) return lo;
    let beat = -1;
    for (let i = 0; i < hand.length; i++) {
      if (hand[i] > theirs && (beat < 0 || hand[i] < hand[beat])) beat = i;
    }
    if (beat >= 0) return beat;
    if (mine < theirs && theirs < MANILHA) {
      for (let i = 0; i < hand.length; i++) if (hand[i] === theirs) return i;
    }
    return lo;
  }

  /** Apura uma rodada completa: { result: 0|1|'tie', leader }. */
  function resolveRoundStrengths(seats, strs) {
    let best = -2;
    let first = -1;
    let tie = false;
    for (let k = 0; k < seats.length; k++) {
      const s = strs[k];
      if (s < 0) continue;
      if (s > best) {
        best = s;
        first = k;
        tie = false;
      } else if (s === best && seats[k] % 2 !== seats[first] % 2) {
        tie = true;
      }
    }
    return { result: tie ? 'tie' : seats[first] % 2, leader: seats[first] };
  }

  /** Joga a mão até o fim com a política gulosa. Retorna 0 | 1 | 'none'. */
  function rollout(N, hands, seats, strs, leader, results) {
    for (;;) {
      while (seats.length < N) {
        const seat = (leader + seats.length) % N;
        const hand = hands[seat];
        const idx = greedyIndex(hand, seats, strs, seat);
        seats.push(seat);
        strs.push(hand[idx]);
        hand.splice(idx, 1);
      }
      const round = resolveRoundStrengths(seats, strs);
      results.push(round.result);
      const outcome = handResult(results);
      if (outcome !== null) return outcome;
      leader = round.leader;
      seats.length = 0;
      strs.length = 0;
    }
  }

  /**
   * Monta o "mundo" como o bot o enxerga: forças das cartas conhecidas, cartas ainda não vistas (conforme
   * a contagem da dificuldade), mesa da rodada atual e resultados.
   */
  function buildWorld(view, level) {
    const N = view.players;
    const deck = view.deck;
    const manilhaRank = view.manilhaRank;
    const me = view.seat;
    const strength = (c) => Rules.strength(c, manilhaRank, deck);
    const known = new Array(N).fill(null);
    const excluded = new Set([view.vira.id]);

    known[me] = view.myHand.map(strength);
    for (const c of view.myHand) excluded.add(c.id);
    const partner = N === 4 ? (me + 2) % N : -1;
    if (partner >= 0 && Array.isArray(view.partnerHand)) {
      known[partner] = view.partnerHand.map(strength);
      for (const c of view.partnerHand) excluded.add(c.id);
    }
    view.rounds.forEach((round, ri) => {
      for (const p of round.plays) {
        if (!p.card) continue;
        const remembered =
          ri === view.roundIndex ||
          p.seat === me ||
          level.counting === 'full' ||
          (level.counting === 'partial' && (p.card.rank === manilhaRank || p.card.rank === '3'));
        if (remembered) excluded.add(p.card.id);
      }
    });

    const pool = [];
    for (const c of Rules.makeDeck(deck)) if (!excluded.has(c.id)) pool.push(strength(c));
    const hiddenSeats = [];
    let need = 0;
    for (let s = 0; s < N; s++) {
      if (known[s] === null) {
        hiddenSeats.push(s);
        need += view.handSizes[s];
      }
    }
    if (need > pool.length) throw new Error('Visão inconsistente: faltam cartas para sortear');

    const round = view.rounds[view.roundIndex];
    return {
      N,
      me,
      team: me % 2,
      deck,
      manilhaRank,
      topCommon: Rules.DECKS[deck].length - 1,
      known,
      pool,
      hiddenSeats,
      need,
      handSizes: view.handSizes.slice(),
      playSeats: round.plays.map((p) => p.seat),
      playStrs: round.plays.map((p) => (p.faceDown ? FACE_DOWN : strength(p.card))),
      leader: round.leader,
      results: view.roundResults.slice(),
    };
  }

  /**
   * Simula `samples` distribuições das cartas ocultas. Para cada candidata (força de uma carta minha a
   * jogar agora; `null` = todos pela política gulosa), conta vitórias, derrotas e três empates, com as
   * mesmas amostras para todas as candidatas. `weigh(hands)` pondera cada amostra (inferência).
   */
  function simulate(world, rng, samples, candidates, weigh) {
    const stats = candidates.map(() => ({ p: 0, q: 0, n: 0 }));
    const pool = world.pool.slice();
    const N = world.N;
    let total = 0;
    for (let i = 0; i < samples; i++) {
      for (let k = 0; k < world.need; k++) {
        const j = k + rng.int(pool.length - k);
        const tmp = pool[k];
        pool[k] = pool[j];
        pool[j] = tmp;
      }
      const base = world.known.slice();
      let pos = 0;
      for (const s of world.hiddenSeats) {
        const size = world.handSizes[s];
        base[s] = pool.slice(pos, pos + size);
        pos += size;
      }
      const w = weigh ? weigh(base) : 1;
      total += w;
      for (let c = 0; c < candidates.length; c++) {
        const hands = new Array(N);
        for (let s = 0; s < N; s++) hands[s] = base[s].slice();
        const seats = world.playSeats.slice();
        const strs = world.playStrs.slice();
        const cand = candidates[c];
        if (cand !== null) {
          const mine = hands[world.me];
          mine.splice(mine.indexOf(cand), 1);
          seats.push(world.me);
          strs.push(cand);
        }
        const outcome = rollout(N, hands, seats, strs, world.leader, world.results.slice());
        if (outcome === world.team) stats[c].p += w;
        else if (outcome === 'none') stats[c].n += w;
        else stats[c].q += w;
      }
    }
    for (const st of stats) {
      st.p /= total;
      st.q /= total;
      st.n /= total;
    }
    return stats;
  }

  /**
   * Leitura do adversário: pondera cada amostra pela chance de a mão sorteada de `suspects` fazer o que
   * eles fizeram (pedir ou aceitar), uma logística em torno de `bar`. `floor` é o peso de uma mão fraca
   * (blefe sempre é possível).
   */
  function makeWeigher(world, read, floor) {
    if (!read || floor >= 1) return null;
    return (hands) => {
      let best = 0;
      for (const s of read.suspects) best = Math.max(best, quickPower(hands[s], world.topCommon));
      return floor + (1 - floor) / (1 + Math.exp(-(best - read.bar) / READ_SLOPE));
    };
  }

  // ---------- análise da mesa e candidatas ----------

  function tableInfo(world) {
    let teamTable = -2;
    let oppTable = -2;
    for (let k = 0; k < world.playSeats.length; k++) {
      const s = world.playStrs[k];
      if (s < 0) continue;
      if (world.playSeats[k] % 2 === world.team) teamTable = Math.max(teamTable, s);
      else oppTable = Math.max(oppTable, s);
    }
    return { teamTable, oppTable, after: world.N - world.playSeats.length - 1 };
  }

  /** A carta só importa para a rodada se melhorar a maior carta do time e ao menos empatar a deles. */
  function isRelevant(s, info) {
    return s > info.teamTable && (s > info.oppTable || (s === info.oppTable && s < MANILHA));
  }

  function roundOutcomeIfLast(s, info) {
    const mine = Math.max(info.teamTable, s);
    if (mine > info.oppTable) return 'win';
    if (mine === info.oppTable && mine < MANILHA) return 'tie';
    return 'lose';
  }

  /**
   * Candidatas que valem simular: uma por força; das irrelevantes só a menor. Se sou o último da rodada,
   * uma por resultado (vencer, cangar, perder), e se alguma já decide a mão a nosso favor, ela é a jogada.
   * Retorna { forced } ou { candidates } (listas de {card, s} em ordem crescente de força).
   */
  function pickCandidates(cards, strengths, world, info) {
    const order = cards.map((card, i) => ({ card, s: strengths[i] })).sort((x, y) => x.s - y.s);
    const uniq = [];
    for (const o of order) if (!uniq.length || uniq[uniq.length - 1].s !== o.s) uniq.push(o);

    if (info.after === 0) {
      const byOutcome = new Map();
      for (const u of uniq) {
        const o = roundOutcomeIfLast(u.s, info);
        if (!byOutcome.has(o)) byOutcome.set(o, u);
      }
      const asResult = { win: world.team, lose: 1 - world.team, tie: 'tie' };
      let decisive = null;
      for (const [o, u] of byOutcome) {
        const winsHand = handResult(world.results.concat(asResult[o])) === world.team;
        if (winsHand && (!decisive || u.s < decisive.s)) decisive = u;
      }
      if (decisive) return { forced: decisive };
      return { candidates: Array.from(byOutcome.values()).sort((x, y) => x.s - y.s) };
    }

    const relevant = uniq.filter((u) => isRelevant(u.s, info));
    const irrelevant = uniq.find((u) => !isRelevant(u.s, info));
    const candidates = irrelevant ? [irrelevant].concat(relevant) : relevant;
    if (candidates.length === 1) return { forced: candidates[0] };
    return { candidates };
  }

  function utility(st) {
    return st.p - st.q;
  }

  // ---------- falas (RULES.md §11.2; nada de §11.3) ----------

  const CALL_LINES = Object.freeze({
    3: [
      'Truco!', 'Truco, ladrão!', 'Truco, marreco!', 'Truco! Vai encarar?', 'Truco! Quero ver agora.',
      'Truco! Segura essa.', 'Truco! E aí, vem ou não vem?',
    ],
    6: ['Seis!', 'É seis!', 'Meio-pau!', 'Seis, ladrão!', 'Seis! Aguenta essa?', 'Meio-pau neles!'],
    9: ['Nove!', 'Nove neles!', 'É nove!', 'Nove! Quero ver correr.', 'Nove, e não se fala mais nisso!'],
    12: ['Doze!', 'Queda!', 'É doze!', 'Doze! Agora é tudo ou nada.', 'Queda, e seja o que Deus quiser!'],
  });

  // Aumento é resposta a um pedido: falas próprias, para não repetir as de CALL_LINES (cada fala numa
  // lista só).
  const RAISE_LINES = Object.freeze({
    6: [
      'Truco? Seis!', 'Então é seis!', 'Truco nada, é seis!', 'Seis! Ferro neles!', 'É seis, ladrão!',
      'Meio-pau, marreco!',
    ],
    9: ['Seis? Nove!', 'Então é nove!', 'Seis nada, é nove!', 'É nove! Ferro neles!', 'Nove, ladrão!'],
    12: ['Nove? Doze!', 'Então é doze!', 'Nove nada, é queda!', 'Doze! Ferro neles!', 'Queda, marreco!'],
  });

  const PHRASES = Object.freeze({
    raise: ['Ferro neles!', 'Sobe mais um!', 'Ferro neles, que essa é nossa!'],
    accept: [
      'Cai!', 'Venha!', 'Manda!', 'Aceito!', 'Joga!', 'Pode vir!', 'Manda que eu gosto!', 'Vem que tem!',
      'Cai dentro!', 'Bora!',
    ],
    run: [
      'Corro!', 'Não quero!', 'Essa eu corro.', 'Corro, pode levar.', 'Fica pra próxima.', 'Tô fora dessa.',
      'Não quero, leva essa.', 'Corro... por enquanto.',
    ],
    winRound: [
      'Essa é nossa!', 'Tá no papo!', 'Vai tomando!', 'Olha a casinha de caboclo...', 'É assim que se joga!',
      'Levei essa!', 'Marreco!',
    ],
    firstRound: [
      'A primeira vai à missa!', 'A primeira é nossa!', 'Quem fez a primeira? Nós!',
      'A primeira vai à missa, hein!',
    ],
    loseRound: [
      'Tá bom, essa é sua.', 'Foi sorte!', 'Deixa estar...', 'Calma, que a mão não acabou.',
      'De quem é o três?', 'Hum... tá bom.', 'Tô de pé frio hoje.',
    ],
    tie: ['Cangou!', 'Melou!', 'Embuchou!', 'Empachou!', 'Cangou! Agora é na próxima.', 'Melou tudo!'],
    maoDeOnzePlay: [
      'Vamos jogar!', 'Mão de onze? A gente joga!', 'Essa dá pra jogar!', 'Bora, que essa é nossa!',
      'Jogamos!',
    ],
    maoDeOnzeRun: [
      'Assim eu não jogo.', 'Essa não dá, corro.', 'Melhor correr dessa.', 'Dama sem calça... corro.',
      'Não quero, fica pra próxima.',
    ],
    idle: [
      'Quem fez a primeira?', 'Estou com uma mão boa...', 'Hmm...', 'Deixa eu pensar...',
      'Esse pingado tá bom, hein.', 'Traz mais um pingado aí!', 'Joga logo, que o café esfria!',
      'Hoje eu tô com sorte.', 'Bora, que a noite é longa.',
    ],
    winHand: [
      'Pode marcar!', 'Mais tampinha pra cá!', 'Tento nosso!', 'Vai tomando, marreco!', 'Essa foi fácil.',
    ],
    loseHand: [
      'Tá bom, tá bom...', 'Essa passou.', 'A próxima é nossa.', 'Pé frio!', 'Aproveita, que dura pouco.',
    ],
    winMatch: [
      'Acabou, marreco!', 'Quem perdeu paga o café!', 'Pode ir pagando o pingado!',
      'É assim que se joga truco!',
    ],
    loseMatch: [
      'Amanhã tem revanche.', 'Hoje não foi dia.', 'Tá bom, o café é por minha conta.',
      'Parabéns... mas amanhã eu volto.',
    ],
    faceDown: [
      'Essa vai no escuro.', 'Vai coberta.', 'No escuro, que é melhor.', 'Essa eu não mostro.', 'Vai de costas.',
      'Segredo meu.', 'Essa ninguém vê.',
    ],
  });

  // ---------- o bot ----------

  function defaultPersonality(seed) {
    const r = createRng(mix(toUint32(seed), 0x51ed270b));
    return { bluff: 0.2 + 0.55 * r.next(), caution: 0.25 + 0.5 * r.next() };
  }

  function normalizePersonality(p, seed) {
    const base = defaultPersonality(seed);
    const pick = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 1) : fallback);
    return { bluff: pick(p && p.bluff, base.bluff), caution: pick(p && p.caution, base.caution) };
  }

  function pickSeat(seats, seat) {
    return seats.includes(seat) ? seat : seats[0];
  }

  /** Ação sempre válida para a decisão (usada se a estratégia falhar com uma visão inesperada). */
  function safeAction(decision, seat) {
    switch (decision && decision.kind) {
      case 'startHand':
        return { type: 'START_HAND' };
      case 'maoDeOnze':
        return { type: 'MAO_DE_ONZE', seat: pickSeat(decision.seats, seat), accept: true };
      case 'callResponse':
        return { type: 'ACCEPT', seat: pickSeat(decision.seats, seat) };
      case 'play':
        if (decision.blind || !decision.playableCardIds.length) {
          return { type: 'PLAY', seat: decision.seat, index: decision.playableIndexes[0], faceDown: false };
        }
        return { type: 'PLAY', seat: decision.seat, cardId: decision.playableCardIds[0], faceDown: false };
      default:
        return null;
    }
  }

  /** Move `delta` de probabilidade entre vitória e derrota, mantendo a de três empates. */
  function shade(eq, delta) {
    const decided = Math.max(0, 1 - eq.n);
    const p = clamp(eq.p + delta, 0, decided);
    return { p, q: decided - p, n: eq.n };
  }

  function shareOf(eq) {
    const decided = eq.p + eq.q;
    return decided > EPS ? eq.p / decided : 0.5;
  }

  function create(config) {
    const cfg = config || {};
    const difficulty = Object.prototype.hasOwnProperty.call(LEVELS, cfg.difficulty) ? cfg.difficulty : 'medio';
    const level = LEVELS[difficulty];
    const seed = toUint32(cfg.seed);
    const seat = Number.isInteger(cfg.seat) ? cfg.seat : 0;
    const personality = normalizePersonality(cfg.personality, seed);
    const strict = cfg.strict === true;
    const rng = createRng(mix(seed, 0x2545f491));
    const talk = createRng(mix(seed, 0x68e31da4));
    const lastLine = {};

    const cautionShift = 0.14 * (personality.caution - 0.5);
    const bluffFactor = 0.4 + 1.6 * personality.bluff;

    /**
     * Sorteio fixo por mão (e por motivo): blefar ou esconder o jogo se decide uma vez por mão, não a
     * cada oportunidade de pedir (senão a chance real multiplica pelo número de vezes de jogar).
     */
    function handDraw(view, key) {
      return createRng(mix(mix(seed, view.handNumber * 131 + view.gameNumber), key)).next();
    }

    function scores(view) {
      return { a: view.score[view.team], b: view.score[1 - view.team] };
    }

    /**
     * O que os pedidos dizem das cartas adversárias: quem pediu `proposed` (numa resposta) ou, depois de um
     * pedido aceito, o time que pediu ou aceitou. Rodadas já ganhas explicam parte da ousadia.
     */
    function readOpponents(view, callerSeat, proposed) {
      if (level.inferenceFloor >= 1 || view.special !== null) return null;
      const oppTeam = 1 - view.team;
      const suspects = [];
      for (let s = 0; s < view.players; s++) if (s % 2 === oppTeam) suspects.push(s);
      let bar;
      if (callerSeat !== null && callerSeat !== undefined) {
        bar = CALL_POWER_BAR[proposed] || CALL_POWER_BAR[3];
        suspects.length = 0;
        suspects.push(callerSeat);
      } else if (view.value > 1) {
        bar = view.lastCallTeam === oppTeam ? CALL_POWER_BAR[view.value] || CALL_POWER_BAR[3] : ACCEPT_POWER_BAR;
      } else {
        return null;
      }
      let lead = 0;
      for (const r of view.roundResults) {
        if (r === oppTeam) lead++;
        else if (r === view.team) lead--;
      }
      return { suspects, bar: bar - READ_LEAD_BONUS * lead };
    }

    /** Chance de vencer a mão a partir de agora (com a política gulosa para todos, eu incluso). */
    function equityNow(view, r, callerSeat, proposed) {
      const world = buildWorld(view, level);
      const weigh = makeWeigher(world, readOpponents(view, callerSeat, proposed), level.inferenceFloor);
      if (view.turn === view.seat && view.myHand.length) {
        const plan = planWithSimulation(view, view.myHand, world, r, weigh, true);
        if (plan.equity) return plan.equity;
      }
      return simulate(world, r, level.samples, [null], weigh)[0];
    }

    /**
     * Escolhe a carta simulando as candidatas. Com `needEquity`, garante a chance da melhor jogada mesmo
     * quando só havia uma candidata.
     */
    function planWithSimulation(view, cards, world, r, weigh, needEquity) {
      const strengths = cards.map((c) => Rules.strength(c, view.manilhaRank, view.deck));
      const info = tableInfo(world);
      const pick = pickCandidates(cards, strengths, world, info);
      if (pick.forced) {
        const equity = needEquity ? simulate(world, r, level.samples, [pick.forced.s], weigh)[0] : null;
        return { card: pick.forced.card, s: pick.forced.s, info, equity };
      }
      const stats = simulate(world, r, level.samples, pick.candidates.map((c) => c.s), weigh);
      let best = 0;
      for (let i = 1; i < stats.length; i++) {
        if (utility(stats[i]) > utility(stats[best]) + level.keepLowEpsilon) best = i;
      }
      const chosen = pick.candidates[best];
      return { card: chosen.card, s: chosen.s, info, equity: stats[best] };
    }

    /** Jogada do fácil: política gulosa com esquecimentos e, às vezes, uma carta qualquer. */
    function planSimple(view, cards, world, r) {
      const strengths = cards.map((c) => Rules.strength(c, view.manilhaRank, view.deck));
      const info = tableInfo(world);
      if (r.chance(level.blunder)) {
        const i = r.int(cards.length);
        return { card: cards[i], s: strengths[i], info, equity: null };
      }
      let seats = world.playSeats;
      let strs = world.playStrs;
      if (world.N === 4 && r.chance(level.forgetPartner)) {
        // Esquece a carta do parceiro e tenta ganhar a rodada sozinho.
        const opp = seats.map((s) => s % 2 !== world.team);
        seats = seats.filter((_, k) => opp[k]);
        strs = strs.filter((_, k) => opp[k]);
      }
      const i = greedyIndex(strengths, seats, strs, world.me);
      return { card: cards[i], s: strengths[i], info, equity: null };
    }

    /**
     * Encobre só quando a carta não muda a rodada (não melhora a maior do time nem alcança a deles):
     * aí jogá-la aberta só daria informação. Cartas boas descartadas sempre vão cobertas.
     */
    function shouldHide(plan, decision, deck, r) {
      if (!decision.canFaceDown || isRelevant(plan.s, plan.info)) return false;
      if (difficulty === 'facil') return r.chance(0.08);
      const worthHiding = plan.s >= MANILHA || plan.s >= Rules.DECKS[deck].length - 2;
      return worthHiding || r.chance(0.12 + 0.25 * personality.bluff);
    }

    function bluffSpot(view, info) {
      let factor = 1;
      const last = info && info.after === 0;
      if (view.roundIndex === 2 && last) factor *= 2;
      if (view.roundResults[0] === view.team) factor *= 1.3;
      return factor;
    }

    function wantsToCall(view, decision, equity, info, r) {
      const { a, b } = scores(view);
      const v = view.value;
      const next = decision.callValue;
      const eq = shade(equity, -cautionShift + level.noise * r.gauss());
      const share = shareOf(eq);
      const noCall = eq.p * winChance(a + v, b) + eq.q * winChance(a, b + v) + eq.n * winChance(a, b);
      const call = challengeValue(a, b, share, eq.n, v, next, level.sigma, level.belief);
      const behind = Math.max(0, b - a);
      // Sem risco de perder a mão, pedir nunca custa (no pior caso ele corre e dá o mesmo ponto), mas
      // gente de verdade às vezes esconde o jogo: pede com a certa só numa parte das mãos.
      if (equity.q < 0.005 && share >= CALL_FLOOR[next] && call > noCall - EPS) {
        // Abrindo a última rodada com a certa, o adversário ainda decide sem saber a carta: sempre pede.
        if (view.roundIndex === 2 && info && info.after === view.players - 1) return true;
        const base = view.roundIndex === 2 ? CERTAIN_CALL.last : CERTAIN_CALL.early;
        return handDraw(view, 0xce27) < base * (0.6 + 0.8 * personality.bluff);
      }
      const margin = level.callMargin - 0.0015 * behind;
      if (share >= CALL_FLOOR[next] && call > noCall + margin) return true;
      if (next > MAX_BLUFF_VALUE) return false;
      let chance = level.bluff * bluffFactor * (1 + behind / 8);
      if (level.bluffCriteria) {
        if (call < noCall - (0.02 + 0.03 * personality.bluff)) return false;
        chance *= bluffSpot(view, info);
      }
      return handDraw(view, 0x0b1e) < chance;
    }

    function chooseResponse(view, decision, equity, r, advising) {
      const { a, b } = scores(view);
      const cur = decision.currentValue;
      const prop = decision.proposedValue;
      const noise = advising ? 0 : level.noise * r.gauss();
      const eq = shade(equity, -cautionShift + noise);
      const share = shareOf(eq);
      const run = winChance(a, b + cur);
      const stay = (e) => e.p * winChance(a + prop, b) + e.q * winChance(a, b + prop) + e.n * winChance(a, b);
      const accept = stay(eq);
      if (decision.canRaise) {
        const raise = challengeValue(a, b, share, eq.n, prop, decision.raiseValue, level.sigma, level.belief);
        const best = Math.max(accept, run);
        const margin = 0.004 + 0.012 * personality.caution;
        if (share >= RAISE_FLOOR[decision.raiseValue] && raise - margin > best) return 'raise';
        const bluffable = !advising && level.bluffCriteria && decision.raiseValue <= MAX_BLUFF_VALUE;
        if (bluffable && raise > best - 0.015 && r.chance(RAISE_BLUFF * personality.bluff)) return 'raise';
      }
      // Se correr entrega o jogo (W = 0), aceitar nunca é pior. O fácil aceita mais do que devia.
      // O viés de aceitar é defeito do jogador fácil, não entra no conselho ao parceiro humano.
      const acceptLoose = level.acceptBias && !advising ? stay(shade(eq, level.acceptBias)) : accept;
      return acceptLoose >= run ? 'accept' : 'run';
    }

    function chooseMaoDeOnze(view, equity, r, advising) {
      const { a, b } = scores(view);
      const noise = advising ? 0 : level.noise * r.gauss();
      const eq = shade(equity, -cautionShift + (advising ? 0 : level.acceptBias * 0.5) + noise);
      const play = eq.p * winChance(a + 3, b) + eq.q * winChance(a, b + 3) + eq.n * winChance(a, b);
      const run = winChance(a, b + 1);
      return play >= run;
    }

    function decidePlay(view, decision) {
      if (decision.blind || !decision.playableCardIds.length) {
        const indexes = decision.playableIndexes;
        return { type: 'PLAY', seat: decision.seat, index: indexes[rng.int(indexes.length)], faceDown: false };
      }
      const cards = decision.playableCardIds.map(Rules.cardFromId);
      const world = buildWorld(view, level);
      let plan;
      let equity = null;
      if (level.simulatePlay) {
        const weigh = makeWeigher(world, readOpponents(view, null, null), level.inferenceFloor);
        plan = planWithSimulation(view, cards, world, rng, weigh, decision.canCall);
        equity = plan.equity;
        if (rng.chance(level.blunder)) {
          const i = rng.int(cards.length);
          const s = Rules.strength(cards[i], view.manilhaRank, view.deck);
          plan = { card: cards[i], s, info: plan.info, equity };
        }
      } else {
        plan = planSimple(view, cards, world, rng);
        if (decision.canCall) equity = simulate(world, rng, level.samples, [null], null)[0];
      }
      if (decision.canCall && equity && wantsToCall(view, decision, equity, plan.info, rng)) {
        return { type: 'CALL', seat: decision.seat };
      }
      const faceDown = shouldHide(plan, decision, view.deck, rng);
      return { type: 'PLAY', seat: decision.seat, cardId: plan.card.id, faceDown };
    }

    function decideInner(view, decision) {
      switch (decision.kind) {
        case 'startHand':
          return { type: 'START_HAND' };
        case 'matchOver':
          return null;
        case 'maoDeOnze': {
          const who = pickSeat(decision.seats, view.seat);
          const accept = chooseMaoDeOnze(view, equityNow(view, rng, null), rng, false);
          return { type: 'MAO_DE_ONZE', seat: who, accept };
        }
        case 'callResponse': {
          const who = pickSeat(decision.seats, view.seat);
          const equity = equityNow(view, rng, decision.callerSeat, decision.proposedValue);
          const answer = chooseResponse(view, decision, equity, rng, false);
          const type = answer === 'raise' && decision.canRaise ? 'RAISE' : answer === 'run' ? 'RUN' : 'ACCEPT';
          return { type, seat: who };
        }
        case 'play':
          return decidePlay(view, decision);
        default:
          throw new Error(`Decisão desconhecida: ${String(decision.kind)}`);
      }
    }

    function adviseInner(view, decision) {
      // Conselho determinístico para a mesma situação, sem mexer no PRNG das jogadas.
      const round = view.rounds[view.roundIndex];
      const r = createRng(mix(mix(seed, view.handNumber * 64 + view.roundIndex * 8 + round.plays.length), view.value));
      if (decision.kind === 'callResponse') {
        const equity = equityNow(view, r, decision.callerSeat, decision.proposedValue);
        const answer = chooseResponse(view, decision, equity, r, true);
        return answer === 'raise' && !decision.canRaise ? 'accept' : answer;
      }
      if (decision.kind === 'maoDeOnze') {
        return chooseMaoDeOnze(view, equityNow(view, r, null), r, true) ? 'accept' : 'run';
      }
      return null;
    }

    const bot = {
      seat,
      difficulty,
      personality: Object.freeze({ ...personality }),

      /** Ação para a decisão atual, usando só a visão do próprio assento. */
      decide(view, decision) {
        try {
          return decideInner(view, decision);
        } catch (err) {
          if (strict) throw err;
          return safeAction(decision, view && Number.isInteger(view.seat) ? view.seat : seat);
        }
      },

      /** Conselho ao humano: 'accept'|'run'|'raise' (pedido) ou 'accept'|'run' (mão de onze); senão null. */
      advise(view, decision) {
        try {
          return adviseInner(view, decision);
        } catch (err) {
          if (strict) throw err;
          return decision && (decision.kind === 'callResponse' || decision.kind === 'maoDeOnze') ? 'accept' : null;
        }
      },

      /**
       * Fala para o evento. `context` opcional: número do valor (3|6|9|12) ou { value, roundIndex }.
       * Tipos extras além do contrato: winHand, loseHand, winMatch, loseMatch, faceDown.
       */
      phrase(kind, context) {
        const ctx = typeof context === 'number' ? { value: context } : context || {};
        let list;
        let key = kind;
        if (kind === 'call') {
          list = CALL_LINES[ctx.value] || CALL_LINES[3];
          key = `call${ctx.value || 3}`;
        } else if (kind === 'raise') {
          list = RAISE_LINES[ctx.value] || PHRASES.raise;
          key = `raise${ctx.value || ''}`;
        } else if (kind === 'winRound' && ctx.roundIndex === 0 && talk.chance(0.7)) {
          list = PHRASES.firstRound;
          key = 'firstRound';
        } else if (Object.prototype.hasOwnProperty.call(PHRASES, kind)) {
          list = PHRASES[kind];
        }
        if (!list || !list.length) return '';
        let line = talk.pick(list);
        if (list.length > 1 && line === lastLine[key]) {
          // Não repete a fala anterior: pula para outra qualquer da lista.
          line = list[(list.indexOf(line) + 1 + talk.int(list.length - 1)) % list.length];
        }
        lastLine[key] = line;
        return line;
      },
    };
    return bot;
  }

  const AI = {
    LEVELS,
    create,
    handStrength,
    winChance,
  };

  Truco.AI = AI;
  if (typeof module === 'object' && module.exports) module.exports = AI;
})(typeof window !== 'undefined' ? window : globalThis);
