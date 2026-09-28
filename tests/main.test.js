// Testes do controlador (js/main.js) com o motor e a IA reais e uma cena/HUD falsos.
// O "humano" é um roteiro que clica cartas, usa as teclas 1/2/3, pede truco, encobre e responde
// aos diálogos. Cada teste roda partidas inteiras em poucos milissegundos (velocidade 1000×).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../js/core/rules.js');
const Engine = require('../js/core/engine.js');
const AI = require('../js/core/ai.js');
const Personagens = require('../js/core/personagens.js');
// Mesma ordem do index.html.
for (const f of ['tiao', 'vini', 'bia', 'cida', 'juninho', 'rosa']) require('../personagens/' + f + '.js');
const Game = require('../js/main.js');

/** localStorage falso para "Meus personagens". */
function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function later(fn) {
  setImmediate(fn);
}

/** Cena falsa: registra chamadas e deixa o roteiro "clicar" cartas da mão. */
function fakeScene() {
  const playCbs = [];
  const sfxCbs = [];
  const contextCbs = [];
  const scene = {
    calls: { setup: 0, dealHand: 0, playCard: 0, clearTable: 0, showPartnerHand: [], setHumanHand: 0, galaxySix: 0 },
    galaxySix() {
      scene.calls.galaxySix++;
      return Promise.resolve();
    },
    played: [],
    deals: [],
    hand: null,
    onInteractive: null,
    setup(cfg) {
      scene.calls.setup++;
      scene.players = cfg.players;
    },
    dealHand(o) {
      scene.calls.dealHand++;
      scene.lastDeal = o;
      scene.deals.push(o);
      return Promise.resolve();
    },
    onContext(cb) {
      contextCbs.push(cb);
      return () => contextCbs.splice(contextCbs.indexOf(cb), 1);
    },
    context(kind) {
      contextCbs.slice().forEach((cb) => cb(kind));
    },
    playCard(seat, card, o) {
      scene.calls.playCard++;
      scene.played.push({ seat, card, o });
      return Promise.resolve();
    },
    markRoundWinner: () => Promise.resolve(),
    clearTable() {
      scene.calls.clearTable++;
      return Promise.resolve();
    },
    setHumanHand(cards, opts) {
      scene.calls.setHumanHand++;
      scene.hand = { cards, opts };
      if (opts && opts.interactive && scene.onInteractive) {
        const cb = scene.onInteractive;
        later(() => cb(cards, opts));
      }
    },
    onHumanPlay(cb) {
      playCbs.push(cb);
      return () => playCbs.splice(playCbs.indexOf(cb), 1);
    },
    onSfx(cb) {
      sfxCbs.push(cb);
      return () => sfxCbs.splice(sfxCbs.indexOf(cb), 1);
    },
    click(cardId, index) {
      playCbs.slice().forEach((cb) => cb(cardId, { index }));
    },
    listenerCount: () => playCbs.length + sfxCbs.length + contextCbs.length,
    setFaceDownMode(on) {
      scene.faceDown = on;
    },
    showPartnerHand(cards) {
      scene.calls.showPartnerHand.push(cards);
      return Promise.resolve();
    },
    setScore: () => Promise.resolve(),
    avatarAct: () => Promise.resolve(),
    seatScreenPos: () => ({ x: 0, y: 0 }),
    setTurn() {},
    cameraPunch: () => Promise.resolve(),
    worldEvent() {},
    setSpeed(v) {
      scene.speed = v;
    },
    setQuality() {},
  };
  return scene;
}

/** HUD falso: diálogos respondidos pelo roteiro; guarda o que foi mostrado. */
function fakeHud(policy) {
  const actionCbs = [];
  const settingsCbs = [];
  const pending = [];
  const hud = {
    seen: { call: [], onze: [], toasts: [], banners: [], bannerOpts: [], speech: [], notes: [], scores: [], info: [] },
    actions: {},
    dismissed: 0,
    onAction(cb) {
      actionCbs.push(cb);
      return () => actionCbs.splice(actionCbs.indexOf(cb), 1);
    },
    onSettings(cb) {
      settingsCbs.push(cb);
      return () => settingsCbs.splice(settingsCbs.indexOf(cb), 1);
    },
    emit(action, arg) {
      actionCbs.slice().forEach((cb) => cb(action, arg));
    },
    /** Como o HUD real: "Continuar" da pausa e o botão de som avisam onSettings. */
    emitSettings(settings) {
      settingsCbs.slice().forEach((cb) => cb(Object.assign({}, settings)));
    },
    listenerCount: () => actionCbs.length + settingsCbs.length,
    setNames(n) {
      hud.names = n;
    },
    setScore(s, gamesWon) {
      hud.score = s;
      hud.seen.scores.push({ score: s.slice(), gamesWon: gamesWon ? gamesWon.slice() : null });
    },
    setHandInfo(info) {
      hud.info = Object.assign({}, hud.info, info);
      hud.seen.info.push(Object.assign({}, info));
    },
    setRoundNote(text) {
      hud.seen.notes.push(text);
    },
    dismissBanner() {
      hud.dismissed++;
    },
    setStatus() {},
    setSettings() {},
    speech(seat, text) {
      hud.seen.speech.push([seat, text]);
    },
    banner(text, opts) {
      hud.seen.banners.push(text);
      hud.seen.bannerOpts.push(Object.assign({ text }, opts));
    },
    toast(text) {
      hud.seen.toasts.push(text);
    },
    setActions(o) {
      hud.actions = Object.assign({}, hud.actions, o);
    },
    cancelDialogs(v) {
      pending.splice(0).forEach((r) => r(v === undefined ? null : v));
    },
    dialog(value) {
      return new Promise((resolve) => {
        pending.push(resolve);
        later(() => {
          const i = pending.indexOf(resolve);
          if (i < 0) return;
          pending.splice(i, 1);
          resolve(value);
        });
      });
    },
    askCallResponse(o) {
      hud.seen.call.push(o);
      return hud.dialog(policy.response(o));
    },
    askMaoDeOnze(o) {
      hud.seen.onze.push(o);
      return hud.dialog(policy.onze(o));
    },
    showMatchEnd(o) {
      hud.ended = o;
      return new Promise((resolve) => {
        pending.push(resolve);
        if (policy.onEnd) policy.onEnd(o, resolve);
      });
    },
    showMenu(defaults, opts) {
      hud.menus = (hud.menus || 0) + 1;
      return new Promise((resolve) => {
        pending.push(resolve);
        if (policy.onMenu) policy.onMenu(defaults, opts, resolve);
      });
    },
    showRules: () => Promise.resolve(),
  };
  return hud;
}

/** Humano de roteiro: joga por clique ou tecla, às vezes pede truco ou encobre. */
function scriptedHuman(seed, opts) {
  const o = opts || {};
  const r = rngFrom(seed);
  const stats = { clicks: 0, keys: 0, calls: 0, faceDowns: 0, responses: {}, onze: 0 };
  return {
    stats,
    attach(scene, hud) {
      scene.onInteractive = (cards) => {
        const a = hud.actions;
        if (!a.visible) return;
        if (a.canCall && r() < (o.callRate || 0.25)) {
          stats.calls++;
          hud.emit('call');
          return;
        }
        if (a.canFaceDown && r() < 0.35) {
          stats.faceDowns++;
          hud.emit('toggleFaceDown');
        }
        const i = Math.floor(r() * cards.length);
        if (r() < 0.5) {
          stats.keys++;
          hud.emit('playIndex', i);
        } else {
          stats.clicks++;
          const c = cards[i];
          scene.click(c && c.id ? c.id : null, i);
        }
      };
    },
    response(o2) {
      const pick = r();
      const answer = o2.canRaise && pick < 0.25 ? 'raise' : pick < 0.8 ? 'accept' : 'run';
      stats.responses[answer] = (stats.responses[answer] || 0) + 1;
      return answer;
    },
    onze() {
      stats.onze++;
      return r() < (o.onzeAccept === undefined ? 0.6 : o.onzeAccept);
    },
  };
}

/** Áudio falso: guarda o que foi falado (voz) e o estado de mudo. */
function fakeAudio() {
  const audio = {
    said: [],
    muted: null,
    play() {},
    say(text, o) {
      audio.said.push({ text, seat: o && o.seat, shout: !!(o && o.shout), voice: o && o.voice ? Object.assign({}, o.voice) : null, clip: (o && o.clip) || null });
      return Promise.resolve();
    },
    setMuted(v) {
      audio.muted = v;
    },
    setVoice(v) {
      audio.voice = v;
    },
    ambient() {},
    init: () => Promise.resolve(true),
  };
  return audio;
}

function setup(params, policyOverrides, extra) {
  const human = scriptedHuman((params.seed || 1) * 7 + 3, policyOverrides && policyOverrides.human);
  const policy = Object.assign(
    {
      response: (o) => human.response(o),
      onze: (o) => human.onze(o),
    },
    policyOverrides || {}
  );
  const scene = fakeScene();
  const hud = fakeHud(policy);
  human.attach(scene, hud);
  const ex = Object.assign({}, extra || {});
  if (typeof ex.onScene === 'function') ex.onScene(scene);
  delete ex.onScene;
  const debug = { events: [], errors: [], thinks: [] };
  const ctl = Game.createController(
    Object.assign(
      {
        Engine,
        AI,
        scene,
        hud,
        audio: null,
        debug,
        params: Object.assign({ speed: 1000, skipMenu: true }, params),
      },
      ex
    )
  );
  ctl.begin();
  return { ctl, scene, hud, debug, human };
}

async function until(fn, timeoutMs, label) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('esperou demais: ' + (label || fn.toString()));
    await sleep(2);
  }
}

function untilMatchEnd(hud, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (hud.ended) return resolve(hud.ended);
      if (Date.now() - t0 > timeoutMs) return reject(new Error('partida não terminou em ' + timeoutMs + ' ms'));
      setTimeout(tick, 5);
    };
    tick();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

test('parâmetros de URL: válidos entram, inválidos viram null', () => {
  const p = Game.readParams('?autoplay=1&skipMenu=1&speed=12&seed=42&players=2&deck=sujo&format=bestOf3&difficulty=dificil&quality=low&mute=1&startScore=11,10');
  assert.equal(p.autoplay, true);
  assert.equal(p.skipMenu, true);
  assert.equal(p.mute, true);
  assert.equal(p.speed, 12);
  assert.equal(p.seed, 42);
  assert.equal(p.players, 2);
  assert.equal(p.deck, 'sujo');
  assert.equal(p.format, 'bestOf3');
  assert.equal(p.difficulty, 'dificil');
  assert.equal(p.quality, 'low');
  assert.deepEqual(p.startScore, [11, 10]);
  const bad = Game.readParams('?players=3&deck=x&speed=-2&seed=abc&startScore=12,1&format=melhor');
  assert.equal(bad.players, null);
  assert.equal(bad.deck, null);
  assert.equal(bad.speed, null);
  assert.equal(bad.seed, null);
  assert.equal(bad.startScore, null);
  assert.equal(bad.format, null);
  const merged = Game.mergeSettings({ players: 4, deck: 'limpo', sound: true, voice: true }, { players: 2 }, { players: null, deck: 'sujo', mute: true });
  assert.deepEqual([merged.players, merged.deck, merged.sound, merged.voice], [2, 'sujo', false, false]);
});

test('elenco: nomes e visuais pedidos por modo (fichas de personagens/)', () => {
  assert.deepEqual(Game.namesFor(2), ['Você', 'Tião']);
  // Mesa padrão do 2×2: o Vini é o parceiro (à frente), a Bia joga pela esquerda e o Seu Tião pela direita.
  assert.deepEqual(Game.namesFor(4), ['Você', 'Tião', 'Vini', 'Bia']);
  assert.deepEqual(Game.DEFAULT_SEATS[4], { 1: 'tiao', 2: 'vini', 3: 'bia' });
  assert.deepEqual(Game.DEFAULT_SEATS[2], { 1: 'tiao' });
  const looks = Game.avatarSpecs(4).map((a) => [a.seat, a.name, a.hairStyle, a.face, a.accessory, a.outfit, a.shirt]);
  assert.deepEqual(looks, [
    [1, 'Tião', 'careca', 'bigodao', 'nenhum', 'camisa-listrada', '#2f5d8a'],
    [2, 'Vini', 'curto', 'barba', ['bone-frente', 'oculos-fino'], 'camisa-lisa', '#1f1d1c'],
    [3, 'Bia', 'rabo-de-cavalo', 'nenhum', 'nenhum', 'camisa-de-time', '#2e8b83'],
  ]);
  const [, vini, bia] = Game.avatarSpecs(4);
  assert.equal(vini.capMark, 'tres-quadrados');
  assert.equal(bia.earrings, true);
  assert.deepEqual(Game.avatarSpecs(2).map((a) => [a.seat, a.name, a.hairStyle]), [[1, 'Tião', 'careca']]);
  for (const a of Game.avatarSpecs(4)) for (const k of ['skin', 'hair', 'shirt', 'accent']) assert.match(a[k], /^#[0-9a-f]{6}$/, k);
});

test('autoplay: partidas completas 1x1 e 2x2, limpo e sujo, 1 jogo e melhor de 3', async () => {
  const combos = [];
  for (const players of [2, 4]) for (const deck of ['limpo', 'sujo']) for (const format of ['single', 'bestOf3']) combos.push({ players, deck, format });
  let seed = 11;
  for (const c of combos) {
    const { hud, debug, scene } = setup(Object.assign({ autoplay: true, seed: seed++ }, c));
    const end = await untilMatchEnd(hud, 20000);
    assert.deepEqual(debug.errors, [], JSON.stringify(debug.errors.slice(0, 3)));
    assert.ok(end.winnerTeam === 0 || end.winnerTeam === 1);
    assert.ok(Math.max(end.score[0], end.score[1]) >= 12, 'alguém chegou a 12');
    assert.equal(scene.players, c.players);
    assert.ok(debug.events.some((e) => e.type === 'matchEnded'));
    // Toda carta jogada foi animada, com o índice certo da mão.
    const played = debug.events.filter((e) => e.type === 'cardPlayed').length;
    assert.equal(scene.calls.playCard, played);
    assert.ok(scene.played.every((p) => Number.isInteger(p.o.handIndex) && p.o.handIndex >= 0 && p.o.handIndex <= 2));
    // Encoberta de bot nunca chega à cena com a face.
    assert.ok(scene.played.every((p) => !(p.o.faceDown && p.seat !== 0 && p.card)));
    if (c.format === 'bestOf3') assert.ok(end.gamesWon && Math.max(...end.gamesWon) === 2);
  }
});

test('humano de roteiro: clique, teclas, truco, encoberta e respostas, sem erros', async () => {
  const totals = { clicks: 0, keys: 0, calls: 0, faceDowns: 0, responses: 0 };
  let humanFaceDown = 0;
  let humanCalls = 0;
  for (let k = 0; k < 8; k++) {
    const players = k % 2 ? 4 : 2;
    const { hud, debug, human, scene } = setup({ seed: 100 + k, players, deck: k % 4 < 2 ? 'limpo' : 'sujo' });
    await untilMatchEnd(hud, 30000);
    assert.deepEqual(debug.errors, [], JSON.stringify(debug.errors.slice(0, 3)));
    for (const key of Object.keys(totals)) {
      if (key === 'responses') totals.responses += Object.values(human.stats.responses).reduce((a, b) => a + b, 0);
      else totals[key] += human.stats[key];
    }
    humanFaceDown += debug.events.filter((e) => e.type === 'cardPlayed' && e.seat === 0 && e.faceDown).length;
    humanCalls += debug.events.filter((e) => e.type === 'call' && e.seat === 0).length;
    // A cena nunca recebeu as cartas dos outros jogadores na distribuição.
    assert.ok(scene.lastDeal.hands.slice(1).every((h) => h.length === 0));
    // Em 2x2, todo pedido que o humano respondeu veio com conselho do parceiro (o Vini, padrão).
    if (players === 4) assert.ok(hud.seen.call.every((o) => o.advice && o.advice.name === 'Vini'));
  }
  assert.ok(totals.clicks > 20 && totals.keys > 20, JSON.stringify(totals));
  assert.ok(humanCalls > 3, 'o humano pediu truco: ' + humanCalls);
  assert.ok(totals.responses > 3, 'o humano respondeu pedidos: ' + totals.responses);
  assert.ok(humanFaceDown > 0, 'alguma carta do humano foi encoberta');
});

test('mão de onze do nosso time: humano vê as cartas da parceira, recebe conselho e pode correr', async () => {
  const { hud, debug, scene } = setup({ seed: 7, players: 4, startScore: [11, 4] }, { human: { onzeAccept: 0 } });
  await untilMatchEnd(hud, 30000);
  assert.deepEqual(debug.errors, []);
  const first = hud.seen.onze[0];
  assert.ok(first, 'diálogo da mão de onze apareceu');
  assert.equal(first.myCards.length, 3);
  assert.equal(first.partnerCards.length, 3);
  assert.ok(first.advice && ['accept', 'run'].includes(first.advice.action));
  assert.ok(Array.isArray(scene.calls.showPartnerHand[0]) && scene.calls.showPartnerHand[0].length === 3);
  assert.equal(scene.calls.showPartnerHand[1], null, 'as cartas da parceira voltam a ficar ocultas');
  const firstEnd = debug.events.find((e) => e.type === 'handEnded');
  assert.equal(firstEnd.reason, 'maoDeOnzeRun');
  assert.deepEqual(firstEnd.score, [11, 5]);
});

test('mão de ferro: humano joga às cegas por posição (clique sem id)', async () => {
  const { hud, debug, scene } = setup({ seed: 5, players: 2, startScore: [11, 11] });
  await untilMatchEnd(hud, 30000);
  assert.deepEqual(debug.errors, []);
  const started = debug.events.find((e) => e.type === 'handStarted');
  assert.equal(started.special, 'maoDeFerro');
  // A cena recebeu só versos para o humano.
  assert.ok(scene.played.length > 0);
  const firstDealHands = debug.events.filter((e) => e.type === 'handStarted');
  assert.ok(firstDealHands.length >= 1);
  const blindPlays = debug.events.filter((e) => e.type === 'cardPlayed' && e.blind && e.seat === 0);
  assert.ok(blindPlays.length >= 1);
});

test('pausa segura o jogo e continuar retoma; nova partida aborta a anterior sem vazar ouvintes', async () => {
  const menuQueue = [];
  const { ctl, hud, debug, scene } = setup(
    { seed: 21, players: 4, autoplay: true, speed: 50 },
    { onMenu: (defaults, opts, resolve) => menuQueue.push({ opts, resolve }) }
  );
  const listeners = scene.listenerCount() + hud.listenerCount();
  await sleep(40);
  const firstSession = ctl.session;
  hud.emit('menu');
  await sleep(5);
  assert.equal(ctl.phase(), 'paused');
  assert.equal(menuQueue[0].opts && menuQueue[0].opts.resumable, true);
  const frozen = debug.events.length;
  await sleep(120);
  assert.ok(debug.events.length - frozen <= 12, 'no máximo termina a apresentação em curso');
  const stillFrozen = debug.events.length;
  await sleep(120);
  assert.equal(debug.events.length, stillFrozen, 'pausado não avança');
  menuQueue.shift().resolve(null);
  await sleep(120);
  assert.ok(debug.events.length > stillFrozen, 'continuar retoma');
  assert.equal(ctl.session, firstSession);

  hud.emit('menu');
  await sleep(5);
  menuQueue.shift().resolve({ players: 2, deck: 'sujo', format: 'single', difficulty: 'facil', speed: 1, sound: false, voice: false, highlightManilhas: true, quality: 'low' });
  await sleep(5);
  assert.notEqual(ctl.session, firstSession);
  assert.equal(firstSession.aborted, true);
  assert.equal(ctl.session.cfg.players, 2);
  assert.equal(scene.listenerCount() + hud.listenerCount(), listeners);
  await untilMatchEnd(hud, 30000);
  assert.deepEqual(debug.errors, []);
  ctl.dispose();
  assert.equal(scene.listenerCount() + hud.listenerCount(), 0);
});

test('bot com defeito não trava: erro registrado e ação legal aplicada no lugar', async (t) => {
  t.mock.method(console, 'error', () => {});
  const brokenAI = {
    create(cfg) {
      const real = AI.create(cfg);
      let n = 0;
      return {
        decide(view, d) {
          n++;
          if (cfg.seat === 1 && n % 5 === 0) return { type: 'PLAY', seat: 1, cardId: 'nope' };
          return real.decide(view, d);
        },
        advise: (v, d) => real.advise(v, d),
        phrase: (k, c) => real.phrase(k, c),
      };
    },
  };
  const scene = fakeScene();
  const hud = fakeHud({ response: () => 'accept', onze: () => true });
  const debug = { events: [], errors: [] };
  Game.createController({
    Engine,
    AI: brokenAI,
    scene,
    hud,
    debug,
    params: { autoplay: true, skipMenu: true, speed: 1000, seed: 3, players: 2 },
  }).begin();
  await untilMatchEnd(hud, 30000);
  assert.ok(debug.errors.length > 0);
  assert.ok(debug.errors.every((e) => /ação recusada|bot/.test(e.where)), JSON.stringify(debug.errors[0]));
});

test('"Jogar de novo" começa outra partida com outra semente', async () => {
  const seeds = [];
  let ctlRef = null;
  const { ctl, hud, debug } = setup(
    { seed: 9, players: 2, autoplay: true },
    {
      onEnd: (o, resolve) => {
        seeds.push(ctlRef.session.seed);
        if (seeds.length === 1) setImmediate(() => resolve('again'));
      },
    }
  );
  ctlRef = ctl;
  await untilMatchEnd(hud, 20000);
  hud.ended = null;
  await untilMatchEnd(hud, 20000);
  assert.equal(seeds.length, 2);
  assert.equal(seeds[0], 9, 'a primeira partida usa a semente da URL');
  assert.notEqual(seeds[1], seeds[0]);
  assert.deepEqual(debug.errors, []);
  ctl.dispose();
});

// ---------------------------------------------------------------------------------- revisão

test('pausa: "Continuar" aplica som/voz/destaque/velocidade na hora; modo, baralho etc. ficam para a próxima', async () => {
  const menuQueue = [];
  const audio = fakeAudio();
  const { ctl, hud, scene, debug } = setup(
    { seed: 31, players: 4 },
    { onMenu: (defaults, opts, resolve) => menuQueue.push({ defaults, opts, resolve }) },
    { audio }
  );
  scene.onInteractive = null; // o "humano" segura a vez
  await until(() => ctl.session && ctl.session.human && ctl.session.human.kind === 'play', 20000, 'vez do humano');
  const sess = ctl.session;
  assert.equal(scene.hand.opts.highlightManilhas, true);
  hud.emit('menu');
  await sleep(2);
  assert.equal(ctl.phase(), 'paused');
  const menu = menuQueue.shift();
  assert.equal(menu.opts.resumable, true);
  assert.equal(menu.defaults.players, 4, 'o menu de pausa mostra a partida atual');
  // O HUD real grava as preferências, emite onSettings e resolve null.
  hud.emitSettings(Object.assign({}, ctl.settings, { highlightManilhas: false, sound: false, speed: 1.5, players: 2, deck: 'sujo' }));
  menu.resolve(null);
  await sleep(2);
  assert.equal(ctl.settings.highlightManilhas, false);
  assert.equal(ctl.settings.sound, false);
  assert.equal(ctl.settings.speed, 1.5);
  assert.equal(audio.muted, true, 'o som para na hora');
  assert.equal(ctl.phase(), 'playing');
  assert.equal(ctl.session, sess, 'mesma partida');
  assert.equal(sess.cfg.players, 4, 'modo não muda no meio');
  assert.equal(sess.cfg.deck, 'limpo', 'baralho não muda no meio');
  assert.equal(scene.hand.opts.highlightManilhas, false, 'a mão perde o destaque');
  assert.equal(scene.hand.opts.interactive, true, 'a vez continua');
  const before = debug.events.length;
  const card = scene.hand.cards[0];
  scene.click(card.id, 0);
  await until(() => debug.events.length > before, 5000, 'jogada depois de continuar');
  assert.deepEqual(debug.errors, []);
  ctl.dispose();
});

test('um grito por pedido: diálogo com a fala de quem pediu, sem letreiro nem balão por trás; humano só com voz', async () => {
  const lists = Object.values(Game.ADVICE_TEXT).flatMap((byAction) => Object.values(byAction).flat());
  let dialogs = 0;
  for (let k = 0; k < 6; k++) {
    const audio = fakeAudio();
    const { hud, debug } = setup({ seed: 300 + k, players: k % 2 ? 2 : 4 }, { human: { callRate: 0.4 } }, { audio });
    await untilMatchEnd(hud, 30000);
    assert.deepEqual(debug.errors, []);
    const calls = debug.events.filter((e) => e.type === 'call');
    const trucoBanners = hud.seen.bannerOpts.filter((b) => b.kind === 'truco');
    // Cada pedido que o humano respondeu virou só o diálogo; os demais, um letreiro.
    assert.equal(trucoBanners.length, calls.length - hud.seen.call.length);
    for (const o of hud.seen.call) {
      assert.ok(o.quote && o.quote.text && o.quote.name === o.callerName, 'fala de quem pediu no diálogo: ' + JSON.stringify(o.quote));
    }
    for (const b of trucoBanners) assert.ok(/vale \d+$/.test(b.sub), b.sub);
    // O assento 0 nunca ganha balão; o conselho da parceira nunca vira balão.
    assert.ok(hud.seen.speech.every(([seat]) => seat !== 0), 'balão do humano');
    assert.ok(hud.seen.speech.every(([seat, text]) => !(seat === 2 && lists.includes(text))), 'conselho em balão');
    // Os gritos dos bots continuam na voz.
    if (calls.some((e) => e.seat !== 0)) assert.ok(audio.said.some((x) => x.shout && x.seat !== 0));
    dialogs += hud.seen.call.length;
  }
  assert.ok(dialogs > 3, 'houve pedidos respondidos pelo humano: ' + dialogs);
});

test('diálogo de resposta traz as cartas da mesa, sem revelar encobertas; 1×1 fala do Tião pelo nome', async () => {
  let withCards = 0;
  for (let k = 0; k < 6; k++) {
    const players = k % 2 ? 4 : 2;
    const { hud, debug } = setup({ seed: 400 + k, players, deck: k < 3 ? 'limpo' : 'sujo' });
    await untilMatchEnd(hud, 30000);
    assert.deepEqual(debug.errors, []);
    for (const o of hud.seen.call) {
      assert.ok(o.table && Array.isArray(o.table.rounds), 'resumo da mesa');
      assert.ok(o.table.vira && o.table.manilhaRank);
      for (const r of o.table.rounds) {
        for (const p of r.plays) {
          assert.ok(typeof p.name === 'string' && p.name.length > 0);
          if (p.faceDown) assert.equal(p.card, null, 'encoberta nunca vai com a face');
        }
      }
      if (o.table.rounds.length) withCards++;
      assert.equal(o.opponentLabel, players === 2 ? 'o Tião' : null);
    }
    for (const o of hud.seen.onze) assert.equal(o.opponentLabel, players === 2 ? 'o Tião' : null);
  }
  assert.ok(withCards > 0, 'algum pedido veio depois de cartas jogadas');
});

test('rodadas: nota curta com vencedor e carta depois de cada rodada; limpa a cada mão', async () => {
  const { hud, debug } = setup({ seed: 12, players: 4, autoplay: true });
  await untilMatchEnd(hud, 20000);
  const rounds = debug.events.filter((e) => e.type === 'roundEnded');
  const notes = hud.seen.notes.filter(Boolean);
  assert.equal(notes.length, rounds.length);
  assert.ok(notes.every((n) => /^[123]ª: (cangou|você|nós · \S+ do Vini|Tião|Bia)/.test(n)), notes.slice(0, 6).join(' | '));
  const hands = debug.events.filter((e) => e.type === 'handStarted').length;
  assert.ok(hud.seen.notes.filter((n) => n === null).length >= hands);
});

test('fácil no 2×2: a parceira joga no médio, os adversários no fácil', () => {
  const created = {};
  const spyAI = { create: (cfg) => ((created[cfg.seat] = cfg.difficulty), AI.create(cfg)) };
  const scene = fakeScene();
  const hud = fakeHud({ response: () => 'accept', onze: () => true });
  const ctl = Game.createController({ Engine, AI: spyAI, scene, hud, debug: { events: [], errors: [] }, params: { speed: 1000, players: 4, difficulty: 'facil' } });
  ctl.startMatch({ players: 4, deck: 'limpo', format: 'single', difficulty: 'facil' });
  assert.deepEqual(created, { 1: 'facil', 2: 'medio', 3: 'facil' });
  ctl.dispose();
  const again = {};
  const ctl2 = Game.createController({
    Engine,
    AI: { create: (cfg) => ((again[cfg.seat] = cfg.difficulty), AI.create(cfg)) },
    scene: fakeScene(),
    hud: fakeHud({ response: () => 'accept', onze: () => true }),
    debug: { events: [], errors: [] },
    params: { speed: 1000 },
  });
  ctl2.startMatch({ players: 4, deck: 'limpo', format: 'single', difficulty: 'dificil' });
  assert.deepEqual(again, { 1: 'dificil', 2: 'dificil', 3: 'dificil' });
  ctl2.dispose();
});

test('placar: mão de onze mostra VALE 3; melhor de 3 conta o jogo já na mão que o fecha', async () => {
  const onze = setup({ seed: 8, players: 2, startScore: [11, 5] }, { onze: () => false });
  await until(() => onze.hud.seen.onze.length > 0, 20000, 'diálogo da mão de onze');
  assert.equal(onze.hud.info.value, 3, 'VALE 3 durante a decisão');
  assert.equal(onze.hud.seen.bannerOpts.find((b) => b.kind === 'onze').sub, 'Você decide: jogar (vale 3) ou correr');
  onze.ctl.dispose();

  const theirs = setup({ seed: 8, players: 2, startScore: [4, 11], autoplay: false });
  await until(() => theirs.hud.seen.bannerOpts.some((b) => b.kind === 'onze'), 20000, 'letreiro da mão de onze deles');
  assert.equal(theirs.hud.seen.bannerOpts.find((b) => b.kind === 'onze').sub, 'Tião decide se joga');
  theirs.ctl.dispose();

  const bo3 = setup({ seed: 17, players: 2, autoplay: true, format: 'bestOf3', startScore: [11, 10] });
  await untilMatchEnd(bo3.hud, 20000);
  const firstGame = bo3.debug.events.find((e) => e.type === 'gameEnded');
  const closing = bo3.hud.seen.scores.find((c) => Math.max(c.score[0], c.score[1]) >= 12);
  assert.ok(closing, 'setScore da mão que fechou o jogo');
  assert.deepEqual(closing.gamesWon, firstGame.gamesWon);
});

test('ritmo: tempo de pensar conforme a jogada; embaralhada completa só na 1ª mão de cada jogo', async () => {
  const { hud, debug, scene } = setup({ seed: 23, players: 4, autoplay: true, format: 'bestOf3' });
  await untilMatchEnd(hud, 30000);
  assert.deepEqual(debug.errors, []);
  const t = debug.thinks;
  const single = t.filter((x) => x.kind === 'single');
  const responses = t.filter((x) => x.mode === 'response');
  assert.ok(single.length > 0 && responses.length > 0, JSON.stringify({ single: single.length, responses: responses.length }));
  assert.ok(single.every((x) => x.ms < 700), 'uma carta só: rápido');
  assert.ok(responses.every((x) => x.ms >= 1000), 'resposta a pedido: pensa');
  assert.ok(t.filter((x) => x.kind === 'call').every((x) => x.ms >= 700 && x.ms <= 1600));
  // 1ª mão de cada jogo: embaralhada completa; demais: corte curto.
  const starts = [];
  let firstOfGame = true;
  for (const e of debug.events) {
    if (e.type === 'handStarted') {
      starts.push(firstOfGame);
      firstOfGame = false;
    } else if (e.type === 'gameEnded') firstOfGame = true;
  }
  assert.equal(scene.deals.length, starts.length);
  scene.deals.forEach((d, i) => assert.equal(d.quickShuffle, !starts[i], 'mão ' + (i + 1)));
  assert.ok(starts.filter(Boolean).length >= 2, 'melhor de 3: mais de um jogo');
  // Decidir antes de esperar não muda nada: a mesma semente dá a mesma partida.
  const again = setup({ seed: 23, players: 4, autoplay: true, format: 'bestOf3' });
  await untilMatchEnd(again.hud, 30000);
  assert.equal(JSON.stringify(again.debug.events), JSON.stringify(debug.events), 'autoplay determinístico por semente');
});

test('falas: conselhos variam sem repetir a última; a mesa não repete fala entre as 6 últimas', async () => {
  const rng = (() => {
    let a = 99;
    return () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296);
  })();
  for (const [kind, byAction] of Object.entries(Game.ADVICE_TEXT)) {
    for (const [action, list] of Object.entries(byAction)) {
      assert.ok(list.length >= 2, kind + '.' + action);
      const count = {};
      let last = null;
      for (let i = 0; i < 300; i++) {
        const t = Game.pickLine(list, last, rng);
        assert.notEqual(t, last, 'não repete a última');
        last = t;
        count[t] = (count[t] || 0) + 1;
      }
      const max = Math.max(...Object.values(count));
      assert.ok(max / 300 <= 0.51, kind + '.' + action + ': ' + JSON.stringify(count));
    }
  }
  let lines = 0;
  let repeats = 0;
  for (const seed of [41, 42]) {
    const audio = fakeAudio();
    const { hud, debug } = setup({ seed, players: 4, autoplay: true, format: 'bestOf3' }, null, { audio });
    await untilMatchEnd(hud, 30000);
    assert.deepEqual(debug.errors, []);
    const said = audio.said.map((x) => x.text);
    said.forEach((text, i) => {
      lines++;
      if (said.slice(Math.max(0, i - 6), i).includes(text)) repeats++;
    });
  }
  assert.ok(lines > 60, 'falas: ' + lines);
  assert.ok(repeats / lines < 0.03, 'repetidas: ' + repeats + ' de ' + lines);
});

test('tela final: diz como acabou (mão de ferro), traz resumo e a provocação do adversário', async () => {
  const { hud, debug } = setup({ seed: 5, players: 2, startScore: [11, 11] });
  const end = await untilMatchEnd(hud, 30000);
  assert.deepEqual(debug.errors, []);
  assert.ok(/mão de ferro/.test(end.how), end.how);
  assert.ok(end.summary && Array.isArray(end.summary.hands));
  if (end.quote) assert.equal(end.quote.name, 'Tião');
});

test('aba em segundo plano e perda do contexto 3D seguram a partida e retomam', async () => {
  const { ctl, hud, debug, scene } = setup({ seed: 51, players: 4, autoplay: true, speed: 50 });
  await until(() => debug.events.length > 5, 5000, 'partida andando');
  ctl.setTabHidden(true);
  assert.equal(ctl.phase(), 'paused');
  await sleep(150);
  const frozen = debug.events.length;
  await sleep(150);
  assert.equal(debug.events.length, frozen, 'aba escondida não avança');
  ctl.setTabHidden(false);
  await until(() => debug.events.length > frozen, 5000, 'volta a andar');

  // Pausa pelo menu não é desfeita pela volta da aba.
  const menuQueue = [];
  hud.showMenu = (d, o) => new Promise((resolve) => menuQueue.push(resolve));
  hud.emit('menu');
  await sleep(2);
  ctl.setTabHidden(true);
  ctl.setTabHidden(false);
  assert.equal(ctl.phase(), 'paused', 'o menu continua segurando');
  menuQueue.shift()(null);
  await sleep(2);
  assert.equal(ctl.phase(), 'playing');

  scene.context('lost');
  assert.equal(ctl.phase(), 'paused');
  assert.ok(hud.seen.banners.includes('Recuperando a mesa 3D…'));
  await sleep(150);
  const lostAt = debug.events.length;
  await sleep(150);
  assert.equal(debug.events.length, lostAt, 'sem contexto não avança');
  scene.context('restored');
  assert.equal(hud.dismissed, 1);
  assert.equal(ctl.phase(), 'playing');
  await until(() => debug.events.length > lostAt, 5000, 'segue depois de restaurar');
  assert.deepEqual(debug.errors, []);
  ctl.dispose();
});

test('galáxia do seis: cada pedido que vai a 6 dispara o efeito uma vez, e só esses', async () => {
  let seis = 0;
  let outros = 0;
  for (let seed = 40; seed < 70 && seis === 0; seed++) {
    const { hud, debug, scene } = setup({ autoplay: true, seed, players: 2, difficulty: 'dificil' });
    await untilMatchEnd(hud, 60000);
    const calls = debug.events.filter((e) => e.type === 'call');
    const six = calls.filter((e) => e.to === 6).length;
    assert.equal(scene.calls.galaxySix, six, 'seed ' + seed + ': efeito disparado ' + scene.calls.galaxySix + 'x para ' + six + ' pedidos de seis');
    seis += six;
    outros += calls.length - six;
  }
  assert.ok(seis > 0, 'nenhuma partida teve pedido de seis');
  assert.ok(outros > 0);
});

// ------------------------------------------------------------------ personagens à mesa

test('escolha de lugares: respeita a escolha, não repete ninguém e cai no padrão com id desconhecido', () => {
  const ids = (cast) => cast.map((p) => (p ? p.id : null));
  assert.deepEqual(ids(Game.resolveCast(4, {})), [null, 'tiao', 'vini', 'bia']);
  // O parceiro padrão é o Vini, mas dá para escolher outro (ex.: a Dona Cida).
  assert.deepEqual(ids(Game.resolveCast(4, { 2: 'dona-cida' })), [null, 'tiao', 'dona-cida', 'bia']);
  assert.deepEqual(ids(Game.resolveCast(4, { 1: 'rosa', 2: 'tiao', 3: 'juninho' })), [null, 'rosa', 'tiao', 'juninho']);
  // Mesma pessoa em dois lugares: o segundo lugar volta ao padrão (ou a quem sobrou).
  assert.deepEqual(ids(Game.resolveCast(4, { 1: 'rosa', 2: 'rosa', 3: 'rosa' })), [null, 'rosa', 'vini', 'bia']);
  assert.deepEqual(ids(Game.resolveCast(4, { 1: 'vini', 2: 'nao-existe' })), [null, 'vini', 'tiao', 'bia']);
  assert.deepEqual(ids(Game.resolveCast(4, { 1: 'bia', 3: 'tiao' })), [null, 'bia', 'vini', 'tiao']);
  assert.deepEqual(ids(Game.resolveCast(2, { 1: 'juninho' })), [null, 'juninho']);
  assert.deepEqual(ids(Game.resolveCast(2, { 1: 'sumiu' })), [null, 'tiao']);
});

test('personagem criado (Meus personagens) senta à mesa: nome, jeito de jogar, voz e falas da ficha', async () => {
  Personagens._usarArmazenamento(memoryStorage());
  try {
    const saved = Personagens.salvarMeu({
      nome: 'Zé do Caixa',
      genero: 'ele',
      jogo: { estilo: 'cauteloso', blefe: 1 },
      voz: { tom: 'agudo', velocidade: 'rapido' },
      falas: {
        aceitar: ['Cai, freguês!'],
        correr: ['Fecha a conta!'],
        ganhouRodada: ['Anota no caderno!'],
        perdeuRodada: ['Pendura essa.'],
        cangou: ['Empatou, fiado.'],
        pensando: ['Quanto deu mesmo?'],
        truco: ['Truco, freguês!'],
        seis: ['Seis, freguês!'],
        nove: ['Nove, freguês!'],
        doze: ['Doze, freguês!'],
      },
    });
    assert.equal(saved.salvo, true);
    assert.equal(saved.personagem.id, 'ze-do-caixa');
    const audio = fakeAudio();
    const { ctl, hud, debug } = setup({ players: 4, seed: 21, autoplay: true }, {}, {
      audio,
      saved: { seats4: { 1: 'ze-do-caixa', 2: 'rosa', 3: 'tiao' } },
    });
    await untilMatchEnd(hud, 30000);
    const sess = ctl.session;
    assert.deepEqual(sess.names, ['Você', 'Zé do Caixa', 'Rosa', 'Tião']);
    assert.deepEqual(hud.names, sess.names);
    assert.deepEqual(sess.bots[1].personality, { bluff: 0.1, caution: 0.8 });
    assert.deepEqual(sess.bots[3].personality, { bluff: 0.72, caution: 0.35 });
    // Tudo o que o Zé falou pelo balão é da ficha dele (todos os momentos que aparecem ali têm fala).
    const own = new Set(Object.values(Personagens.buscar('ze-do-caixa').falas).flat());
    const zeLines = hud.seen.speech.filter(([seat]) => seat === 1).map(([, t]) => t);
    const zeFicha = zeLines.filter((t) => own.has(t));
    assert.ok(zeFicha.length > 0, 'o Zé falou algo da ficha: ' + zeLines.join(' | '));
    // Voz por personagem: agudo + rápido = { pitch 1.22, rate 1.12 }.
    const zeVoice = audio.said.filter((x) => x.seat === 1 && x.voice);
    assert.ok(zeVoice.length > 0);
    assert.ok(zeVoice.every((x) => x.voice.pitch === 1.22 && x.voice.rate === 1.12));
    assert.equal(debug.errors.length, 0, JSON.stringify(debug.errors));
  } finally {
    Personagens._usarArmazenamento(undefined);
  }
});

test('falas: a ficha tem prioridade; momento sem fala própria usa as falas padrão da IA', async () => {
  const { ctl, hud } = setup({ players: 4, seed: 5, autoplay: true });
  await untilMatchEnd(hud, 30000);
  const tiao = Personagens.buscar('tiao');
  const tiaoTruco = hud.seen.bannerOpts.filter((b) => /^Tião: “/.test(b.sub || '')).map((b) => b.sub);
  // Quando o Tião pede truco (vale 3), a fala vem da ficha dele.
  for (const sub of tiaoTruco.filter((t) => / vale 3$/.test(t))) {
    assert.ok(tiao.falas.truco.some((f) => sub.indexOf('“' + f + '”') >= 0), sub);
  }
  assert.ok(ctl.session.cast[1].id === 'tiao');
});

/** Espera, para cada mão do 2×2, o sinal que o parceiro deve fazer (ou null). */
function expectedSignals(events) {
  return events
    .filter((e) => e.type === 'handStarted')
    .map((e) => {
      if (e.special === 'maoDeFerro' || (e.special === 'maoDeOnze' && e.specialTeam === 0)) return null;
      return Personagens.cartaParaSinal(e.hands[2], e.manilhaRank);
    });
}

test('sinal do parceiro (2×2): um gesto por mão para a carta mais forte, com o texto no HUD', async () => {
  const calls = [];
  const { hud, debug } = setup({ players: 4, seed: 33, autoplay: true, startScore: [9, 10] }, {}, {
    onScene(scene) {
      scene.avatarSignal = (seat, gesto) => {
        calls.push({ seat, gesto });
        return Promise.resolve();
      };
    },
  });
  await untilMatchEnd(hud, 30000);
  const all = expectedSignals(debug.events);
  const expected = all.filter(Boolean);
  const vini = Personagens.buscar('vini');
  assert.ok(expected.length > 0, 'alguma mão teve carta forte na mão do Vini');
  assert.ok(all.some((c) => !c), 'e alguma mão não teve');
  assert.ok(calls.every((c) => c.seat === 2));
  assert.deepEqual(calls.map((c) => c.gesto), expected.map((carta) => Personagens.sinal(vini, carta)));
  assert.equal(debug.signals, undefined); // o debug do teste não tem a lista: nada quebra
  const texts = hud.seen.toasts.filter((t) => / — tem /.test(t));
  assert.equal(texts.length, expected.length);
  assert.ok(texts.every((t) => t.indexOf('Vini ') === 0), texts.join(' | '));
  assert.equal(debug.errors.length, 0, JSON.stringify(debug.errors));
});

test('sinal do parceiro: sem avatarSignal na cena só o texto; "Explicar os sinais" desligado não mostra nada; 1×1 não sinaliza', async () => {
  const a = setup({ players: 4, seed: 34, autoplay: true }, {}, { saved: { explainSignals: false } });
  await untilMatchEnd(a.hud, 30000);
  assert.ok(expectedSignals(a.debug.events).some(Boolean));
  assert.equal(a.hud.seen.toasts.filter((t) => / — tem /.test(t)).length, 0);
  assert.equal(a.debug.errors.length, 0);

  const b = setup({ players: 4, seed: 34, autoplay: true });
  await untilMatchEnd(b.hud, 30000);
  assert.equal(b.hud.seen.toasts.filter((t) => / — tem /.test(t)).length, expectedSignals(b.debug.events).filter(Boolean).length);

  const calls = [];
  const c = setup({ players: 2, seed: 35, autoplay: true }, {}, { onScene: (sc) => { sc.avatarSignal = (seat, g) => calls.push([seat, g]); } });
  await untilMatchEnd(c.hud, 30000);
  assert.equal(calls.length, 0);
  assert.equal(c.hud.seen.toasts.filter((t) => / — tem /.test(t)).length, 0);
});

test('sinal do parceiro: nada na mão de ferro nem na nossa mão de onze', () => {
  const zap = [{ id: 'Qc', rank: 'Q', suit: 'clubs' }];
  const ev = (special, specialTeam) => ({ type: 'handStarted', special, specialTeam, manilhaRank: 'Q', hands: [[], [], zap, []] });
  assert.deepEqual(expectedSignals([ev(null, null), ev('maoDeFerro', null), ev('maoDeOnze', 0), ev('maoDeOnze', 1)]), ['zap', null, null, 'zap']);
});

// ------------------------------------------------------------------ áudio gravado (docs/AUDIO.md)

test('áudio gravado: fala da ficha vai com o arquivo dela (clip), gritos de quem joga também; pré-carga do elenco', async () => {
  const cast = { 1: Personagens.buscar('tiao'), 2: Personagens.buscar('vini'), 3: Personagens.buscar('bia') };
  let withClip = 0;
  let humanClips = 0;
  for (const seed of [41, 7]) {
    const audio = fakeAudio();
    audio.preloaded = [];
    audio.preloadVoices = (ids) => {
      audio.preloaded.push(ids);
      return 0;
    };
    // seed 41: todos bots; seed 7: o humano de roteiro pede truco e responde.
    const { hud, debug } = setup({ seed, players: 4, autoplay: seed === 41 }, null, { audio });
    await untilMatchEnd(hud, 30000);
    assert.deepEqual(debug.errors, []);
    assert.deepEqual(audio.preloaded[0], ['tiao', 'vini', 'bia', 'voce']);
    for (const s of audio.said) {
      if (s.seat === 0) {
        const k = Game.HUMAN_CLIPS[s.text];
        if (seed === 7 && k) {
          humanClips++;
          assert.equal(s.clip, 'voce/' + k, s.text);
        }
        continue;
      }
      const p = cast[s.seat];
      const key = Personagens.MOMENTOS.map((m) => Personagens.chaveDeFala(p, m.id, s.text)).find(Boolean);
      if (key) {
        withClip++;
        assert.equal(s.clip, p.id + '/' + key, s.text);
        assert.match(key, /^(para-[a-z-]+-)?[a-zA-Z]+-\d+$/);
      } else assert.equal(s.clip, null, s.text); // fala padrão do jogo (sem ficha): sintetizada
    }
  }
  assert.ok(withClip > 20, 'falas com arquivo: ' + withClip);
  assert.ok(humanClips > 0, 'gritos do humano com arquivo');
});
