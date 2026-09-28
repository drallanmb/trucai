'use strict';
// Testes de Truco.Audio sem navegador: peças puras de DSP/fala e um AudioContext falso que
// valida cada automação agendada (rampa exponencial só a partir de valor > 0, envelopes que
// voltam a zero, fontes sempre com stop, tempos monotônicos e finitos).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MODULE = path.join(__dirname, '..', 'js', 'ui', 'audio.js');

function loadFresh() {
  delete require.cache[require.resolve(MODULE)];
  delete globalThis.Truco;
  return require(MODULE);
}

// ---------------------------------------------------------------- AudioContext falso

const violations = [];

class MockParam {
  constructor(owner, name, value) {
    this.owner = owner;
    this.name = name;
    this.value = value;
    this.events = [];
    this.inputs = 0;
  }
  label() {
    return `${this.owner.kind}.${this.name}`;
  }
  lastValue() {
    const e = this.events[this.events.length - 1];
    if (!e) return this.value;
    return e.type === 'curve' ? e.curve[e.curve.length - 1] : e.v;
  }
  push(e) {
    if (!Number.isFinite(e.t) || e.t < 0) violations.push(`${this.label()}: tempo inválido ${e.t}`);
    if (e.v !== undefined && !Number.isFinite(e.v)) violations.push(`${this.label()}: valor inválido ${e.v}`);
    const last = this.events[this.events.length - 1];
    if (last) {
      const lastEnd = last.type === 'curve' ? last.end : last.t;
      if (e.t < lastEnd - 1e-9) violations.push(`${this.label()}: evento em ${e.t} antes do anterior (${lastEnd})`);
    }
    this.events.push(e);
    return this;
  }
  setValueAtTime(v, t) { return this.push({ type: 'set', v, t }); }
  linearRampToValueAtTime(v, t) { return this.push({ type: 'linear', v, t }); }
  exponentialRampToValueAtTime(v, t) {
    if (!(v > 0 || v < 0)) throw new RangeError(`${this.label()}: rampa exponencial para ${v}`);
    const prev = this.lastValue();
    if (!(prev * v > 0)) violations.push(`${this.label()}: rampa exponencial de ${prev} para ${v} (estalo)`);
    return this.push({ type: 'exp', v, t });
  }
  setTargetAtTime(v, t, tau) {
    if (!(tau > 0)) violations.push(`${this.label()}: setTargetAtTime com tau ${tau}`);
    return this.push({ type: 'target', v, t });
  }
  setValueCurveAtTime(curve, t, duration) {
    if (!(duration > 0)) violations.push(`${this.label()}: curva com duração ${duration}`);
    for (const x of curve) if (!Number.isFinite(x)) violations.push(`${this.label()}: curva com valor inválido`);
    return this.push({ type: 'curve', curve: Array.from(curve), t, end: t + duration });
  }
  cancelScheduledValues(t) {
    this.events = this.events.filter((e) => e.t < t);
    return this;
  }
  cancelAndHoldAtTime(t) {
    const v = this.lastValue();
    this.cancelScheduledValues(t);
    return this.push({ type: 'set', v, t });
  }
}

class MockNode {
  constructor(ctx, kind, params) {
    this.ctx = ctx;
    this.kind = kind;
    this.outputs = [];
    for (const [name, value] of Object.entries(params || {})) this[name] = new MockParam(this, name, value);
    ctx.created.push(this);
  }
  connect(dest) {
    if (!dest || !(dest instanceof MockNode || dest instanceof MockParam)) throw new TypeError('connect: destino inválido');
    if (dest instanceof MockParam) dest.inputs++;
    this.outputs.push(dest);
    return dest;
  }
  disconnect() {
    this.outputs = [];
  }
}

class MockSource extends MockNode {
  start(t, offset) {
    if (this.startedAt !== undefined) throw new Error(`${this.kind}: start() duas vezes`);
    if (!Number.isFinite(t || 0) || !Number.isFinite(offset || 0)) violations.push(`${this.kind}: start inválido`);
    this.startedAt = t || 0;
  }
  stop(t) {
    if (this.startedAt === undefined) throw new Error(`${this.kind}: stop() antes de start()`);
    this.stoppedAt = t === undefined ? this.ctx.currentTime : t;
  }
}

class MockBuffer {
  constructor(channels, length, sampleRate) {
    if (!(length > 0) || !(sampleRate >= 3000)) throw new RangeError('createBuffer: parâmetros inválidos');
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(c) {
    return this.data[c];
  }
}

class MockAudioContext {
  constructor() {
    this.sampleRate = 48000;
    this.currentTime = 0;
    this.state = 'suspended';
    this.created = [];
    this.destination = new MockNode(this, 'destination');
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  createBuffer(ch, len, sr) { return new MockBuffer(ch, len, sr); }
  createGain() { return new MockNode(this, 'gain', { gain: 1 }); }
  createStereoPanner() { return new MockNode(this, 'panner', { pan: 0 }); }
  createBiquadFilter() {
    const n = new MockNode(this, 'biquad', { frequency: 350, Q: 1, gain: 0, detune: 0 });
    n.type = 'lowpass';
    return n;
  }
  createOscillator() {
    const n = new MockSource(this, 'oscillator', { frequency: 440, detune: 0 });
    n.type = 'sine';
    return n;
  }
  createBufferSource() {
    const n = new MockSource(this, 'bufferSource', { playbackRate: 1, detune: 0 });
    n.buffer = null;
    n.loop = false;
    return n;
  }
  createConvolver() { const n = new MockNode(this, 'convolver'); n.buffer = null; n.normalize = true; return n; }
  createDynamicsCompressor() {
    return new MockNode(this, 'compressor', { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 });
  }
  createWaveShaper() { const n = new MockNode(this, 'waveshaper'); n.curve = null; n.oversample = 'none'; return n; }
  createAnalyser() { const n = new MockNode(this, 'analyser'); n.fftSize = 2048; return n; }
}

// Confere os nós criados por um disparo: fontes com início/fim, envelopes fechando em zero.
function auditVoiceNodes(nodes, playedAt) {
  const problems = [];
  for (const n of nodes) {
    if (n instanceof MockSource) {
      if (n.startedAt === undefined) problems.push(`${n.kind} sem start()`);
      else if (n.startedAt < playedAt) problems.push(`${n.kind} começa no passado (${n.startedAt} < ${playedAt})`);
      const finite = n.stoppedAt !== undefined || (n.kind === 'bufferSource' && !n.loop && n.buffer);
      if (!finite) problems.push(`${n.kind} sem stop() (tocaria para sempre)`);
      if (n.stoppedAt !== undefined && n.stoppedAt <= n.startedAt) problems.push(`${n.kind} para antes de começar`);
    }
    if (n.kind === 'gain' && n.gain.events.length) {
      const ev = n.gain.events;
      const first = ev[0].type === 'curve' ? ev[0].curve[0] : ev[0].v;
      const last = n.gain.lastValue();
      if (first === 0 && last !== 0) problems.push(`envelope de ganho não volta a zero (termina em ${last})`);
      if (first !== 0) problems.push(`envelope de ganho começa em ${first}, não em zero`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------- sem WebAudio / sem fala

test('sem WebAudio nem speechSynthesis: API completa e tudo no-op seguro', async () => {
  delete globalThis.AudioContext;
  delete globalThis.speechSynthesis;
  const Audio = loadFresh();
  assert.equal(globalThis.Truco.Audio, Audio);
  for (const fn of ['init', 'play', 'say', 'setMuted', 'setVoice', 'setVolume', 'ambient', 'status', 'render', 'analyser']) {
    assert.equal(typeof Audio[fn], 'function', fn);
  }
  assert.deepEqual(Audio.SOUNDS, ['shuffle', 'deal', 'flip', 'place', 'slide', 'bean', 'win', 'lose', 'tie', 'call', 'click', 'hover']);
  for (const name of Audio.SOUNDS) assert.equal(Audio.play(name), false);
  assert.equal(await Audio.init(), false);
  assert.equal(await Audio.init(), false);
  assert.equal(Audio.play('place'), false);
  assert.equal(await Audio.say('Truco!', { seat: 1, shout: true }), false);
  assert.doesNotThrow(() => {
    Audio.setMuted(true);
    Audio.setMuted(false);
    Audio.setVoice(false);
    Audio.setVoice(true);
    Audio.setVolume(0.5);
    Audio.ambient(true);
    Audio.ambient(false);
  });
  assert.equal(Audio.analyser(), null);
  assert.equal(await Audio.render('place'), null);
  assert.equal(Audio.status().ready, false);
});

// ---------------------------------------------------------------- com AudioContext falso

test('init() é idempotente, cria a cadeia e retoma o contexto suspenso', async () => {
  globalThis.AudioContext = MockAudioContext;
  const Audio = loadFresh();
  assert.equal(await Audio.init(), true);
  const ctx = Audio.analyser().ctx;
  assert.equal(ctx.state, 'running');
  const count = ctx.created.length;
  assert.equal(await Audio.init(), true);
  assert.equal(ctx.created.length, count + 0, 'segunda init() não recria nada');
  ctx.state = 'suspended';
  assert.equal(Audio.play('click'), false, 'suspenso: não agenda sons velhos');
  assert.equal(await Audio.init(), true);
  const comp = ctx.created.find((n) => n.kind === 'compressor');
  assert.ok(comp.threshold.value >= -20 && comp.ratio.value <= 3, 'compressor leve');
  const shaper = ctx.created.find((n) => n.kind === 'waveshaper');
  const peak = Math.max(...Array.from(shaper.curve, Math.abs));
  assert.ok(20 * Math.log10(peak) <= -1, `teto da saída em ${peak}`);
});

class MockOfflineAudioContext extends MockAudioContext {
  constructor(channels, length, sampleRate) {
    super();
    this.length = length;
    this.sampleRate = sampleRate;
    MockOfflineAudioContext.instances.push(this);
  }
  startRendering() {
    return Promise.resolve(new MockBuffer(2, this.length, this.sampleRate));
  }
}
MockOfflineAudioContext.instances = [];

test('todos os sons tocam ao vivo sem nada no passado nem fonte infinita', async () => {
  globalThis.AudioContext = MockAudioContext;
  const Audio = loadFresh();
  await Audio.init();
  const ctx = Audio.analyser().ctx;
  violations.length = 0;
  for (const name of Audio.SOUNDS) {
    for (const opts of [undefined, { pan: -0.5, gain: 0.8, delay: 0.1 }]) {
      ctx.currentTime += 1;
      const before = ctx.created.length;
      assert.equal(Audio.play(name, opts), true, name);
      const nodes = ctx.created.slice(before);
      assert.ok(nodes.some((n) => n instanceof MockSource), `${name} cria alguma fonte`);
      assert.deepEqual(auditVoiceNodes(nodes, ctx.currentTime), [], name);
    }
  }
  assert.deepEqual(violations, []);
});

test('variações aleatórias (render offline): automação sem estalos em 30 sorteios por som', async () => {
  globalThis.OfflineAudioContext = MockOfflineAudioContext;
  const Audio = loadFresh();
  violations.length = 0;
  for (const name of [...Audio.SOUNDS, 'ambient']) {
    for (let k = 0; k < (name === 'ambient' ? 3 : 30); k++) {
      MockOfflineAudioContext.instances.length = 0;
      const buf = await Audio.render(name);
      assert.ok(buf && buf.length > 0, `${name} renderiza`);
      const [ctx] = MockOfflineAudioContext.instances;
      const nodes = ctx.created.filter((n) => name !== 'ambient' || !(n instanceof MockSource && n.loop));
      assert.deepEqual(auditVoiceNodes(nodes, 0), [], `${name} #${k}`);
    }
  }
  assert.deepEqual(violations, []);
  assert.equal(await Audio.render('inexistente'), null);
  delete globalThis.OfflineAudioContext;
});

test('teto de vozes simultâneas', async () => {
  globalThis.AudioContext = MockAudioContext;
  const Audio = loadFresh();
  await Audio.init();
  const ctx = Audio.analyser().ctx;
  let accepted = 0;
  for (let k = 0; k < 100; k++) {
    ctx.currentTime += 1;
    if (Audio.play('deal')) accepted++;
  }
  assert.ok(accepted >= 24 && accepted <= 64, `aceitou ${accepted}`);
  assert.equal(Audio.status().activeVoices, accepted);
});

test('limitação por som: hover descartado, tentos simultâneos escalonados', async () => {
  globalThis.AudioContext = MockAudioContext;
  const Audio = loadFresh();
  await Audio.init();
  const ctx = Audio.analyser().ctx;
  ctx.currentTime = 5;
  assert.equal(Audio.play('hover'), true);
  assert.equal(Audio.play('hover'), false);
  const before = ctx.created.length;
  assert.equal(Audio.play('bean'), true);
  const mid = ctx.created.length;
  assert.equal(Audio.play('bean'), true);
  const firstStart = Math.min(...ctx.created.slice(before, mid).filter((n) => n instanceof MockSource).map((n) => n.startedAt));
  const secondStart = Math.min(...ctx.created.slice(mid).filter((n) => n instanceof MockSource).map((n) => n.startedAt));
  assert.ok(secondStart - firstStart >= 0.03, `segundo tento escalonado (${secondStart - firstStart}s)`);
  assert.equal(Audio.play('nada'), false);
  assert.equal(Audio.play('toString'), false);
});

test('mudo: não toca e leva o master a zero sem degrau; volume volta ao desmutar', async () => {
  globalThis.AudioContext = MockAudioContext;
  const Audio = loadFresh();
  await Audio.init();
  const ctx = Audio.analyser().ctx;
  const master = ctx.created.find((n) => n.kind === 'gain' && n.outputs.some((o) => o.kind === 'compressor'));
  Audio.setMuted(true);
  assert.equal(Audio.isMuted(), true);
  assert.equal(Audio.play('place'), false);
  const off = master.gain.events[master.gain.events.length - 1];
  assert.equal(off.type, 'target');
  assert.equal(off.v, 0);
  Audio.setMuted(false);
  ctx.currentTime += 1;
  assert.equal(Audio.play('place'), true);
  assert.ok(master.gain.lastValue() > 0.5);
});

test('ambiente: fade de entrada, fontes em loop, fade de saída e parada', async () => {
  globalThis.AudioContext = MockAudioContext;
  const Audio = loadFresh();
  Audio.ambient(true); // antes de init: só guarda a preferência
  await Audio.init();
  const ctx = Audio.analyser().ctx;
  const loops = ctx.created.filter((n) => n.kind === 'bufferSource' && n.loop);
  assert.ok(loops.length >= 4, 'camadas do burburinho em loop');
  const amb = ctx.created.find((n) => n.kind === 'gain' && n.gain.events.length && n.gain.lastValue() > 0 && n.gain.lastValue() < 0.1);
  assert.ok(amb, 'barramento do ambiente com rampa até nível baixo');
  violations.length = 0;
  Audio.ambient(false);
  assert.equal(amb.gain.lastValue(), 0);
  assert.equal(amb.gain.events[amb.gain.events.length - 1].type, 'linear');
  await new Promise((r) => setTimeout(r, 1900));
  assert.ok(loops.every((s) => s.stoppedAt !== undefined), 'fontes paradas após o fade');
  assert.deepEqual(violations, []);
});

// ---------------------------------------------------------------- fala

class MockUtterance {
  constructor(text) {
    this.text = text;
    this.lang = '';
    this.voice = null;
    this.pitch = 1;
    this.rate = 1;
    this.volume = 1;
  }
}

function mockSpeech(voices) {
  const s = {
    voices,
    spoken: [],
    cancels: 0,
    pending: false,
    speaking: false,
    paused: false,
    getVoices() { return this.voices; },
    speak(u) {
      this.spoken.push(u);
      setTimeout(() => u.onend && u.onend(), 5);
    },
    cancel() { this.cancels++; },
    resume() {},
    addEventListener() {},
  };
  globalThis.speechSynthesis = s;
  globalThis.SpeechSynthesisUtterance = MockUtterance;
  return s;
}

test('say(): sem voz em português instalada, fica em silêncio', async () => {
  delete globalThis.AudioContext;
  const s = mockSpeech([{ name: 'Samantha', lang: 'en-US', localService: true }]);
  const Audio = loadFresh();
  assert.equal(await Audio.say('Truco!'), false);
  assert.equal(s.spoken.length, 0);
});

test('say(): voz pt-BR, parâmetros por assento, grito mais rápido, caixa-alta normalizada', async () => {
  delete globalThis.AudioContext;
  const luciana = { name: 'Luciana', lang: 'pt-BR', localService: true };
  const felipe = { name: 'Felipe', lang: 'pt_BR', localService: true };
  const s = mockSpeech([{ name: 'Samantha', lang: 'en-US', localService: true }, { name: 'Joana', lang: 'pt-PT', localService: true }, luciana, felipe]);
  const Audio = loadFresh();
  assert.equal(await Audio.say('TRUCO!', { seat: 1, shout: true }), true);
  const shout = s.spoken[0];
  assert.equal(shout.text, 'Truco!');
  assert.ok([luciana, felipe].includes(shout.voice), 'escolhe voz pt-BR');
  await Audio.say('Cai dentro, marreco', { seat: 1 });
  const calm = s.spoken[1];
  assert.ok(shout.rate > calm.rate, 'grito mais rápido');
  assert.ok(shout.volume >= calm.volume, 'grito mais alto');
  await Audio.say('Vamo que vamo', { seat: 2 });
  assert.notDeepEqual([s.spoken[2].pitch, s.spoken[2].voice], [calm.pitch, calm.voice], 'assentos soam diferentes');
  s.pending = true;
  await Audio.say('Seis!', { seat: 3, shout: true });
  assert.equal(s.cancels, 1, 'fala acumulada é cancelada');
  s.pending = false;
  Audio.setVoice(false);
  assert.equal(await Audio.say('Nove!'), false);
  Audio.setVoice(true);
  Audio.setMuted(true);
  assert.equal(await Audio.say('Doze!'), false);
  Audio.setMuted(false);
  s.speak = () => { throw new Error('falhou'); };
  assert.equal(await Audio.say('Truco!'), false, 'erro do motor não vaza');
});

// ---------------------------------------------------------------- peças puras

function estimatePitch(y, sr, expected) {
  const from = Math.floor(sr * 0.05);
  const n = Math.floor(sr * 0.3);
  const seg = y.subarray(from, from + n);
  const corr = (lag) => {
    let s = 0;
    for (let i = 0; i + lag < seg.length; i++) s += seg[i] * seg[i + lag];
    return s;
  };
  const lo = Math.floor(sr / (expected * 1.1));
  const hi = Math.ceil(sr / (expected * 0.9));
  let best = lo;
  let bestVal = -Infinity;
  for (let lag = lo; lag <= hi; lag++) {
    const c = corr(lag);
    if (c > bestVal) { bestVal = c; best = lag; }
  }
  const a = corr(best - 1), b = bestVal, c = corr(best + 1);
  const shift = (a - c) / (2 * (a - 2 * b + c));
  return sr / (best + shift);
}

test('Karplus–Strong afinado (all-pass fracionário), estável e decaindo', () => {
  const { pluck } = loadFresh()._internals;
  const sr = 48000;
  for (const f of [98, 196, 440, 783.99, 1318.51]) {
    const y = pluck(sr, f, { damp: 0.14, bright: 0.85, pick: 0.13, t60: 1.2 });
    assert.ok(y.every(Number.isFinite), `${f} Hz finito`);
    const got = estimatePitch(y, sr, f);
    const errCents = 1200 * Math.log2(got / f);
    assert.ok(Math.abs(errCents) < 4, `${f} Hz: medido ${got.toFixed(2)} Hz (${errCents.toFixed(2)} cents)`);
    const rms = (a, b) => Math.sqrt(y.subarray(a, b).reduce((s, x) => s + x * x, 0) / (b - a));
    const head = rms(0, sr * 0.1);
    const tail = rms(y.length - sr * 0.1, y.length);
    assert.ok(tail < head * 0.01, `${f} Hz decai (${(20 * Math.log10(tail / head)).toFixed(1)} dB)`);
    assert.equal(Math.abs(y[y.length - 1]), 0, 'termina em zero');
  }
});

test('frases musicais: pico no alvo (nunca acima), sem NaN, começam e terminam em zero', () => {
  const { renderMusic, PHRASES } = loadFresh()._internals;
  for (const name of Object.keys(PHRASES)) {
    for (let k = 0; k < 4; k++) {
      const spec = PHRASES[name]();
      const r = renderMusic(44100, spec);
      let peak = 0;
      for (const ch of [r.L, r.R]) {
        for (const x of ch) {
          assert.ok(Number.isFinite(x), name);
          peak = Math.max(peak, Math.abs(x));
        }
        assert.equal(Math.abs(ch[0]), 0, `${name} começa em zero`);
        assert.equal(Math.abs(ch[ch.length - 1]), 0, `${name} termina em zero`);
      }
      assert.ok(peak <= spec.peak + 1e-6 && peak > spec.peak * 0.9, `${name}: pico ${peak} (alvo ${spec.peak})`);
    }
  }
});

test('teto da saída: transparente abaixo do joelho, nunca acima de −1 dBFS', () => {
  const { ceilingCurve } = loadFresh()._internals;
  const c = ceilingCurve(4097);
  assert.equal(Math.abs(c[2048]), 0);
  const limit = Math.pow(10, -1 / 20);
  for (let i = 0; i < c.length; i++) {
    const x = (i / (c.length - 1)) * 2 - 1;
    assert.ok(Math.abs(c[i]) < limit, `curva em ${x}`);
    if (Math.abs(x) <= 0.6) assert.ok(Math.abs(c[i] - x) < 1e-6, `linear em ${x}`);
    if (i > 0) assert.ok(c[i] >= c[i - 1], 'monotônica');
  }
});

test('curvas de textura e controle: limites e emendas', () => {
  const { textureCurve, controlSignal } = loadFresh()._internals;
  for (let k = 0; k < 20; k++) {
    const c = textureCurve(72, 0.2, 0.15, 0.4, 0.5);
    assert.equal(c[0], 0);
    assert.equal(c[c.length - 1], 0);
    assert.ok(c.every((x) => x >= 0 && x <= 0.2 * 1.6));
  }
  const s = controlSignal(8000, 20, 3);
  assert.ok(s.every((x) => x >= -1 && x <= 1));
  assert.ok(Math.abs(s[0] - s[s.length - 1]) < 0.02, 'loop sem degrau');
});

test('fala: texto, ranking de vozes e parâmetros por assento', () => {
  const { speechText, rankVoices, voicePool, voiceParams } = loadFresh()._internals;
  assert.equal(speechText('TRUCO!'), 'Truco!');
  assert.equal(speechText('  é   TRUCO, LADRÃO! '), 'É truco, ladrão!');
  assert.equal(speechText('Seis, marreco!'), 'Seis, marreco!');
  assert.equal(speechText(''), '');
  assert.equal(speechText(null), '');
  const ranked = rankVoices([
    { name: 'Samantha', lang: 'en-US', localService: true },
    { name: 'Joana', lang: 'pt-PT', localService: true },
    { name: 'Grandma (Portuguese (Brazil))', lang: 'pt-BR', localService: true },
    { name: 'Google português do Brasil', lang: 'pt-BR', localService: false },
    { name: 'Eddy (Portuguese (Brazil))', lang: 'pt-BR', localService: true },
    { name: 'Luciana', lang: 'pt_BR', localService: true },
  ]);
  assert.deepEqual(ranked.map((v) => v.name), [
    'Luciana', 'Google português do Brasil', 'Eddy (Portuguese (Brazil))', 'Grandma (Portuguese (Brazil))', 'Joana',
  ]);
  assert.deepEqual(voicePool(ranked).map((v) => v.name), ['Luciana'], 'assentos só com a voz boa');
  const windows = rankVoices([
    { name: 'Microsoft Maria - Portuguese (Brazil)', lang: 'pt-BR', localService: true },
    { name: 'Microsoft Daniel - Portuguese (Brazil)', lang: 'pt-BR', localService: true },
    { name: 'Microsoft Francisca Online (Natural) - Portuguese (Brazil)', lang: 'pt-BR', localService: false },
  ]);
  assert.equal(voicePool(windows).length, 2, 'duas vozes locais boas: assentos alternam');
  assert.deepEqual(voicePool(rankVoices([{ name: 'Joana', lang: 'pt-PT', localService: true }])).map((v) => v.name), ['Joana']);
  assert.deepEqual(rankVoices(undefined), []);
  assert.deepEqual(voicePool([]), []);
  const seen = new Set();
  for (let seat = 0; seat < 4; seat++) {
    const calm = voiceParams(seat, false);
    const shout = voiceParams(seat, true);
    seen.add(`${calm.pitch}/${calm.rate}`);
    assert.ok(shout.rate > calm.rate && shout.volume >= calm.volume);
    for (const p of [calm, shout]) {
      assert.ok(p.pitch >= 0.1 && p.pitch <= 2 && p.rate >= 0.5 && p.rate <= 2 && p.volume <= 1);
    }
  }
  assert.equal(seen.size, 4, 'cada assento com pitch/rate distintos');
  assert.deepEqual(voiceParams(NaN, false), voiceParams(0, false));
});

test('say(): voz da ficha do personagem ({ pitch, rate }) vale no lugar da do assento; grito ainda acelera', async () => {
  delete globalThis.AudioContext;
  const s = mockSpeech([{ name: 'Luciana', lang: 'pt-BR', localService: true }]);
  const Audio = loadFresh();
  const { voiceParams } = Audio._internals;
  assert.deepEqual(
    [voiceParams(1, false, { pitch: 1.22, rate: 1.12 }).pitch, voiceParams(1, false, { pitch: 1.22, rate: 1.12 }).rate],
    [1.22, 1.12]
  );
  const shout = voiceParams(3, true, { pitch: 0.78, rate: 0.9 });
  assert.ok(Math.abs(shout.pitch - 0.9) < 1e-9 && Math.abs(shout.rate - 0.9 * 1.18) < 1e-9);
  // Voz inválida: fica a do assento.
  assert.deepEqual(voiceParams(2, false, { pitch: 'x' }), voiceParams(2, false));
  assert.deepEqual(voiceParams(2, false, null), voiceParams(2, false));
  assert.equal(await Audio.say('Cai!', { seat: 1, voice: { pitch: 1.22, rate: 0.9 } }), true);
  assert.equal(s.spoken[0].pitch, 1.22);
  assert.equal(s.spoken[0].rate, 0.9);
});

// ---------------------------------------------------------------- áudio gravado (docs/AUDIO.md)

// HTMLAudioElement falso: play() resolve e dispara 'ended' (modo 'ok') ou 'error' com a.error (modo 'erro').
class MockMedia {
  constructor() {
    this.src = '';
    this.preload = '';
    this.volume = 1;
    this.currentTime = 0;
    this.paused = true;
    this.error = null;
    this.listeners = {};
    this.plays = 0;
    MockMedia.all.push(this);
  }
  load() {}
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
  }
  fire(type) {
    for (const fn of (this.listeners[type] || []).slice()) fn();
  }
  play() {
    this.plays++;
    this.paused = false;
    const bad = MockMedia.bad.has(this.src);
    setTimeout(() => {
      this.paused = true;
      if (bad) {
        this.error = { code: 4 };
        this.fire('error');
      } else this.fire('ended');
    }, 5);
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}
MockMedia.all = [];
MockMedia.bad = new Set();

function withMedia(fn) {
  MockMedia.all = [];
  MockMedia.bad = new Set();
  globalThis.Audio = MockMedia;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      delete globalThis.Audio;
    });
}

const MANIFEST = {
  sfx: { call: 'audio/sfx/call.mp3', bean: 'audio/sfx/bean.mp3' },
  vozes: { vini: { 'truco-1': 'audio/vozes/vini/truco-1.mp3', 'truco-2': 'audio/vozes/vini/truco-2.mp3' }, voce: { 'truco-1': 'audio/vozes/voce/truco-1.mp3' } },
};

test('manifesto: Truco.AUDIO_MANIFEST mapeia efeito e fala (personagem/momento-n) para o arquivo', () => {
  delete globalThis.AudioContext;
  const Audio = loadFresh();
  assert.equal(Audio.fileFor('sfx', 'call'), null, 'sem manifesto: nada gravado');
  assert.deepEqual(Audio.status().files, { sfx: 0, vozes: 0, played: 0, failed: 0, broken: 0, last: null });
  globalThis.Truco.AUDIO_MANIFEST = MANIFEST; // como o audio/manifest.js faz
  assert.equal(Audio.fileFor('sfx', 'call'), 'audio/sfx/call.mp3');
  assert.equal(Audio.fileFor('sfx', 'flip'), null);
  assert.equal(Audio.fileFor('vozes', 'vini/truco-2'), 'audio/vozes/vini/truco-2.mp3');
  assert.equal(Audio.fileFor('vozes', 'vini/truco-3'), null);
  assert.equal(Audio.fileFor('vozes', 'bia/truco-1'), null);
  assert.equal(Audio.fileFor('vozes', 'truco-1'), null);
  assert.equal(Audio.fileFor('vozes', '__proto__/x'), null);
  assert.equal(Audio.fileFor('sfx', 'toString'), null);
  assert.equal(Audio.status().files.sfx, 2);
  assert.equal(Audio.status().files.vozes, 3);
  // Manifesto estragado não quebra nada.
  globalThis.Truco.AUDIO_MANIFEST = { sfx: 'x', vozes: { vini: 3 } };
  assert.equal(Audio.fileFor('sfx', 'call'), null);
  assert.equal(Audio.fileFor('vozes', 'vini/truco-1'), null);
  assert.equal(Audio.status().files.vozes, 0);
});

test('say() com clip: toca o arquivo gravado (sem sintetizar); sem arquivo ou sem clip, sintetiza', async () => {
  delete globalThis.AudioContext;
  await withMedia(async () => {
    const s = mockSpeech([{ name: 'Luciana', lang: 'pt-BR', localService: true }]);
    const Audio = loadFresh();
    Audio._setManifest(MANIFEST);
    assert.equal(await Audio.say('Truco! Sobe pra main!', { seat: 2, shout: true, clip: 'vini/truco-2' }), true);
    assert.equal(s.spoken.length, 0, 'não usou o sintetizador');
    const el = MockMedia.all.find((a) => a.src === 'audio/vozes/vini/truco-2.mp3');
    assert.ok(el && el.plays === 1, 'tocou o arquivo da 2ª frase');
    assert.deepEqual(Audio.status().files.last, { kind: 'vozes', key: 'vini/truco-2', ok: true });
    assert.equal(Audio.status().files.played, 1);
    // Clip sem arquivo no manifesto e fala sem clip: sintetizador, como sempre.
    assert.equal(await Audio.say('Truco! Tá compilando?', { seat: 2, clip: 'vini/truco-3' }), true);
    assert.equal(await Audio.say('Cai!', { seat: 1 }), true);
    assert.equal(s.spoken.length, 2);
    // Voz desligada e mudo valem também para o arquivo.
    Audio.setVoice(false);
    assert.equal(await Audio.say('Truco!', { clip: 'vini/truco-1' }), false);
    Audio.setVoice(true);
    Audio.setMuted(true);
    assert.equal(await Audio.say('Truco!', { clip: 'vini/truco-1' }), false);
    Audio.setMuted(false);
    assert.equal(MockMedia.all.filter((a) => a.src === 'audio/vozes/vini/truco-1.mp3' && a.plays).length, 0);
    // Volume geral e grito: volume do elemento acompanha.
    Audio.setVolume(0.5);
    const p = Audio.say('Truco!', { clip: 'voce/truco-1', shout: true });
    const grito = MockMedia.all.find((a) => a.src === 'audio/vozes/voce/truco-1.mp3');
    assert.equal(grito.volume, 0.5);
    assert.equal(await p, true);
  });
});

test('say() com arquivo quebrado: cai no sintetizador sem travar e não tenta o arquivo de novo', async () => {
  delete globalThis.AudioContext;
  await withMedia(async () => {
    const s = mockSpeech([{ name: 'Luciana', lang: 'pt-BR', localService: true }]);
    const Audio = loadFresh();
    Audio._setManifest(MANIFEST);
    MockMedia.bad.add('audio/vozes/vini/truco-1.mp3');
    assert.equal(await Audio.say('Truco! Deploy em produção!', { seat: 2, clip: 'vini/truco-1' }), true);
    assert.equal(s.spoken.length, 1, 'falou pelo sintetizador');
    assert.equal(s.spoken[0].text, 'Truco! Deploy em produção!');
    assert.deepEqual(Audio.status().files.last, { kind: 'vozes', key: 'vini/truco-1', ok: false });
    assert.equal(Audio.status().files.broken, 1);
    const before = MockMedia.all.reduce((n, a) => n + a.plays, 0);
    assert.equal(await Audio.say('Truco! Deploy em produção!', { seat: 2, clip: 'vini/truco-1' }), true);
    assert.equal(MockMedia.all.reduce((n, a) => n + a.plays, 0), before, 'arquivo quebrado não é tocado de novo');
    assert.equal(s.spoken.length, 2);
    // Sem HTMLAudioElement (Node puro): sintetizador.
    delete globalThis.Audio;
    assert.equal(await Audio.say('Truco!', { clip: 'vini/truco-2' }), true);
    assert.equal(s.spoken.length, 3);
  });
});

test('play() com efeito gravado: toca o arquivo no lugar do sintetizado; erro de arquivo sintetiza', async () => {
  globalThis.AudioContext = MockAudioContext;
  await withMedia(async () => {
    const Audio = loadFresh();
    Audio._setManifest(MANIFEST);
    await Audio.init();
    const ctx = Audio.analyser().ctx;
    // Pré-carga dos efeitos no init (depois do gesto).
    assert.ok(MockMedia.all.some((a) => a.src === 'audio/sfx/call.mp3' && a.preload === 'auto'));
    ctx.currentTime += 1;
    let before = ctx.created.length;
    assert.equal(Audio.play('call'), true);
    assert.ok(!ctx.created.slice(before).some((n) => n instanceof MockSource), 'call gravado: nenhuma fonte sintetizada');
    assert.equal(MockMedia.all.filter((a) => a.src === 'audio/sfx/call.mp3').reduce((n, a) => n + a.plays, 0), 1);
    // Som sem arquivo continua sintetizado.
    ctx.currentTime += 1;
    before = ctx.created.length;
    assert.equal(Audio.play('flip'), true);
    assert.ok(ctx.created.slice(before).some((n) => n instanceof MockSource));
    // Tentos simultâneos: pool de elementos (sobrepõe sem cortar).
    ctx.currentTime += 1;
    Audio.play('bean');
    Audio.play('bean', { gain: 0.5 });
    await new Promise((r) => setTimeout(r, 60));
    assert.ok(MockMedia.all.filter((a) => a.src === 'audio/sfx/bean.mp3' && a.plays).length >= 1);
    // Mudo: não toca arquivo.
    Audio.setMuted(true);
    const plays = MockMedia.all.reduce((n, a) => n + a.plays, 0);
    ctx.currentTime += 1;
    assert.equal(Audio.play('call'), false);
    assert.equal(MockMedia.all.reduce((n, a) => n + a.plays, 0), plays);
    Audio.setMuted(false);
    // Arquivo quebrado: o sintetizado entra no lugar (quando o erro chega) e depois vai direto.
    MockMedia.bad.add('audio/sfx/call.mp3');
    ctx.currentTime += 1;
    before = ctx.created.length;
    assert.equal(Audio.play('call'), true);
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(ctx.created.slice(before).some((n) => n instanceof MockSource), 'fallback sintetizado');
    assert.equal(Audio.status().files.last.ok, false);
    ctx.currentTime += 1;
    before = ctx.created.length;
    assert.equal(Audio.play('call'), true);
    assert.ok(ctx.created.slice(before).some((n) => n instanceof MockSource), 'quebrado: direto no sintetizado');
    // Pré-carga das vozes do elenco.
    assert.equal(Audio.preloadVoices(['vini', 'nao-existe', 'voce']), 3);
    assert.equal(Audio.preloadVoices(['vini']), 0, 'já pré-carregadas');
  });
});

test('tools/audio-manifest.mjs: varre audio/, prefere mp3, avisa nomes errados e gera manifest.js e ROTEIRO.csv', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const vm = require('node:vm');
  const { pathToFileURL } = require('node:url');
  const M = await import(pathToFileURL(path.join(__dirname, '..', 'tools', 'audio-manifest.mjs')).href);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'truco-audio-'));
  try {
    const put = (rel, bytes) => {
      fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
      fs.writeFileSync(path.join(tmp, rel), Buffer.alloc(bytes, 1));
    };
    put('audio/sfx/call.mp3', 10);
    put('audio/sfx/call.wav', 30);
    put('audio/sfx/deal.wav', 20);
    put('audio/sfx/buzina.mp3', 5);
    put('audio/sfx/flip.mp3', 0); // vazio: ignorado
    put('audio/vozes/vini/truco-1.mp3', 7);
    put('audio/vozes/vini/truco-99.mp3', 7);
    put('audio/vozes/ninguem/truco-1.mp3', 7);
    put('audio/vozes/vini/LEIA.txt', 3);
    const sounds = ['shuffle', 'deal', 'flip', 'call'];
    const { manifest, avisos, bytes } = M.scan(tmp, { sounds, characters: { vini: new Set(['truco-1']) } });
    assert.deepEqual(manifest.sfx, { call: 'audio/sfx/call.mp3', deal: 'audio/sfx/deal.wav' });
    assert.deepEqual(manifest.vozes.vini, { 'truco-1': 'audio/vozes/vini/truco-1.mp3', 'truco-99': 'audio/vozes/vini/truco-99.mp3' });
    assert.equal(bytes, 10 + 20 + 7 + 7 + 7);
    assert.ok(avisos.some((a) => /buzina/.test(a)));
    assert.ok(avisos.some((a) => /truco-99/.test(a)));
    assert.ok(avisos.some((a) => /ninguem/.test(a)));
    // O texto gerado é um script clássico que define Truco.AUDIO_MANIFEST.
    const sandbox = {};
    vm.runInNewContext(M.manifestText(manifest), { window: sandbox });
    assert.deepEqual(JSON.parse(JSON.stringify(sandbox.Truco.AUDIO_MANIFEST)), manifest);
    const embutido = {};
    vm.runInNewContext(M.manifestText(manifest, (rel) => 'data:audio/mpeg;base64,' + rel.length), { window: embutido });
    assert.match(embutido.Truco.AUDIO_MANIFEST.sfx.call, /^data:audio\/mpeg;base64,/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  // Roteiro do jogo: todas as falas das fichas + gritos de quem joga; arquivos em dia no repositório.
  const rows = M.roteiro();
  assert.ok(rows.some((r) => r.id === 'vini' && r.arquivo === 'audio/vozes/vini/truco-1.mp3' && r.texto === 'Truco! Deploy em produção!'));
  assert.ok(rows.some((r) => r.id === 'bia' && /^audio\/vozes\/bia\//.test(r.arquivo)));
  assert.ok(rows.some((r) => r.id === 'voce' && r.arquivo === 'audio/vozes/voce/truco-1.mp3' && r.texto === 'Truco!'));
  assert.equal(new Set(rows.map((r) => r.arquivo)).size, rows.length, 'um arquivo por fala');
  const root = path.join(__dirname, '..');
  assert.equal(fs.readFileSync(path.join(root, 'audio', 'ROTEIRO.csv'), 'utf8'), M.roteiroCsv(rows), 'rode node tools/audio-manifest.mjs');
  const disk = M.scan(root, { sounds: loadFresh().SOUNDS });
  assert.equal(fs.readFileSync(path.join(root, 'audio', 'manifest.js'), 'utf8'), M.manifestText(disk.manifest), 'audio/manifest.js em dia com a pasta audio/');
  // Toda fala tem no máximo 80 letras e nenhuma linha do CSV quebra.
  assert.ok(M.roteiroCsv(rows).split('\n').length === rows.length + 2);
});
