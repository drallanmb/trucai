/*
 * TrucAÍ — Truco.Game: o controlador da partida (docs/ARCHITECTURE.md §9).
 *
 * Cada partida é uma "sessão" com um laço assíncrono:
 *   Engine.getDecision → quem decide (humano pela cena/HUD, bot pela Truco.AI com tempo de pensar)
 *   → Engine.apply → apresenta os eventos em sequência (cena 3D + HUD + áudio + falas) → repete.
 *
 * Robustez:
 *   • Toda espera (animação, pensamento) tem teto de tempo real; nenhuma promessa fica pendurada.
 *   • A sessão pode ser pausada (menu, "Como jogar") e abortada (nova partida) a qualquer momento:
 *     as esperas pendentes resolvem na hora e o laço antigo sai por ABORT. Os ouvintes da cena e do
 *     HUD são registrados uma vez e despacham para a sessão atual, então reiniciar não vaza nada.
 *   • Ação ilegal (bug) nunca trava o jogo: o erro vai para window.__truco.errors e uma ação legal
 *     segura é aplicada no lugar.
 *
 * O controlador recebe as dependências por injeção (createController), então os testes em Node
 * rodam partidas inteiras com cena e HUD falsos. No navegador, boot() liga os módulos reais.
 *
 * Parâmetros de URL (testes): ?autoplay=1 (o assento 0 também é bot) ?skipMenu=1 ?speed=N ?seed=N
 * ?players=2|4 ?deck=limpo|sujo ?format=single|bestOf3 ?difficulty=facil|medio|dificil
 * ?quality=high|low ?mute=1 ?startScore=A,B (placar inicial, 0..11 cada, para testar mão de onze/ferro)
 */
(function (root) {
  'use strict';
  const Truco = (root.Truco = root.Truco || {});

  const ABORT = Object.freeze({ aborted: true });

  /**
   * Quem senta à mesa vem das fichas de personagem (Truco.Personagens, personagens/*.js e "Meus
   * personagens"). O menu escolhe um id por lugar; sem escolha (ou id que sumiu), vale o padrão abaixo.
   * 2×2: o Vini é o seu parceiro (à sua frente), a Bia joga pela esquerda e o Seu Tião pela direita.
   */
  const DEFAULT_SEATS = Object.freeze({
    2: Object.freeze({ 1: 'tiao' }),
    4: Object.freeze({ 1: 'tiao', 2: 'vini', 3: 'bia' }),
  });

  /** Reserva se as fichas não carregarem: só nomes (o jogo continua de pé). */
  const FALLBACK_NAMES = Object.freeze({ 1: 'Tião', 2: 'Vini', 3: 'Bia' });
  const FALLBACK_GENDER = Object.freeze({ 1: 'ele', 2: 'ele', 3: 'ela' });

  /**
   * Gritos fixos de quem joga (assento 0) → arquivo em audio/vozes/voce/ (docs/AUDIO.md). Os textos são
   * os que o controlador usa em onCall/onAccept/onRun/onMaoDeOnzeDecided.
   */
  const HUMAN_CLIPS = Object.freeze({
    'TRUCO!': 'truco-1', 'SEIS!': 'seis-1', 'NOVE!': 'nove-1', 'DOZE!': 'doze-1',
    'Cai!': 'aceitar-1', 'Corro!': 'correr-1', 'Vamos jogar!': 'maoDeOnzeJoga-1',
  });

  /** Espera real (ms) pelo gesto do sinal do parceiro. */
  const SIGNAL_GUARD_MS = 2600;

  /** Tempos em ms na velocidade 1 (divididos pela velocidade escolhida). */
  const TIMING = Object.freeze({
    afterCall: 1150,
    afterCallAsk: 500, // pedido que o humano responde: o diálogo abre logo depois do tranco
    afterAnswer: 750,
    afterRound: 700,
    afterTie: 1000,
    afterHand: 1400,
    special: 1500,
    afterGame: 2400,
    beforeEnd: 1900,
  });

  /**
   * Tempo de "pensar" dos bots [mín, máx] em ms, conforme o que eles vão fazer. O pedido por valor e o
   * pedido de blefe usam a mesma faixa, para o relógio não entregar a mão.
   */
  const THINK = Object.freeze({
    call: Object.freeze([700, 1600]),
    single: Object.freeze([300, 600]),
    open: Object.freeze([800, 1600]),
    play: Object.freeze([550, 1350]),
    response: Object.freeze([1000, 2000]),
    onze: Object.freeze([1200, 2000]),
  });

  /** Tetos de tempo REAL (ms) para as animações da cena; a cena já tem guarda própria. */
  const GUARD = Object.freeze({ deal: 25000, play: 8000, mark: 6000, clear: 9000, score: 10000, partner: 6000, ready: 3500 });

  /** Espera real antes de um bot comentar a demora do humano (não escala com a velocidade). */
  const IDLE_NAG_MS = 16000;

  /** Espera real pela volta do contexto WebGL antes de pedir para recarregar a página. */
  const CONTEXT_RESTORE_MS = 5000;

  /** Conselhos do parceiro: variantes por ação (sorteadas sem repetir a última). */
  const ADVICE_TEXT = Object.freeze({
    call: Object.freeze({
      accept: Object.freeze(['Pode aceitar, parceiro!', 'Cai que eu seguro!', 'Aceita, tô com jogo.']),
      raise: Object.freeze(['Aumenta que a gente segura!', 'Pede mais, tô forte!', 'Sobe que eu tenho as boas!']),
      run: Object.freeze(['Corre dessa, tô fraco.', 'Melhor correr, parceiro.', 'Essa não dá, corre.']),
    }),
    onze: Object.freeze({
      accept: Object.freeze(['Bora jogar, dá pra ganhar!', 'Joga que eu tenho carta!', 'Dá pra encarar, bora!']),
      run: Object.freeze(['Melhor correr dessa.', 'Corre, essa tá feia.', 'Não arrisca não, corre.']),
    }),
  });

  const CALL_WORDS = Object.freeze({ 3: 'truco', 6: 'seis', 9: 'nove', 12: 'doze' });
  const SUIT_SYMBOL = Object.freeze({ clubs: '♣', hearts: '♥', spades: '♠', diamonds: '♦' });

  /** Quantas falas recentes da mesa um bot evita repetir. */
  const RECENT_LINES = 6;

  const BENIGN_ERRORS = [/ResizeObserver loop/i];

  // ------------------------------------------------------------------ utilidades puras

  function mix(a, b) {
    let h = (a ^ Math.imul((b >>> 0) + 0x9e3779b9, 0x85ebca6b)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function teamOf(seat) {
    return seat % 2;
  }

  function clampScore(score) {
    return [0, 1].map((t) => Math.max(0, Math.min(12, Number((score || [])[t]) || 0)));
  }

  function pointsText(n) {
    return n === 1 ? '1 ponto' : n + ' pontos';
  }

  function capitalize(text) {
    const t = String(text || '');
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  }

  /** '3♥'; '' sem carta. */
  function cardText(card) {
    if (!card || !card.rank || !SUIT_SYMBOL[card.suit]) return '';
    return card.rank + SUIT_SYMBOL[card.suit];
  }

  /** Sorteia uma variante com `rng`, evitando repetir `last` quando há outra opção. */
  function pickLine(list, last, rng) {
    if (!list || !list.length) return '';
    const options = list.length > 1 ? list.filter((t) => t !== last) : list.slice();
    return options[Math.min(options.length - 1, Math.floor(rng() * options.length))];
  }

  /** Lê os parâmetros de teste da query string. Valores inválidos viram null (ignorados). */
  function readParams(search) {
    let q;
    try {
      q = new URLSearchParams(search || '');
    } catch (_) {
      q = new URLSearchParams('');
    }
    const flag = (k) => q.get(k) === '1' || q.get(k) === 'true';
    const num = (k) => {
      if (!q.has(k)) return null;
      const v = Number(q.get(k));
      return Number.isFinite(v) ? v : null;
    };
    const pick = (k, allowed) => (allowed.indexOf(q.get(k)) >= 0 ? q.get(k) : null);
    const speed = num('speed');
    const seed = num('seed');
    let startScore = null;
    if (q.has('startScore')) {
      const parts = String(q.get('startScore')).split(',').map((v) => Number(v));
      if (parts.length === 2 && parts.every((v) => Number.isInteger(v) && v >= 0 && v <= 11)) startScore = parts;
    }
    const players = pick('players', ['2', '4']);
    return {
      autoplay: flag('autoplay'),
      skipMenu: flag('skipMenu'),
      mute: flag('mute'),
      speed: speed !== null && speed > 0 ? Math.min(speed, 50) : null,
      seed: seed !== null ? Math.abs(Math.trunc(seed)) >>> 0 : null,
      players: players ? Number(players) : null,
      deck: pick('deck', ['limpo', 'sujo']),
      format: pick('format', ['single', 'bestOf3']),
      difficulty: pick('difficulty', ['facil', 'medio', 'dificil']),
      quality: pick('quality', ['high', 'low']),
      startScore,
    };
  }

  /** Configuração de partida: padrão < salvo < parâmetros da URL. */
  function mergeSettings(defaults, saved, params) {
    const s = Object.assign({}, defaults, saved || {});
    const p = params || {};
    ['players', 'deck', 'format', 'difficulty', 'quality'].forEach((k) => {
      if (p[k] !== null && p[k] !== undefined) s[k] = p[k];
    });
    if (p.mute) {
      s.sound = false;
      s.voice = false;
    }
    return s;
  }

  function personagensApi(api) {
    const P = api || Truco.Personagens;
    return P && typeof P.lista === 'function' ? P : null;
  }

  function botSeats(players) {
    return players === 2 ? [1] : [1, 2, 3];
  }

  /** Escolha salva para o modo: { seat: id } (settings.seats2 / settings.seats4). */
  function seatChoice(players, settings) {
    const c = settings && settings[players === 2 ? 'seats2' : 'seats4'];
    return c && typeof c === 'object' ? c : {};
  }

  /**
   * Quem senta em cada lugar: [null, p1, p2?, p3?] (o assento 0 é você). Respeita a escolha, sem
   * repetir a mesma pessoa; o que faltar vem do padrão (Tião, Vini, Bia) e depois de quem sobrar.
   */
  function resolveCast(players, choice, api) {
    const P = personagensApi(api);
    let list = [];
    try {
      list = P ? P.lista() : [];
    } catch (_) {
      list = [];
    }
    const byId = (id) => (typeof id === 'string' ? list.find((p) => p.id === id) || null : null);
    const used = new Set();
    const out = [null];
    const want = choice || {};
    for (const seat of botSeats(players)) {
      let p = byId(want[seat]);
      if (!p || used.has(p.id)) p = byId(DEFAULT_SEATS[players === 2 ? 2 : 4][seat]);
      if (!p || used.has(p.id)) p = list.find((q) => !used.has(q.id)) || null;
      if (!p) {
        const nome = FALLBACK_NAMES[seat] || 'Jogador ' + (seat + 1);
        const genero = FALLBACK_GENDER[seat] || 'ele';
        const r = P ? P.normalizar({ nome, genero }) : null;
        p = r && r.personagem ? r.personagem : { id: 'reserva-' + seat, nome, apelido: nome, genero };
        p.id = 'reserva-' + seat;
      }
      used.add(p.id);
      out[seat] = p;
    }
    return out;
  }

  function namesFor(players, cast) {
    const c = cast || resolveCast(players, {});
    return ['Você'].concat(botSeats(players).map((s) => (c[s] && c[s].nome) || FALLBACK_NAMES[s]));
  }

  function avatarSpecs(players, cast, api) {
    const c = cast || resolveCast(players, {}, api);
    const P = personagensApi(api);
    return botSeats(players).map((seat) => {
      const p = c[seat];
      if (P && p && p.visual) {
        try {
          return P.avatarSpec(p, seat);
        } catch (_) {
          // ficha estranha: cai no avatar só com o nome
        }
      }
      return { seat, name: (p && p.nome) || FALLBACK_NAMES[seat] };
    });
  }

  /** Índice da carta jogada na mão do assento (antes do apply), para a cena tirar a carta certa. */
  function playInfo(state, action) {
    if (!action || action.type !== 'PLAY' || !state.hand) return null;
    const hand = state.hand.hands[action.seat] || [];
    const index = Number.isInteger(action.index) ? action.index : hand.findIndex((c) => c.id === action.cardId);
    return { seat: action.seat, index };
  }

  /** Ação legal conservadora para quando algo deu errado (bot sem resposta, ação inválida). */
  function safeAction(Engine, state, decision) {
    const actions = Engine.legalActions(state);
    if (!actions.length) return null;
    const prefer = {
      play: (a) => a.type === 'PLAY' && !a.faceDown,
      callResponse: (a) => a.type === 'ACCEPT',
      maoDeOnze: (a) => a.type === 'MAO_DE_ONZE' && a.accept,
    }[decision && decision.kind];
    return (prefer && actions.find(prefer)) || actions[0];
  }

  // ------------------------------------------------------------------ controlador

  /**
   * deps: { Engine, AI, scene, hud, audio?, params, debug, cardsReady?, now? }
   * Devolve { begin, startMatch, openMainMenu, openPauseMenu, session, phase, dispose, ... }.
   */
  function createController(deps) {
    const Engine = deps.Engine;
    const AI = deps.AI;
    const scene = deps.scene;
    const hud = deps.hud;
    const audio = deps.audio || null;
    const params = Object.assign(readParams(''), deps.params || {});
    const debug = deps.debug || { events: [], errors: [] };
    const nowMs = deps.now || (() => Date.now());
    const cardsReady = deps.cardsReady || Promise.resolve();
    const defaults = deps.defaults || {
      players: 4, deck: 'limpo', format: 'single', difficulty: 'medio', speed: 1,
      sound: true, voice: true, highlightManilhas: true, quality: 'high', explainSignals: true,
      seats2: {}, seats4: {},
    };
    const api = () => personagensApi(deps.Personagens);

    let settings = mergeSettings(defaults, deps.saved, params);
    let session = null;
    let menuOpen = false;
    let matchCount = 0;
    let sessionCounter = 0;
    let disposed = false;
    let contextLoss = null; // { sess, timer } enquanto o contexto WebGL estiver perdido
    const unsubscribers = [];

    // -------------------------------------------------------- erros e registro

    function reportError(err, where) {
      pushError(debug, err, where);
    }

    function record(events) {
      for (const ev of events) debug.events.push(ev);
      const extra = debug.events.length - 5000;
      if (extra > 0) debug.events.splice(0, extra);
    }

    /** Resumo da partida para a tela final (placar de mãos, pedidos, como terminou). */
    function track(sess, events) {
      const st = sess.stats;
      for (const ev of events) {
        switch (ev.type) {
          case 'handStarted':
            st.special = ev.special || null;
            st.lastCallName = null;
            break;
          case 'call':
            st.lastCallName = ev.name || null;
            break;
          case 'accept':
            st.accepted += 1;
            break;
          case 'run':
            st.runs += 1;
            st.lastRun = { seat: ev.seat, team: ev.team, callName: st.lastCallName };
            break;
          case 'handEnded':
            if (ev.winnerTeam === 0 || ev.winnerTeam === 1) st.hands[ev.winnerTeam] += 1;
            st.lastHand = { reason: ev.reason, winnerTeam: ev.winnerTeam, points: ev.points, special: st.special };
            break;
          default:
            break;
        }
      }
    }

    // -------------------------------------------------------- áudio e falas

    function pace() {
      return params.speed || settings.speed || 1;
    }

    function sfx(name) {
      if (!audio) return;
      try {
        audio.play(name);
      } catch (err) {
        reportError(err, 'áudio');
      }
    }

    function applyAudio() {
      if (!audio) return;
      const mute = !!params.mute || !settings.sound;
      try {
        audio.setMuted(mute);
        audio.setVoice(!!settings.voice && !params.mute);
        audio.ambient(!mute);
      } catch (err) {
        reportError(err, 'áudio');
      }
    }

    /** Voz da ficha de quem está no assento ({ pitch, rate }), ou undefined (voz do assento). */
    function voiceOf(seat) {
      const P = api();
      const p = seat > 0 && session && session.cast ? session.cast[seat] : null;
      if (!P || !p || !p.voz) return undefined;
      try {
        return P.voz(p);
      } catch (_) {
        return undefined;
      }
    }

    /**
     * Arquivo gravado da fala (docs/AUDIO.md): 'vini/truco-2' quando o texto é a 2ª frase de falas.truco
     * do personagem; no assento 0 (você), 'voce/<momento>-1' para os gritos fixos. Sem arquivo → null.
     */
    function clipOf(text, seat) {
      if (seat === 0) {
        const k = HUMAN_CLIPS[text];
        return k ? 'voce/' + k : null;
      }
      const P = api();
      const p = session && session.cast ? session.cast[seat] : null;
      if (!P || !p || !p.id || typeof P.chaveDeFala !== 'function') return null;
      try {
        for (const m of P.MOMENTOS || []) {
          const k = P.chaveDeFala(p, m.id, text);
          if (k) return p.id + '/' + k;
        }
      } catch (_) {
        // sem arquivo: fica a voz sintetizada
      }
      return null;
    }

    function say(text, seat, shout) {
      if (!audio || !settings.voice || !text) return;
      try {
        const voice = voiceOf(seat);
        const opts = voice ? { seat, shout: !!shout, voice } : { seat, shout: !!shout };
        const clip = clipOf(text, seat);
        if (clip) opts.clip = clip;
        const p = audio.say(text, opts);
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (err) {
        reportError(err, 'voz');
      }
    }

    /** Balão + voz. O assento 0 (quem joga) só tem voz: o letreiro ou o aviso do resultado já mostram a escolha. */
    function speak(seat, text, opts) {
      if (!text) return;
      const shout = !!(opts && opts.shout);
      if (seat !== 0) {
        try {
          hud.speech(seat, text, { shout });
        } catch (err) {
          reportError(err, 'balão');
        }
      }
      say(text, seat, shout);
    }

    function applyScene() {
      try {
        scene.setSpeed(pace());
        scene.setQuality(params.quality || settings.quality);
      } catch (err) {
        reportError(err, 'configuração da cena');
      }
    }

    function applySettings(next) {
      settings = Object.assign({}, settings, next || {});
      applyScene();
      applyAudio();
      if (hud.setSettings) hud.setSettings(settings);
    }

    // -------------------------------------------------------- sessão: pausa, aborto e esperas

    function nextSeed() {
      if (params.seed !== null && params.seed !== undefined) return matchCount === 0 ? params.seed : mix(params.seed, matchCount);
      const c = root.crypto;
      if (c && typeof c.getRandomValues === 'function') {
        const a = new Uint32Array(1);
        c.getRandomValues(a);
        return a[0];
      }
      return (nowMs() * 2654435761) >>> 0;
    }

    function createSession(cfg) {
      const seed = nextSeed() >>> 0;
      const state = Engine.createMatch({
        players: cfg.players,
        seed,
        options: { deck: cfg.deck, format: cfg.format },
      });
      if (params.startScore) state.score = params.startScore.slice();
      const cast = resolveCast(cfg.players, seatChoice(cfg.players, cfg), deps.Personagens);
      // Falas gravadas (audio/vozes/<id>/) de quem vai sentar à mesa e os gritos de quem joga.
      if (audio && typeof audio.preloadVoices === 'function') {
        try {
          audio.preloadVoices(cast.filter(Boolean).map((p) => p.id).concat('voce'));
        } catch (err) {
          reportError(err, 'pré-carga das vozes');
        }
      }
      const P = api();
      const bots = {};
      for (let s = params.autoplay ? 0 : 1; s < cfg.players; s++) {
        bots[s] = AI.create({
          seat: s,
          // A dificuldade vale para os adversários; o parceiro joga no mínimo no médio para não derrubar o time.
          difficulty: s === 2 && cfg.difficulty === 'facil' ? 'medio' : cfg.difficulty,
          personality: s > 0 && P && cast[s] && cast[s].jogo ? P.personalidade(cast[s]) : undefined,
          seed: mix(seed, s + 1),
        });
      }
      return {
        id: ++sessionCounter,
        cfg: {
          players: cfg.players, deck: cfg.deck, format: cfg.format, difficulty: cfg.difficulty,
          seats2: Object.assign({}, cfg.seats2 || {}), seats4: Object.assign({}, cfg.seats4 || {}),
        },
        seed,
        state,
        bots,
        cast,
        names: namesFor(cfg.players, cast),
        signals: [],
        lastCallerSeat: null,
        rng: mulberry32(mix(seed, 0x5eed)),
        aborted: false,
        paused: 0,
        resumeWaiters: [],
        wakers: new Set(),
        human: null,
        faceDown: false,
        lastPlay: null,
        lastRunSeat: null,
        roundResults: [null, null, null],
        gamesWon: [0, 0],
        over: false,
        pausedByTab: false,
        fullShuffleNext: true, // 1ª mão de cada jogo: embaralhada completa; depois, corte curto
        handShown: null, // última mão passada à cena ({ cards, opts }), para reaplicar opções
        handBusy: false, // carta do humano a caminho da mesa (a cena ainda está mexendo na mão)
        callQuote: null, // fala do último pedido de bot que o humano vai responder
        endQuote: null,
        recentLines: [],
        lastAdvice: {},
        stats: { hands: [0, 0], accepted: 0, runs: 0, special: null, lastCallName: null, lastRun: null, lastHand: null },
      };
    }

    function checkpoint(sess) {
      if (sess.aborted) return Promise.reject(ABORT);
      if (!sess.paused) return Promise.resolve();
      return new Promise((resolve, reject) => {
        sess.resumeWaiters.push(() => (sess.aborted ? reject(ABORT) : resolve()));
      });
    }

    /** Espera ms (escalados pela velocidade); abortar acorda na hora. */
    function wait(sess, ms) {
      return new Promise((resolve) => {
        let timer = 0;
        const done = () => {
          clearTimeout(timer);
          sess.wakers.delete(done);
          resolve();
        };
        timer = setTimeout(done, Math.max(0, ms / pace()));
        sess.wakers.add(done);
      }).then(() => checkpoint(sess));
    }

    /** Espera uma promessa com teto de tempo real (0 = sem teto); abortar acorda na hora. */
    function settle(sess, promise, maxMs, label) {
      return new Promise((resolve) => {
        let finished = false;
        let timer = 0;
        const done = (value) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          sess.wakers.delete(wake);
          resolve(value);
        };
        const wake = () => done(undefined);
        sess.wakers.add(wake);
        if (maxMs > 0) {
          timer = setTimeout(() => {
            debug.timeouts = (debug.timeouts || 0) + 1;
            debug.timeoutLabels = (debug.timeoutLabels || []).concat(label || '?').slice(-20);
            done(undefined);
          }, maxMs);
        }
        Promise.resolve(promise).then(done, (err) => {
          reportError(err, label);
          done(undefined);
        });
      }).then((value) => checkpoint(sess).then(() => value));
    }

    function pause(sess) {
      if (!sess || sess.aborted) return;
      sess.paused += 1;
      if (sess.paused === 1) refreshHumanHand(sess);
    }

    function resume(sess) {
      if (!sess || !sess.paused) return;
      sess.paused -= 1;
      if (sess.paused) return;
      refreshHumanHand(sess);
      sess.resumeWaiters.splice(0).forEach((f) => f());
    }

    function abortSession(sess) {
      if (!sess || sess.aborted) return;
      sess.aborted = true;
      sess.paused = 0;
      Array.from(sess.wakers).forEach((f) => f());
      sess.wakers.clear();
      sess.resumeWaiters.splice(0).forEach((f) => f());
      if (sess.human) sess.human.finish(ABORT);
      hud.cancelDialogs(null);
      hud.setActions({ visible: false, faceDown: false });
      hud.setStatus('');
    }

    // -------------------------------------------------------- entrada do humano

    function isHuman(seat) {
      return seat === 0 && !params.autoplay;
    }

    function handOpts(view, interactive, decision) {
      return {
        interactive: !!interactive,
        playableIds: interactive && decision && !decision.blind ? decision.playableCardIds.slice() : null,
        highlightManilhas: !!settings.highlightManilhas,
        manilhaRank: view.manilhaRank,
      };
    }

    /** Passa a mão do humano à cena e guarda o que foi mostrado (para reaplicar opções no meio da mão). */
    function showHand(sess, cards, opts) {
      sess.handShown = { cards: (cards || []).slice(), opts: Object.assign({}, opts) };
      scene.setHumanHand(cards, opts);
    }

    function refreshHumanHand(sess) {
      const h = sess && sess.human;
      if (!h || h.kind !== 'play' || sess.aborted) return;
      showHand(sess, h.view.myHand, Object.assign({}, h.handOpts, { interactive: !sess.paused }));
    }

    /** "Destacar manilhas" mudou no meio da partida: redesenha a mão com a opção nova. */
    function refreshHandOptions(sess) {
      if (!sess || sess.aborted) return;
      const highlightManilhas = !!settings.highlightManilhas;
      const h = sess.human;
      if (h && h.kind === 'play' && h.handOpts) {
        h.handOpts = Object.assign({}, h.handOpts, { highlightManilhas });
        refreshHumanHand(sess);
      } else if (sess.handShown && !sess.handBusy) {
        showHand(sess, sess.handShown.cards, Object.assign({}, sess.handShown.opts, { highlightManilhas }));
      }
    }

    /** Pendura a sessão até o humano agir; `finish(valor)` resolve (ABORT sai do laço). */
    function waitHuman(sess, kind, extra) {
      return new Promise((resolve) => {
        const h = Object.assign({ kind, done: false }, extra || {});
        let nagTimer = 0;
        let nags = 0;
        const nag = () => {
          nagTimer = 0;
          if (sess.human !== h || sess.aborted) return;
          if (!sess.paused) {
            const seat = pickSpeaker(sess, [1, 3]);
            if (seat !== null) speak(seat, line(sess, seat, 'idle'));
            nags += 1;
          }
          if (nags < 2) nagTimer = setTimeout(nag, IDLE_NAG_MS * 1.5);
        };
        h.finish = (value) => {
          if (h.done) return;
          h.done = true;
          clearTimeout(nagTimer);
          if (sess.human === h) sess.human = null;
          resolve(value);
        };
        sess.human = h;
        if (h.handOpts) refreshHumanHand(sess);
        if (h.nag) nagTimer = setTimeout(nag, IDLE_NAG_MS);
      }).then((value) => {
        if (value === ABORT || sess.aborted) throw ABORT;
        return checkpoint(sess).then(() => value);
      });
    }

    /** Diálogo do HUD como espera do humano (a sessão sabe que está esperando e o aborto o fecha). */
    function humanDialog(sess, kind, open) {
      const waiting = waitHuman(sess, kind, {});
      const h = sess.human;
      let dialog;
      try {
        dialog = open();
      } catch (err) {
        reportError(err, 'diálogo ' + kind);
        dialog = null;
      }
      Promise.resolve(dialog).then(
        (v) => h.finish(v),
        (err) => {
          reportError(err, 'diálogo ' + kind);
          h.finish(null);
        }
      );
      return waiting;
    }

    function onHumanCard(cardId, info) {
      const sess = session;
      const h = sess && sess.human;
      if (!h || h.kind !== 'play' || sess.paused) {
        refreshHumanHand(sess);
        return;
      }
      const index = info && Number.isInteger(info.index) ? info.index : -1;
      h.finish({ type: 'card', index, cardId: cardId || null });
    }

    function onHudAction(action, arg) {
      const sess = session;
      const h = sess && sess.human;
      const playing = !!(h && h.kind === 'play' && !sess.paused);
      switch (action) {
        case 'menu':
          openPauseMenu();
          break;
        case 'rules':
          if (sess && !sess.over && typeof hud.showRules === 'function') {
            pause(sess);
            Promise.resolve(hud.showRules()).then(
              () => resume(sess),
              () => resume(sess)
            );
          }
          break;
        case 'call':
          if (playing && h.decision.canCall) h.finish({ type: 'call' });
          break;
        case 'playIndex': {
          if (!playing) break;
          const i = Number(arg);
          const card = h.view.myHand[i];
          if (!card) break;
          if (!h.decision.blind && h.decision.playableCardIds.indexOf(card.id) < 0) break;
          h.finish({ type: 'card', index: i, cardId: card.id || null });
          break;
        }
        case 'toggleFaceDown':
          if (playing && h.decision.canFaceDown) {
            sess.faceDown = !sess.faceDown;
            scene.setFaceDownMode(sess.faceDown);
          }
          break;
        default:
          break;
      }
    }

    /**
     * Botão de som do HUD, fim do menu e "Continuar" da pausa: aplica na hora o que pode mudar no meio
     * da partida (som, voz, destaque das manilhas, velocidade, qualidade). Modo, baralho, formato e
     * dificuldade só entram na próxima partida (startMatch).
     */
    function onHudSettings(next) {
      if (!next) return;
      const before = settings;
      const patch = {
        sound: next.sound !== false,
        voice: next.voice !== false,
        highlightManilhas: next.highlightManilhas !== false,
        explainSignals: next.explainSignals !== false,
      };
      const speed = Number(next.speed);
      if (Number.isFinite(speed) && speed > 0) patch.speed = speed;
      if (next.quality === 'low' || next.quality === 'high') patch.quality = next.quality;
      settings = Object.assign({}, settings, patch);
      if (settings.speed !== before.speed || settings.quality !== before.quality) applyScene();
      applyAudio();
      if (settings.highlightManilhas !== before.highlightManilhas) refreshHandOptions(session);
    }

    /** Aba em segundo plano: pausa a partida (só se estava rolando) e retoma quando a aba volta. */
    function setTabHidden(hidden) {
      const sess = session;
      if (!sess || sess.aborted) return;
      if (hidden) {
        if (!sess.pausedByTab && phase() === 'playing') {
          sess.pausedByTab = true;
          pause(sess);
        }
      } else if (sess.pausedByTab) {
        sess.pausedByTab = false;
        resume(sess);
      }
    }

    /** Perda do contexto WebGL (cena avisa 'lost' | 'restored'): segura a partida até a mesa voltar. */
    function onContextChange(kind) {
      if (kind === 'lost') {
        if (contextLoss) return;
        const sess = session && !session.aborted && !session.over ? session : null;
        contextLoss = { sess, timer: 0 };
        if (sess) pause(sess);
        hud.banner('Recuperando a mesa 3D…', { kind: 'info', ms: 3600000 });
        contextLoss.timer = setTimeout(() => {
          if (!contextLoss) return;
          hud.banner('A mesa 3D não voltou', { kind: 'info', sub: 'Recarregue a página para continuar', ms: 3600000 });
        }, CONTEXT_RESTORE_MS);
      } else if (kind === 'restored') {
        if (!contextLoss) return;
        const lost = contextLoss;
        contextLoss = null;
        clearTimeout(lost.timer);
        if (typeof hud.dismissBanner === 'function') hud.dismissBanner(true);
        if (lost.sess && session === lost.sess) resume(lost.sess);
      }
    }

    // -------------------------------------------------------- falas dos bots

    function remember(sess, text) {
      if (!text) return;
      sess.recentLines.push(text);
      if (sess.recentLines.length > RECENT_LINES) sess.recentLines.splice(0, sess.recentLines.length - RECENT_LINES);
    }

    /** Ids dos personagens envolvidos numa fala do assento: `about` primeiro, depois adversários e parceiro. */
    function aboutIds(sess, seat, about) {
      const seats = (about || []).slice();
      for (let s = 1; s < sess.cfg.players; s++) if (s !== seat && teamOf(s) !== teamOf(seat)) seats.push(s);
      if (sess.cfg.players === 4) seats.push((seat + 2) % 4);
      const ids = [];
      for (const s of seats) {
        const p = s !== seat && sess.cast ? sess.cast[s] : null;
        if (p && p.id && ids.indexOf(p.id) < 0) ids.push(p.id);
      }
      return ids;
    }

    /** Fala da ficha do personagem para o tipo de fala do bot, ou '' (usa as falas padrão). */
    function castLine(sess, seat, kind, ctx, about) {
      const P = api();
      const p = sess.cast ? sess.cast[seat] : null;
      if (!P || !p || !p.falas) return '';
      const moment = P.momentoDe(kind, ctx);
      if (!moment) return '';
      return P.fala(p, moment, sess.rng, { outros: aboutIds(sess, seat, about) }) || '';
    }

    /**
     * Fala do bot: primeiro a ficha do personagem (Personagens.fala), senão as falas padrão da IA.
     * Evita repetir o que a mesa acabou de ouvir (até 3 novas tentativas). `about`: assentos envolvidos
     * (ex.: quem pediu o truco), para as falas de relacoes.falasPara.
     */
    function line(sess, seat, kind, ctx, about) {
      const bot = sess.bots[seat];
      if (!bot) return '';
      try {
        const next = () => castLine(sess, seat, kind, ctx, about) || bot.phrase(kind, ctx) || '';
        let text = next();
        for (let i = 0; i < 3 && text && sess.recentLines.indexOf(text) >= 0; i++) {
          text = next() || text;
        }
        remember(sess, text);
        return text;
      } catch (err) {
        reportError(err, 'fala');
        return '';
      }
    }

    function castOf(sess, seat) {
      return seat > 0 && sess.cast ? sess.cast[seat] || null : null;
    }

    /** 'o' | 'a' pelo gênero da ficha (padrão 'o'). */
    function articleOf(sess, seat) {
      const p = castOf(sess, seat);
      return p && p.genero === 'ela' ? 'a' : 'o';
    }

    function shortName(sess, seat) {
      if (seat === 0) return sess.names[0] || 'Você';
      const p = castOf(sess, seat);
      const P = api();
      return (p && P && P.nomeCurto(p)) || nameOf(sess, seat);
    }

    /** 'o Tião', 'a Bia' (para frases como "o Tião leva 1"). */
    function withArticle(sess, seat) {
      return seat > 0 ? articleOf(sess, seat) + ' ' + nameOf(sess, seat) : nameOf(sess, seat);
    }

    /** Primeiro assento da lista que é bot com avatar (o assento 0 nunca fala por bot). */
    function pickSpeaker(sess, seats) {
      for (const s of seats) {
        if (s !== null && s !== undefined && s > 0 && s < sess.cfg.players && sess.bots[s]) return s;
      }
      return null;
    }

    function nameOf(sess, seat) {
      return sess.names[seat] || 'Jogador ' + (seat + 1);
    }

    function act(seat, kind) {
      if (seat <= 0) return;
      try {
        const p = scene.avatarAct(seat, kind);
        if (p && typeof p.catch === 'function') p.catch((err) => reportError(err, 'avatar'));
      } catch (err) {
        reportError(err, 'avatar');
      }
    }

    function actAll(sess, winnerTeam) {
      for (let s = 1; s < sess.cfg.players; s++) act(s, teamOf(s) === winnerTeam ? 'win' : 'lose');
    }

    // -------------------------------------------------------- decisões

    /** Faixa de tempo de pensar conforme a jogada que o bot já escolheu (ver THINK). */
    function thinkKind(d, mode, action, view) {
      if (mode === 'onze') return 'onze';
      if (mode === 'response') return 'response';
      if (action && action.type === 'CALL') return 'call';
      const ids = d.playableIndexes || d.playableCardIds;
      const options = Array.isArray(ids) ? ids.length : 3;
      if (options <= 1 && !d.canCall && !d.canFaceDown) return 'single';
      const round = view && Array.isArray(view.rounds) ? view.rounds[view.roundIndex] : null;
      if (!round || !round.plays || !round.plays.length) return 'open';
      return 'play';
    }

    async function botDecision(sess, d, seat, mode) {
      const bot = sess.bots[seat];
      if (mode === 'play') scene.setTurn(seat);
      if (seat === 0) hud.setStatus('Jogando por você…');
      else hud.setStatus(nameOf(sess, seat) + (mode === 'play' ? ' pensando…' : ' decidindo…'));
      // Decide antes de esperar: o tempo de pensar acompanha a jogada escolhida.
      let action = null;
      let view = null;
      try {
        view = Engine.viewFor(sess.state, seat);
        action = bot ? bot.decide(view, d) : null;
      } catch (err) {
        reportError(err, 'bot ' + seat);
      }
      const kind = thinkKind(d, mode, action, view);
      const range = THINK[kind];
      const ms = range[0] + sess.rng() * (range[1] - range[0]);
      if (Array.isArray(debug.thinks)) {
        debug.thinks.push({ seat, mode, kind, ms: Math.round(ms) });
        if (debug.thinks.length > 400) debug.thinks.shift();
      }
      if (seat > 0 && ms > 900) act(seat, 'think');
      if (mode === 'play' && seat > 0 && sess.rng() < 0.04) speak(seat, line(sess, seat, 'idle'));
      await wait(sess, ms);
      hud.setStatus('');
      if (!action) {
        reportError(new Error('bot ' + seat + ' sem ação para ' + d.kind), 'bot');
        action = safeAction(Engine, sess.state, d);
      }
      return action;
    }

    async function humanPlay(sess, d) {
      const view = Engine.viewFor(sess.state, 0);
      sess.faceDown = false;
      scene.setFaceDownMode(false);
      scene.setTurn(0);
      const opts = handOpts(view, true, d);
      hud.setActions({
        visible: true,
        canCall: !!d.canCall,
        callName: d.callName || 'Truco',
        canFaceDown: !!d.canFaceDown,
        faceDown: false,
      });
      hud.setStatus(d.blind ? 'Sua vez: escolha uma carta às cegas' : 'Sua vez');
      sfx('click'); // "tic" curto: chegou a sua vez
      let choice;
      try {
        choice = await waitHuman(sess, 'play', { decision: d, view, handOpts: opts, nag: true });
      } finally {
        if (!sess.aborted) {
          hud.setActions({ visible: false, faceDown: false });
          hud.setStatus('');
          const h = sess.handShown;
          showHand(sess, view.myHand, Object.assign({}, h && h.opts ? h.opts : opts, { interactive: false }));
        }
      }
      const faceDown = sess.faceDown && !!d.canFaceDown;
      sess.faceDown = false;
      if (choice.type === 'call') return { type: 'CALL', seat: 0 };
      sess.handBusy = true; // até a carta pousar (onCardPlayed)
      let index = Number.isInteger(choice.index) ? choice.index : -1;
      if (!d.blind && choice.cardId) {
        const byId = view.myHand.findIndex((c) => c.id === choice.cardId);
        if (byId >= 0) index = byId;
      }
      if (index < 0 || index >= view.myHand.length) index = 0;
      if (d.blind) return { type: 'PLAY', seat: 0, index, faceDown: false };
      return { type: 'PLAY', seat: 0, cardId: view.myHand[index].id, faceDown };
    }

    function partnerAdvice(sess, d, kind) {
      if (sess.cfg.players !== 4 || !sess.bots[2]) return null;
      let action = null;
      try {
        action = sess.bots[2].advise(Engine.viewFor(sess.state, 2), d);
      } catch (err) {
        reportError(err, 'conselho');
      }
      if (kind === 'onze' && action === 'raise') action = 'accept';
      const list = action && ADVICE_TEXT[kind][action];
      if (!list) return null;
      const key = kind + '.' + action;
      const text = pickLine(list, sess.lastAdvice[key], sess.rng);
      sess.lastAdvice[key] = text;
      // O conselho aparece dentro do diálogo; o parceiro só fala (sem balão por trás do diálogo).
      say(text, 2, false);
      return { action, text, name: nameOf(sess, 2) };
    }

    /** Cartas já jogadas na mão, para o diálogo de resposta (sem revelar nenhuma encoberta). */
    function tableRecap(sess) {
      let view;
      try {
        view = Engine.viewFor(sess.state, 0);
      } catch (err) {
        reportError(err, 'resumo da mesa');
        return null;
      }
      const rounds = (view.rounds || [])
        .filter((r) => r && Array.isArray(r.plays) && r.plays.length)
        .map((r) => ({
          plays: r.plays.map((p) => ({
            seat: p.seat,
            name: shortName(sess, p.seat),
            card: p.faceDown ? null : p.card || null,
            faceDown: !!p.faceDown,
          })),
          winnerSeat: Number.isInteger(r.winnerSeat) ? r.winnerSeat : null,
          tie: !!r.tie,
        }));
      return { rounds, vira: view.vira || null, manilhaRank: view.manilhaRank || null };
    }

    /** No 1×1 os diálogos falam do adversário pelo nome ("o Tião leva 1"); no 2×2, "eles". */
    function opponentLabel(sess) {
      return sess.cfg.players === 2 ? withArticle(sess, 1) : null;
    }

    async function humanCallResponse(sess, d) {
      scene.setTurn(null);
      hud.setStatus('');
      const advice = partnerAdvice(sess, d, 'call');
      const q = sess.callQuote && sess.callQuote.seat === d.callerSeat ? sess.callQuote : null;
      sess.callQuote = null;
      const answer = await humanDialog(sess, 'callResponse', () =>
        hud.askCallResponse({
          callerName: nameOf(sess, d.callerSeat),
          callName: d.callName,
          proposedValue: d.proposedValue,
          currentValue: d.currentValue,
          canRaise: !!d.canRaise,
          raiseName: d.raiseName,
          advice,
          quote: q ? { name: q.name, text: q.text } : null,
          table: tableRecap(sess),
          opponentLabel: opponentLabel(sess),
        })
      );
      const type = answer === 'run' ? 'RUN' : answer === 'raise' && d.canRaise ? 'RAISE' : 'ACCEPT';
      return { type, seat: 0 };
    }

    async function humanMaoDeOnze(sess, d) {
      const view = Engine.viewFor(sess.state, 0);
      const partnerCards = view.partnerHand && view.partnerHand.length ? view.partnerHand : null;
      hud.setStatus('');
      const advice = partnerAdvice(sess, d, 'onze');
      if (partnerCards) await settle(sess, scene.showPartnerHand(partnerCards), GUARD.partner, 'showPartnerHand');
      const accept = await humanDialog(sess, 'maoDeOnze', () =>
        hud.askMaoDeOnze({ myCards: view.myHand, partnerCards: partnerCards || [], advice, opponentLabel: opponentLabel(sess) })
      );
      if (partnerCards) await settle(sess, scene.showPartnerHand(null), GUARD.partner, 'showPartnerHand');
      return { type: 'MAO_DE_ONZE', seat: 0, accept: accept !== false };
    }

    function decide(sess, d) {
      switch (d.kind) {
        case 'startHand':
          return Promise.resolve({ type: 'START_HAND' });
        case 'maoDeOnze':
          return d.team === 0 && !params.autoplay ? humanMaoDeOnze(sess, d) : botDecision(sess, d, d.seats[0], 'onze');
        case 'callResponse':
          return d.seats.indexOf(0) >= 0 && !params.autoplay
            ? humanCallResponse(sess, d)
            : botDecision(sess, d, d.seats[0], 'response');
        case 'play':
          return isHuman(d.seat) ? humanPlay(sess, d) : botDecision(sess, d, d.seat, 'play');
        default:
          return Promise.reject(new Error('Decisão desconhecida: ' + d.kind));
      }
    }

    function applyAction(sess, d, chosen) {
      let action = chosen;
      let info = playInfo(sess.state, action);
      let events;
      try {
        events = Engine.apply(sess.state, action);
      } catch (err) {
        reportError(err, 'ação recusada pelo motor: ' + JSON.stringify(action));
        action = safeAction(Engine, sess.state, d);
        info = playInfo(sess.state, action);
        events = Engine.apply(sess.state, action);
      }
      sess.lastPlay = info;
      record(events);
      track(sess, events);
      return events;
    }

    // -------------------------------------------------------- apresentação dos eventos

    function handResultText(sess, ev) {
      const us = ev.winnerTeam === 0;
      const solo = sess.cfg.players === 2;
      const pts = pointsText(ev.points);
      const toUs = solo ? ' pra você' : ' pra nós';
      const toThem = solo ? ' pro ' + nameOf(sess, 1) : ' pra eles';
      switch (ev.reason) {
        case 'allTied':
          return 'Três rodadas empatadas: ninguém marca.';
        case 'maoDeOnzeRun':
          if (us) return (solo ? nameOf(sess, 1) + ' correu' : 'Eles correram') + ' da mão de onze: +1' + toUs;
          return (solo ? 'Você correu' : 'Corremos') + ' da mão de onze: +1' + toThem;
        case 'run': {
          const runner = sess.lastRunSeat;
          const who = runner === null ? (us ? 'Eles' : 'Nós') : isHuman(runner) ? 'Você' : nameOf(sess, runner);
          return who + ' correu: +' + pts + (us ? toUs : toThem);
        }
        default:
          if (solo) return us ? 'Mão sua! +' + pts : 'Mão do ' + nameOf(sess, 1) + ': +' + pts;
          return us ? 'Mão nossa! +' + pts : 'Mão deles: +' + pts;
      }
    }

    /** Texto curto da rodada para o painel: '1ª: Juninho · 3♥', '1ª: cangou', '2ª: nós · Q♣ da Cida'. */
    function roundNote(sess, ev) {
      const ord = ev.roundIndex + 1 + 'ª';
      if (ev.tie || ev.winnerSeat === null || ev.winnerSeat === undefined) return ord + ': cangou';
      const card = cardText(ev.winningCard);
      const seat = ev.winnerSeat;
      if (seat === 0) return ord + ': você' + (card ? ' · ' + card : '');
      if (teamOf(seat) === 0) {
        const of = articleOf(sess, seat) === 'a' ? ' da ' : ' do ';
        return ord + ': nós' + (card ? ' · ' + card + of + shortName(sess, seat) : '');
      }
      return ord + ': ' + shortName(sess, seat) + (card ? ' · ' + card : '');
    }

    function setRoundNote(text) {
      if (typeof hud.setRoundNote !== 'function') return;
      try {
        hud.setRoundNote(text || null);
      } catch (err) {
        reportError(err, 'nota da rodada');
      }
    }

    async function onHandStarted(sess, ev) {
      sess.roundResults = [null, null, null];
      sess.faceDown = false;
      sess.lastRunSeat = null;
      sess.callQuote = null;
      scene.setFaceDownMode(false);
      scene.setTurn(null);
      setRoundNote(null);
      hud.setHandInfo({
        // Na mão de onze a mão vale 3 se o time jogar (o motor só sobe o valor na decisão).
        value: ev.special === 'maoDeOnze' ? 3 : ev.value,
        vira: null,
        manilhaRank: null,
        special: ev.special,
        roundResults: [null, null, null],
        dealerName: nameOf(sess, ev.dealer),
        maoName: nameOf(sess, ev.mao),
      });
      const solo = sess.cfg.players === 2;
      if (ev.special === 'maoDeOnze') {
        const sub = ev.specialTeam === 0
          ? (solo ? 'Você decide' : 'Vocês decidem') + ': jogar (vale 3) ou correr'
          : solo ? nameOf(sess, 1) + ' decide se joga' : 'Eles decidem se jogam';
        hud.banner('Mão de onze', { kind: 'onze', sub });
        await wait(sess, TIMING.special);
      } else if (ev.special === 'maoDeFerro') {
        hud.banner('Mão de ferro', { kind: 'ferro', sub: 'Todo mundo às cegas · quem vencer leva o jogo' });
        await wait(sess, TIMING.special);
      }
      hud.setStatus(isHuman(ev.dealer) ? 'Você embaralha e dá as cartas…' : nameOf(sess, ev.dealer) + ' embaralha e dá as cartas…');
      const blind = ev.special === 'maoDeFerro';
      // A cena só recebe as cartas que o humano pode ver; as dos outros viajam de costas.
      const hands = ev.hands.map((h, seat) => (seat === 0 ? (blind ? h.map(() => ({ hidden: true })) : h) : []));
      // Embaralhada completa só na 1ª mão de cada jogo; nas outras, um corte curto (a cena pode ignorar).
      const quickShuffle = !sess.fullShuffleNext;
      sess.fullShuffleNext = false;
      await settle(
        sess,
        scene.dealHand({ dealer: ev.dealer, hands, vira: ev.vira, blind, deckSize: sess.cfg.deck === 'sujo' ? 40 : 24, quickShuffle }),
        GUARD.deal,
        'dealHand'
      );
      hud.setHandInfo({ vira: ev.vira, manilhaRank: ev.manilhaRank });
      hud.setStatus('');
      const view = Engine.viewFor(sess.state, 0);
      sess.handBusy = false;
      showHand(sess, view.myHand, handOpts(view, false, null));
      await partnerSignal(sess, ev);
    }

    /**
     * Sinal do parceiro (2×2): logo depois da distribuição, se o parceiro (assento 2) tem Zap, Copas,
     * Espadilha, Pica-fumo ou um 3, ela faz UM gesto (o da carta mais forte), como na ficha dela.
     * Não há sinal na mão de ferro (ninguém vê as cartas) nem na nossa mão de onze (você já vê as
     * cartas dela). Os adversários não sinalizam. "Explicar os sinais" põe o significado no HUD.
     */
    async function partnerSignal(sess, ev) {
      if (sess.cfg.players !== 4 || !sess.bots[2]) return;
      if (ev.special === 'maoDeFerro' || (ev.special === 'maoDeOnze' && ev.specialTeam === 0)) return;
      const P = api();
      const partner = castOf(sess, 2);
      if (!P || !partner || !Array.isArray(ev.hands)) return;
      let carta = null;
      let gesto = null;
      let text = '';
      try {
        carta = P.cartaParaSinal(ev.hands[2], ev.manilhaRank);
        if (!carta) return;
        gesto = P.sinal(partner, carta);
        text = P.explicarSinal(partner, carta, gesto);
      } catch (err) {
        reportError(err, 'sinal do parceiro');
        return;
      }
      const entry = { handNumber: ev.handNumber, seat: 2, carta, gesto, text };
      sess.signals.push(entry);
      if (Array.isArray(debug.signals)) debug.signals.push(entry);
      let gesture = null;
      if (typeof scene.avatarSignal === 'function') {
        try {
          gesture = scene.avatarSignal(2, gesto);
        } catch (err) {
          reportError(err, 'sinal do parceiro');
        }
      }
      if (settings.explainSignals !== false && text) hud.toast(text, { kind: 'neutral', ms: 3400 });
      if (gesture && typeof gesture.then === 'function') await settle(sess, gesture, SIGNAL_GUARD_MS, 'avatarSignal');
    }

    async function onMaoDeOnzeDecided(sess, ev) {
      const text = isHuman(ev.seat)
        ? ev.accept ? 'Vamos jogar!' : 'Corro!'
        : line(sess, ev.seat, ev.accept ? 'maoDeOnzePlay' : 'maoDeOnzeRun');
      speak(ev.seat, text);
      act(ev.seat, ev.accept ? 'nod' : 'shake');
      if (ev.accept) {
        hud.setHandInfo({ value: ev.value });
        const solo = sess.cfg.players === 2;
        hud.toast(ev.team === 0 ? 'Mão de onze aceita: vale 3' : (solo ? nameOf(sess, 1) + ' joga' : 'Eles jogam') + ' a mão de onze: vale 3', { kind: 'neutral' });
      }
      await wait(sess, TIMING.afterAnswer);
    }

    /** O humano vai responder ao pedido que acabou de ser feito? */
    function humanAnswersNext(sess) {
      if (params.autoplay) return false;
      let next = null;
      try {
        next = Engine.getDecision(sess.state);
      } catch (_) {
        return false;
      }
      return !!(next && next.kind === 'callResponse' && Array.isArray(next.seats) && next.seats.indexOf(0) >= 0);
    }

    /**
     * Um só grito por pedido: tranco + gesto + voz, e o texto num único lugar. Se quem responde é o
     * humano, o próprio diálogo é o grito (com a fala no alto); senão, um letreiro com a fala no subtítulo.
     */
    async function onCall(sess, ev) {
      const shout = String(ev.name || 'Truco').toUpperCase() + '!';
      const human = isHuman(ev.seat);
      sess.lastCallerSeat = ev.seat;
      const text = human ? shout : line(sess, ev.seat, ev.isRaise ? 'raise' : 'call', ev.to) || shout;
      if (ev.isRaise) hud.setHandInfo({ value: ev.from });
      const asks = !human && humanAnswersNext(sess);
      sfx('call');
      try {
        scene.cameraPunch();
        scene.worldEvent('truco', { strength: 0.6 + ev.to / 24 });
        if (ev.to === 6 && scene.galaxySix) scene.galaxySix();
      } catch (err) {
        reportError(err, 'efeito do truco');
      }
      act(ev.seat, 'shout');
      say(text, ev.seat, true);
      if (asks) {
        sess.callQuote = { seat: ev.seat, name: nameOf(sess, ev.seat), text };
        await wait(sess, TIMING.afterCallAsk);
        return;
      }
      sess.callQuote = null;
      const who = human ? 'Você pediu' : text !== shout ? nameOf(sess, ev.seat) + ': “' + text + '”' : nameOf(sess, ev.seat) + ' pediu';
      hud.banner(shout, { kind: 'truco', sub: who + ' · vale ' + ev.to });
      await wait(sess, TIMING.afterCall);
    }

    function callerAbout(sess) {
      return Number.isInteger(sess.lastCallerSeat) ? [sess.lastCallerSeat] : null;
    }

    async function onAccept(sess, ev) {
      const text = isHuman(ev.seat) ? 'Cai!' : line(sess, ev.seat, 'accept', null, callerAbout(sess));
      speak(ev.seat, text);
      act(ev.seat, 'nod');
      hud.setHandInfo({ value: ev.value });
      await wait(sess, TIMING.afterAnswer);
    }

    async function onRun(sess, ev) {
      sess.lastRunSeat = ev.seat;
      const text = isHuman(ev.seat) ? 'Corro!' : line(sess, ev.seat, 'run', null, callerAbout(sess));
      speak(ev.seat, text);
      act(ev.seat, 'shake');
      await wait(sess, TIMING.afterAnswer);
    }

    async function onCardPlayed(sess, ev) {
      const info = sess.lastPlay && sess.lastPlay.seat === ev.seat ? sess.lastPlay : null;
      // Encoberta de outro jogador: a cena nunca recebe a face.
      const card = ev.faceDown && ev.seat !== 0 ? null : ev.card;
      await settle(
        sess,
        scene.playCard(ev.seat, card, {
          faceDown: !!ev.faceDown,
          roundIndex: ev.roundIndex,
          handIndex: info && info.index >= 0 ? info.index : undefined,
        }),
        GUARD.play,
        'playCard'
      );
      if (ev.seat === 0) {
        // A carta saiu da mão da cena: o registro da mão mostrada acompanha.
        const shown = sess.handShown;
        if (shown && info && info.index >= 0) shown.cards = shown.cards.filter((_, i) => i !== info.index);
        sess.handBusy = false;
      }
      if (ev.faceDown && ev.seat > 0 && sess.rng() < 0.5) speak(ev.seat, line(sess, ev.seat, 'faceDown'));
    }

    async function onRoundEnded(sess, ev, batch) {
      await settle(sess, scene.markRoundWinner(ev.roundIndex, ev.tie ? null : ev.winnerSeat), GUARD.mark, 'markRoundWinner');
      sess.roundResults[ev.roundIndex] = ev.tie ? 'tie' : ev.winnerTeam;
      hud.setHandInfo({ roundResults: sess.roundResults.slice() });
      setRoundNote(roundNote(sess, ev));
      if (ev.tie) {
        sfx('tie');
        hud.banner('Cangou!', { kind: 'info', ms: 1400, sub: ev.roundIndex === 0 ? 'A próxima rodada decide' : '' });
        const seat = pickSpeaker(sess, [ev.nextLeader, 1, 3, 2]);
        if (seat !== null) speak(seat, line(sess, seat, 'tie'));
        await wait(sess, TIMING.afterTie);
        return;
      }
      if (!batch.handEnds) {
        const winners = [ev.winnerSeat, (ev.winnerSeat + 2) % sess.cfg.players];
        const loserSeat = pickSpeaker(sess, ev.winnerTeam === 0 ? [1, 3] : [2]);
        const winnerSeat = pickSpeaker(sess, winners);
        const r = sess.rng();
        if (winnerSeat !== null && r < 0.5) speak(winnerSeat, line(sess, winnerSeat, 'winRound', { roundIndex: ev.roundIndex }));
        else if (loserSeat !== null && r > 0.82) speak(loserSeat, line(sess, loserSeat, 'loseRound'));
      }
      await wait(sess, TIMING.afterRound);
    }

    async function onHandEnded(sess, ev, batch) {
      scene.setTurn(null);
      hud.setActions({ visible: false, faceDown: false });
      hud.setStatus('');
      const us = ev.winnerTeam === 0;
      hud.toast(handResultText(sess, ev), { kind: ev.winnerTeam === null ? 'neutral' : us ? 'good' : 'bad', ms: 2500 });
      // Se esta mão fechou um jogo, os jogos ganhos já contam (onGameEnded vem depois, no mesmo lote).
      hud.setScore(ev.score, sess.cfg.format === 'bestOf3' ? batch.gamesWon || sess.gamesWon : undefined);
      if (ev.winnerTeam !== null && ev.points > 0) {
        await settle(sess, scene.setScore(clampScore(ev.score), { animate: true }), GUARD.score, 'setScore');
      }
      if (!batch.gameEnds && ev.winnerTeam !== null && sess.rng() < 0.4) {
        const seat = pickSpeaker(sess, us ? [2, 1, 3] : [1, 3]);
        if (seat !== null) speak(seat, line(sess, seat, teamOf(seat) === ev.winnerTeam ? 'winHand' : 'loseHand'));
      }
      await wait(sess, TIMING.afterHand);
    }

    async function onGameEnded(sess, ev, batch) {
      sess.gamesWon = ev.gamesWon.slice();
      sess.fullShuffleNext = true;
      if (batch.matchEnds) return;
      const us = ev.winnerTeam === 0;
      sfx(us ? 'win' : 'lose');
      hud.banner(us ? 'Jogo nosso!' : 'Jogo deles!', {
        kind: 'info',
        ms: 2600,
        sub: 'Jogos: nós ' + ev.gamesWon[0] + ' × ' + ev.gamesWon[1] + ' eles · o próximo começa do zero',
      });
      actAll(sess, ev.winnerTeam);
      await wait(sess, TIMING.afterGame);
      hud.setScore([0, 0], sess.gamesWon);
      await settle(sess, scene.setScore([0, 0], { animate: true }), GUARD.score, 'setScore');
    }

    async function onMatchEnded(sess, ev) {
      sess.gamesWon = ev.gamesWon.slice();
      hud.setScore(ev.score, sess.cfg.format === 'bestOf3' ? ev.gamesWon : undefined);
      const us = ev.winnerTeam === 0;
      sfx(us ? 'win' : 'lose');
      actAll(sess, ev.winnerTeam);
      const opp = pickSpeaker(sess, [1, 3]);
      if (opp !== null) {
        const text = line(sess, opp, us ? 'loseMatch' : 'winMatch');
        // A provocação também vai para dentro da tela final (o balão some quando ela abre).
        if (text) sess.endQuote = { name: nameOf(sess, opp), text };
        speak(opp, text);
      }
      await wait(sess, TIMING.beforeEnd);
    }

    const HANDLERS = {
      handStarted: onHandStarted,
      maoDeOnzeDecided: onMaoDeOnzeDecided,
      call: onCall,
      accept: onAccept,
      run: onRun,
      cardPlayed: onCardPlayed,
      roundEnded: onRoundEnded,
      handEnded: onHandEnded,
      gameEnded: onGameEnded,
      matchEnded: onMatchEnded,
    };

    async function present(sess, events) {
      const gameEnded = events.find((e) => e.type === 'gameEnded');
      const batch = {
        handEnds: events.some((e) => e.type === 'handEnded'),
        gameEnds: !!gameEnded,
        matchEnds: events.some((e) => e.type === 'matchEnded'),
        gamesWon: gameEnded && Array.isArray(gameEnded.gamesWon) ? gameEnded.gamesWon.slice() : null,
      };
      for (const ev of events) {
        await checkpoint(sess);
        const fn = HANDLERS[ev.type];
        if (!fn) continue;
        try {
          await fn(sess, ev, batch);
        } catch (err) {
          if (err === ABORT) throw err;
          reportError(err, 'apresentação de ' + ev.type);
        }
      }
      if (batch.handEnds && !batch.matchEnds) {
        sess.handShown = null; // a cena recolhe também o que sobrou na mão
        sess.handBusy = false;
        await settle(sess, scene.clearTable(), GUARD.clear, 'clearTable');
      }
    }

    // -------------------------------------------------------- laço da partida

    async function prepareTable(sess) {
      const { players, format, deck } = sess.cfg;
      hud.cancelDialogs(null);
      hud.setNames(sess.names);
      hud.setActions({ visible: false, canCall: false, canFaceDown: false, faceDown: false });
      hud.setStatus('');
      hud.setHandInfo({ value: 1, vira: null, manilhaRank: null, special: null, roundResults: [null, null, null], dealerName: '', maoName: '' });
      setRoundNote(null);
      hud.setScore(sess.state.score, format === 'bestOf3' ? [0, 0] : undefined);
      scene.setup({ players, avatars: avatarSpecs(players, sess.cast, deps.Personagens) });
      scene.setTurn(null);
      await settle(sess, scene.setScore(clampScore(sess.state.score), { animate: false }), GUARD.score, 'setScore');
      await settle(sess, cardsReady, GUARD.ready, 'CardTex.ready');
      hud.toast(
        (players === 4 ? '2×2 com ' + nameOf(sess, 2) : '1×1 contra ' + nameOf(sess, 1)) +
          ' · baralho ' + (deck === 'sujo' ? 'sujo (40)' : 'limpo (24)') +
          (format === 'bestOf3' ? ' · melhor de 3' : ''),
        { kind: 'neutral', ms: 2600 }
      );
    }

    /** Como a partida acabou, pela última mão: 'Vocês venceram a mão de ferro', 'O Tião correu do doze'… */
    function matchHow(sess) {
      const st = sess.stats;
      const last = st.lastHand;
      if (!last || (last.winnerTeam !== 0 && last.winnerTeam !== 1)) return '';
      const solo = sess.cfg.players === 2;
      const us = last.winnerTeam === 0;
      const subject = us ? (solo ? 'Você' : 'Vocês') : solo ? capitalize(withArticle(sess, 1)) : 'Eles';
      const verb = (one, many) => subject + ' ' + (solo ? one : many);
      if (last.special === 'maoDeFerro' && last.reason === 'rounds') return verb('venceu', 'venceram') + ' a mão de ferro';
      switch (last.reason) {
        case 'run': {
          const run = st.lastRun;
          const call = run && run.callName ? String(run.callName).toLowerCase() : 'pedido';
          const who = !run ? (us ? 'Eles' : 'Vocês') : run.seat === 0 ? 'Você' : capitalize(withArticle(sess, run.seat));
          return who + ' correu do ' + call;
        }
        case 'maoDeOnzeRun':
          return us
            ? (solo ? capitalize(withArticle(sess, 1)) + ' correu' : 'Eles correram') + ' da mão de onze'
            : (solo ? 'Você correu' : 'Vocês correram') + ' da mão de onze';
        default:
          if (last.special === 'maoDeOnze') return verb('fechou', 'fecharam') + ' na mão de onze';
          if (CALL_WORDS[last.points]) return verb('fechou', 'fecharam') + ' no ' + CALL_WORDS[last.points];
          return verb('fechou', 'fecharam') + ' numa mão de ' + pointsText(last.points);
      }
    }

    async function finishMatch(sess, d) {
      sess.over = true;
      scene.setTurn(null);
      hud.setActions({ visible: false, faceDown: false });
      hud.setStatus('');
      const st = sess.stats;
      const choice = await humanDialog(sess, 'matchEnd', () =>
        hud.showMatchEnd({
          winnerTeam: d.winnerTeam,
          score: sess.state.score.slice(),
          gamesWon: sess.cfg.format === 'bestOf3' ? sess.state.gamesWon.slice() : undefined,
          how: matchHow(sess),
          summary: { hands: st.hands.slice(), accepted: st.accepted, runs: st.runs },
          quote: sess.endQuote,
          opponentLabel: opponentLabel(sess),
        })
      );
      return choice === 'again' ? 'again' : 'menu';
    }

    async function runSession(sess) {
      try {
        await prepareTable(sess);
        let failures = 0;
        for (;;) {
          await checkpoint(sess);
          const d = Engine.getDecision(sess.state);
          if (d.kind === 'matchOver') return await finishMatch(sess, d);
          try {
            const chosen = await decide(sess, d);
            await checkpoint(sess);
            const events = applyAction(sess, d, chosen);
            await present(sess, events);
            failures = 0;
          } catch (err) {
            if (err === ABORT) throw err;
            reportError(err, 'laço da partida');
            failures += 1;
            if (failures > 6) throw err;
            await wait(sess, 400);
          }
        }
      } catch (err) {
        if (err === ABORT) return 'aborted';
        reportError(err, 'sessão');
        hud.banner('Ops! A mesa travou', { kind: 'info', sub: 'Voltando ao menu para recomeçar.', ms: 2600 });
        return 'menu';
      }
    }

    function startMatch(cfg) {
      if (disposed) return null;
      if (session) abortSession(session);
      const sess = createSession(Object.assign({}, settings, cfg || {}));
      matchCount += 1;
      debug.events.length = 0;
      session = sess;
      runSession(sess).then(
        (outcome) => {
          if (session !== sess || disposed) return;
          if (outcome === 'again') startMatch(sess.cfg);
          else if (outcome === 'menu') openMainMenu();
        },
        (err) => reportError(err, 'sessão')
      );
      return sess;
    }

    async function openMainMenu() {
      if (disposed || menuOpen) return;
      menuOpen = true;
      let result = null;
      try {
        result = await hud.showMenu(Object.assign({}, settings));
      } catch (err) {
        reportError(err, 'menu');
      } finally {
        menuOpen = false;
      }
      if (!result || disposed) return;
      applySettings(result);
      startMatch(result);
    }

    async function openPauseMenu() {
      const sess = session;
      if (disposed || menuOpen || !sess || sess.aborted || sess.over) return;
      menuOpen = true;
      pause(sess);
      let result = null;
      try {
        result = await hud.showMenu(Object.assign({}, settings), { resumable: true });
      } catch (err) {
        reportError(err, 'menu');
      } finally {
        menuOpen = false;
      }
      if (disposed || session !== sess || sess.aborted) return;
      if (!result) {
        resume(sess);
        return;
      }
      applySettings(result);
      startMatch(result);
    }

    function begin() {
      applySettings(settings);
      if (params.skipMenu) startMatch(settings);
      else openMainMenu();
    }

    function phase() {
      if (disposed) return 'disposed';
      if (!session || (session.over && menuOpen)) return menuOpen ? 'menu' : 'idle';
      if (session.over) return 'matchOver';
      if (session.paused) return 'paused';
      return 'playing';
    }

    function dispose() {
      if (disposed) return;
      if (session) abortSession(session);
      if (contextLoss) clearTimeout(contextLoss.timer);
      contextLoss = null;
      disposed = true;
      unsubscribers.splice(0).forEach((off) => {
        try {
          off();
        } catch (_) {
          // ouvinte já removido
        }
      });
    }

    // Ouvintes únicos: despacham para a sessão atual.
    unsubscribers.push(scene.onHumanPlay(onHumanCard));
    unsubscribers.push(hud.onAction(onHudAction));
    unsubscribers.push(hud.onSettings(onHudSettings));
    if (typeof scene.onSfx === 'function') unsubscribers.push(scene.onSfx((name) => sfx(name)));
    if (typeof scene.onContext === 'function') {
      const off = scene.onContext(onContextChange);
      if (typeof off === 'function') unsubscribers.push(off);
    }

    return {
      begin,
      startMatch,
      openMainMenu,
      openPauseMenu,
      applySettings,
      applyAudio,
      setTabHidden,
      phase,
      dispose,
      get session() {
        return session;
      },
      get settings() {
        return Object.assign({}, settings);
      },
      get params() {
        return Object.assign({}, params);
      },
      pause: () => pause(session),
      resume: () => resume(session),
    };
  }

  // ------------------------------------------------------------------ erros

  /** Registra um erro em `debug.errors` (máx. 200) e no console. ABORT e avisos benignos não contam. */
  function pushError(debug, err, where) {
    if (err === ABORT) return;
    const message = String((err && err.message) || err);
    if (BENIGN_ERRORS.some((re) => re.test(message))) return;
    debug.errors.push({ where: where || '?', message, stack: err && err.stack ? String(err.stack).slice(0, 1600) : '' });
    if (debug.errors.length > 200) debug.errors.splice(0, debug.errors.length - 200);
    if (root.console && root.console.error) root.console.error('TrucAÍ [' + (where || '?') + ']:', err);
  }

  /**
   * Relator global (existe desde a carga deste arquivo): os módulos da cena, das cartas e do HUD chamam
   * `(Truco.reportError || console.error)(err, onde)` para os erros internos chegarem a __truco.errors.
   */
  function reportGlobal(err, where) {
    pushError(createDebug(), err, where);
  }

  // ------------------------------------------------------------------ navegador

  function createDebug() {
    const d = (root.__truco = root.__truco || {});
    d.events = Array.isArray(d.events) ? d.events : [];
    d.errors = Array.isArray(d.errors) ? d.errors : [];
    return d;
  }

  /** Mensagem de falha na abertura, com ou sem HUD (troca o aviso "arrumando a mesa…"). */
  function showBootFailure(hudEl, hud, title, sub) {
    hudEl.classList.add('is-broken');
    if (hud) {
      hud.banner(title, { kind: 'info', sub, ms: 3600000 });
      return;
    }
    hudEl.textContent = '';
    const box = document.createElement('div');
    box.className = 'boot-note is-error';
    box.setAttribute('role', 'alert');
    const t = document.createElement('p');
    t.className = 'boot-title';
    t.textContent = title;
    const s = document.createElement('p');
    s.className = 'boot-sub';
    s.textContent = sub;
    box.appendChild(t);
    box.appendChild(s);
    hudEl.appendChild(box);
  }

  /**
   * As fontes do Google entram com media="print" e trocam para "all" quando carregam (não bloqueiam a
   * página). Se o onload inline não rodar (política da página), este é o reserva.
   */
  function activateFontLinks() {
    if (typeof document === 'undefined' || !document.querySelectorAll) return;
    const links = document.querySelectorAll('link[rel="stylesheet"][media="print"][data-fonts]');
    Array.prototype.forEach.call(links, (link) => {
      const on = () => {
        link.media = 'all';
      };
      if (link.sheet) on();
      else link.addEventListener('load', on, { once: true });
    });
  }

  function installErrorCapture(debug) {
    if (typeof root.addEventListener !== 'function') return;
    root.addEventListener('error', (e) => {
      const message = String((e && e.message) || (e && e.error && e.error.message) || 'erro');
      if (BENIGN_ERRORS.some((re) => re.test(message))) return;
      debug.errors.push({ where: 'window.onerror', message, stack: e && e.error && e.error.stack ? String(e.error.stack).slice(0, 1600) : '' });
    });
    root.addEventListener('unhandledrejection', (e) => {
      const r = e && e.reason;
      if (r === ABORT) {
        e.preventDefault();
        return;
      }
      debug.errors.push({ where: 'unhandledrejection', message: String((r && r.message) || r), stack: r && r.stack ? String(r.stack).slice(0, 1600) : '' });
    });
  }

  let booted = false;

  function boot() {
    if (booted || typeof document === 'undefined') return null;
    booted = true;
    const debug = createDebug();
    installErrorCapture(debug);
    activateFontLinks();
    const params = readParams(root.location ? root.location.search : '');
    const stageEl = document.getElementById('stage');
    const hudEl = document.getElementById('hud');
    if (!stageEl || !hudEl || !Truco.HUD || !Truco.Engine || !Truco.AI) {
      debug.errors.push({ where: 'boot', message: 'Página incompleta: faltam #stage/#hud ou módulos do jogo.' });
      if (hudEl) showBootFailure(hudEl, null, 'Não deu para abrir o jogo', 'Faltou uma parte da página. Recarregue para tentar de novo.');
      return null;
    }
    // Sai o aviso estático "arrumando a mesa…" (o HUD também limpa o elemento ao se montar).
    const bootNote = hudEl.querySelector('.boot-note');
    if (bootNote) bootNote.remove();
    const hud = Truco.HUD.create(hudEl);
    const saved = hud.settings ? Object.assign({}, hud.settings) : {};
    const initial = mergeSettings(Truco.HUD.DEFAULT_SETTINGS, saved, params);
    const initialCast = resolveCast(initial.players, seatChoice(initial.players, initial));
    hud.setNames(namesFor(initial.players, initialCast));

    let scene;
    try {
      if (!root.THREE) throw new Error('three.js não carregou');
      scene = Truco.Scene.create(stageEl, {
        players: initial.players,
        quality: params.quality || initial.quality,
        avatars: avatarSpecs(initial.players, initialCast),
      });
    } catch (err) {
      const semThree = !root.THREE;
      debug.errors.push({ where: 'Scene.create', message: String((err && err.message) || err) });
      if (semThree) {
        showBootFailure(hudEl, hud, 'Não deu para baixar o 3D', 'O three.js vem da internet: confira a conexão e recarregue a página.');
      } else {
        showBootFailure(hudEl, hud, 'Seu navegador não abriu o 3D (WebGL)', 'Ative a aceleração por hardware ou tente outro navegador.');
      }
      return null;
    }

    const CardTex = Truco.CardTex;
    const cardsReady =
      CardTex && typeof CardTex.ready === 'function'
        ? Promise.resolve()
            .then(() => CardTex.ready())
            .catch((err) => reportGlobal(err, 'CardTex.ready'))
        : Promise.resolve();

    // Balões presos às cabeças: a cena devolve px relativos ao palco; o HUD quer px da janela.
    hud.setSeatPosProvider((seat) => {
      const p = scene.seatScreenPos(seat);
      const r = stageEl.getBoundingClientRect();
      return { x: p.x + r.left, y: p.y + r.top };
    });

    const audio = Truco.Audio || null;
    const ctl = createController({
      Engine: Truco.Engine,
      AI: Truco.AI,
      scene,
      hud,
      audio,
      params,
      debug,
      cardsReady,
      saved,
      defaults: Truco.HUD.DEFAULT_SETTINGS,
    });

    // O áudio só destrava num gesto do usuário. Sem menu (testes, modo automático) tenta já na carga;
    // fora disso, esperar o clique evita o aviso de "AudioContext não pôde começar" do navegador.
    let audioReady = false;
    const unlock = () => {
      if (!audio || audioReady) return;
      Promise.resolve(audio.init()).then(
        (ok) => {
          if (ok) audioReady = true;
          ctl.applyAudio();
        },
        () => {}
      );
    };
    root.addEventListener('pointerdown', unlock, true);
    root.addEventListener('keydown', unlock, true);
    if (params.skipMenu || params.autoplay) unlock();

    hudEl.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('button')) {
        if (audio) audio.play('click');
      }
    });

    // Aba em segundo plano: a partida espera (e retoma sozinha só se foi a aba que pausou).
    document.addEventListener('visibilitychange', () => ctl.setTabHidden(document.visibilityState === 'hidden' || !!document.hidden));

    debug.state = () => (ctl.session ? JSON.parse(JSON.stringify(ctl.session.state)) : null);
    debug.decision = () => (ctl.session ? Truco.Engine.getDecision(ctl.session.state) : null);
    debug.waiting = () => (ctl.session && ctl.session.human ? ctl.session.human.kind : null);
    debug.phase = () => ctl.phase();
    debug.settings = () => ctl.settings;
    debug.handPoints = () => scene.debugHandScreenPoints();
    debug.seatPos = (seat) => scene.seatScreenPos(seat);
    debug.controller = ctl;
    debug.signals = [];
    debug.cast = () => (ctl.session && ctl.session.cast ? ctl.session.cast.map((p) => (p ? p.id : null)) : null);

    Game.controller = ctl;
    Game.scene = scene;
    Game.hud = hud;
    ctl.begin();
    if (document.visibilityState === 'hidden') ctl.setTabHidden(true);
    return ctl;
  }

  const Game = {
    DEFAULT_SEATS,
    HUMAN_CLIPS,
    TIMING,
    THINK,
    ADVICE_TEXT,
    ABORT,
    readParams,
    mergeSettings,
    namesFor,
    avatarSpecs,
    resolveCast,
    safeAction,
    pickLine,
    createController,
    boot,
    controller: null,
    scene: null,
    hud: null,
  };

  Truco.Game = Game;
  Truco.reportError = reportGlobal;
  if (typeof module === 'object' && module.exports) module.exports = Game;

  /**
   * Monta a mesa depois de o navegador pintar o aviso "arrumando a mesa…": criar a cena (WebGL, cenário,
   * texturas) segura a página por um tempo e, sem esse respiro, a tela ficaria preta até o fim.
   */
  function bootAfterPaint() {
    let started = false;
    const go = () => {
      if (started) return;
      started = true;
      boot();
    };
    const raf = root.requestAnimationFrame;
    if (typeof raf !== 'function' || document.visibilityState === 'hidden') {
      setTimeout(go, 0); // ninguém está vendo: monta já
      return;
    }
    const Observer = root.PerformanceObserver;
    const supportsPaint = !!(Observer && Observer.supportedEntryTypes && Observer.supportedEntryTypes.indexOf('paint') >= 0);
    if (supportsPaint) {
      // Espera o aviso aparecer de fato na tela (primeira pintura com conteúdo).
      try {
        const po = new Observer((list) => {
          if (list.getEntries().some((e) => e.name === 'first-contentful-paint')) {
            po.disconnect();
            setTimeout(go, 0);
          }
        });
        po.observe({ type: 'paint', buffered: true });
      } catch (_) {
        raf(() => raf(() => setTimeout(go, 0)));
      }
    } else {
      // Dois quadros: o segundo só vem depois de o primeiro (com o aviso) ter sido desenhado.
      raf(() => raf(() => setTimeout(go, 0)));
    }
    setTimeout(go, 3000); // reserva, se a pintura não for avisada
  }

  if (typeof document !== 'undefined' && document.getElementById) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootAfterPaint, { once: true });
    else bootAfterPaint();
  }
})(typeof window !== 'undefined' ? window : globalThis);
