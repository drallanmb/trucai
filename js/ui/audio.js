/*
 * TrucAÍ — Truco.Audio
 *
 * Efeitos sintetizados com WebAudio (ruído filtrado, osciladores e cordas de Karplus–Strong
 * calculadas em JS), falas por speechSynthesis em pt-BR e um ambiente de boteco paulistano opcional
 * (conversa, copos, garrafas, carro ao longe).
 *
 * Áudio gravado (docs/AUDIO.md): se Truco.AUDIO_MANIFEST (audio/manifest.js, gerado por
 * tools/audio-manifest.mjs) listar um arquivo, ele SUBSTITUI o som sintetizado:
 *   efeitos → audio/sfx/<nome>.mp3            (nome = um de SOUNDS)
 *   falas   → audio/vozes/<personagem>/<momento>-<n>.mp3   (say(texto, { clip: 'vini/truco-2' }))
 * Toca por HTMLAudioElement (funciona em file://), com pool pequeno e pré-carga; respeita mudo,
 * volume e voz desligada. Arquivo que falhar volta para o sintetizado, sem travar.
 *
 * Cadeia: vozes → sfx | ambiente | reverb de sala → master → compressor leve
 *         → teto suave (nunca passa de −1,4 dBFS) → saída.
 *
 * Tudo é no-op seguro antes de init() e em ambientes sem WebAudio/speechSynthesis
 * (inclusive Node, onde os testes carregam o módulo).
 */
(function (root) {
  'use strict';
  const Truco = (root.Truco = root.Truco || {});

  const SOUNDS = ['shuffle', 'deal', 'flip', 'place', 'slide', 'bean', 'win', 'lose', 'tie', 'call', 'click', 'hover'];

  const MASTER_GAIN = 0.9;
  const AMBIENT_LEVEL = 0.045;      // conversa ≈ −47 dBFS RMS, bem por baixo do jogo
  const LOOKAHEAD = 0.012;          // s entre o pedido e o início (evita automação "no passado")
  const MAX_VOICES = 48;
  const SILENCE = 0.001;            // −60 dB: ponto final das rampas exponenciais
  const CEILING_KNEE = 0.6;         // abaixo disto o teto é transparente (linear)
  const CEILING_MAX = Math.pow(10, -1.1 / 20);

  // Mixagem por efeito (dB), medida com render(): o "tapa" da carta e o TRUCO na frente,
  // música logo atrás, manuseio de cartas e UI mais discretos.
  const MIX_DB = {
    shuffle: 0, deal: 3, flip: 6, place: 0, slide: 0, bean: -1,
    win: 0, lose: 0, tie: -1.5, call: -2, click: -3, hover: 0,
  };

  // Intervalo mínimo entre disparos do mesmo som (s). Nos sons de "objeto" o disparo muito
  // próximo é empurrado um pouco em vez de descartado: tampinhas e cartas simultâneas soam
  // como coisas distintas, sem empilhar a mesma onda (que dobraria o volume e soaria "chapado").
  const MIN_GAP = {
    shuffle: 0.3, deal: 0.03, flip: 0.04, place: 0.04, slide: 0.05, bean: 0.035,
    win: 0.4, lose: 0.4, tie: 0.4, call: 0.25, click: 0.035, hover: 0.07,
  };
  const STAGGER = { deal: true, flip: true, place: true, slide: true, bean: true };
  const MAX_BACKLOG = 0.3;

  // O compressor do Chrome nasce "fechado" e leva ~0,3 s para abrir: render() toca o som
  // depois deste pré-rolo e o descarta, para medir o que se ouve no contexto já aquecido.
  const RENDER_PREROLL = 0.5;

  // Duração padrão (s) de render() para cada som, com folga para a cauda do reverb.
  const RENDER_SECONDS = {
    shuffle: 1.7, deal: 0.35, flip: 0.4, place: 0.5, slide: 0.6, bean: 0.6,
    win: 2.4, lose: 2.9, tie: 1.6, call: 1.5, click: 0.25, hover: 0.2, ambient: 10,
  };

  // ------------------------------------------------------------------ utilidades

  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const jitter = (value, amount) => value * (1 + (Math.random() * 2 - 1) * amount);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
  const cents = (c) => Math.pow(2, c / 1200);

  function later(fn, ms) {
    const handle = setTimeout(fn, ms);
    if (handle && typeof handle.unref === 'function') handle.unref();
    return handle;
  }

  function whenIdle(fn) {
    if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(fn, { timeout: 1500 });
    else later(fn, 40);
  }

  function settle(value) {
    if (value && typeof value.then === 'function') value.then(null, () => {});
  }

  // ------------------------------------------------------------------ envelopes

  // Percussivo sem estalo: 0 → pico (rampa linear) → exponencial até −60 dB em `t60` → 0.
  // O trecho exponencial sempre parte de um valor > 0.
  function perc(param, t, peak, attack, t60) {
    const p = Math.max(peak, 1e-5);
    const a = Math.max(attack, 0.0002);
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(p, t + a);
    param.exponentialRampToValueAtTime(p * SILENCE, t + a + t60);
    param.linearRampToValueAtTime(0, t + a + t60 + 0.005);
    return t + a + t60 + 0.005;
  }

  // Crescendo exponencial (whoosh) a partir de −60 dB, seguido do mesmo decaimento.
  function swell(param, t, peak, rise, t60) {
    const p = Math.max(peak, 1e-5);
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(p * SILENCE, t + 0.002);
    param.exponentialRampToValueAtTime(p, t + rise);
    param.exponentialRampToValueAtTime(p * SILENCE, t + rise + t60);
    param.linearRampToValueAtTime(0, t + rise + t60 + 0.005);
    return t + rise + t60 + 0.005;
  }

  // Envelope com textura (atrito, farfalhar): sobe em seno, oscila de leve, desce em cosseno.
  // Começa e termina exatamente em zero.
  function textureCurve(points, peak, attack, release, grain) {
    const curve = new Float32Array(points);
    let wobble = 1;
    for (let i = 0; i < points; i++) {
      const x = i / (points - 1);
      let shape = 1;
      if (x < attack) shape = Math.sin((x / attack) * Math.PI / 2);
      else if (x > 1 - release) shape = Math.cos(((x - (1 - release)) / release) * Math.PI / 2);
      wobble += (1 + (Math.random() * 2 - 1) * grain - wobble) * 0.6;
      curve[i] = Math.max(0, shape * wobble * peak);
    }
    curve[0] = 0;
    curve[points - 1] = 0;
    return curve;
  }

  // Teto suave da saída: linear até CEILING_KNEE, depois tangente hiperbólica que nunca
  // alcança CEILING_MAX; entradas acima de ±1 ficam presas na ponta da curva.
  function ceilingCurve(size) {
    const curve = new Float32Array(size);
    const span = CEILING_MAX - CEILING_KNEE;
    for (let i = 0; i < size; i++) {
      const x = (i / (size - 1)) * 2 - 1;
      const m = Math.abs(x);
      const y = m <= CEILING_KNEE ? m : CEILING_KNEE + span * Math.tanh((m - CEILING_KNEE) / span);
      curve[i] = x < 0 ? -y : y;
    }
    return curve;
  }

  // ------------------------------------------------------------------ buffers gerados

  function whiteNoise(ctx, seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Ruído rosa (filtro de Paul Kellet), estéreo descorrelacionado e com emenda cruzada
  // para tocar em loop sem clique na volta.
  function pinkNoise(ctx, seconds) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const fade = Math.floor(sr * 0.05);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const raw = new Float32Array(len + fade);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < raw.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
      const out = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        if (i < fade) {
          const k = i / fade;
          out[i] = raw[i] * Math.sqrt(k) + raw[len + i] * Math.sqrt(1 - k);
        } else out[i] = raw[i];
      }
    }
    return buf;
  }

  // Sinal de controle lento e periódico em [−1, 1]: nós aleatórios interpolados por cosseno
  // (ritmo de "sílabas") multiplicados por uma onda ainda mais lenta (fôlego da conversa).
  function controlSignal(length, fastKnots, slowKnots) {
    const knots = (count, lo, hi) => {
      const k = [];
      for (let i = 0; i < count; i++) k.push(rand(lo, hi));
      k.push(k[0]);
      return k;
    };
    const at = (k, u) => {
      const x = u * (k.length - 1);
      const i = Math.min(Math.floor(x), k.length - 2);
      const w = (1 - Math.cos(Math.PI * (x - i))) / 2;
      return k[i] * (1 - w) + k[i + 1] * w;
    };
    const fast = knots(Math.max(2, fastKnots), -1, 1);
    const slow = knots(Math.max(2, slowKnots), 0.3, 1);
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const u = i / length;
      out[i] = at(fast, u) * at(slow, u);
    }
    return out;
  }

  function controlBuffer(ctx, seconds, rateHz, slowHz) {
    const sr = 8000;
    const len = Math.floor(seconds * sr);
    const buf = ctx.createBuffer(1, len, sr);
    buf.getChannelData(0).set(controlSignal(len, Math.round(seconds * rateHz), Math.round(seconds * slowHz)));
    return buf;
  }

  // Resposta ao impulso de um espaço pequeno (a porta do boteco): pré-atraso, algumas reflexões
  // iniciais e cauda de ruído que escurece enquanto decai.
  function roomImpulse(ctx, seconds, rt60) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const pre = Math.floor(sr * 0.008);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / sr;
        const k = 0.6 - 0.45 * Math.min(1, t / seconds);
        lp += k * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * Math.pow(SILENCE, t / rt60) * Math.min(1, (i - pre) / (0.004 * sr));
      }
      for (let r = 0; r < 7; r++) {
        const idx = pre + Math.floor(sr * rand(0.003, 0.04));
        d[idx] += rand(-0.5, 0.5) * (1 - r / 9);
      }
      for (let i = len - Math.floor(sr * 0.02); i < len; i++) d[i] *= (len - 1 - i) / (sr * 0.02);
    }
    return buf;
  }

  const resourceCache = new WeakMap();
  function resources(ctx) {
    let r = resourceCache.get(ctx);
    if (!r) {
      const strike = ctx.createBuffer(1, STRIKE.length, ctx.sampleRate);
      strike.getChannelData(0).set(STRIKE);
      r = { white: whiteNoise(ctx, 2), ir: roomImpulse(ctx, 1.1, 0.6), strike, pink: null, control: null };
      resourceCache.set(ctx, r);
    }
    return r;
  }

  // ------------------------------------------------------------------ cadeia de saída

  function filterNode(ctx, type, freq, q) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q != null) f.Q.value = q;
    return f;
  }

  function stereoNode(ctx, pan) {
    if (typeof ctx.createStereoPanner !== 'function') return ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    return p;
  }

  function buildChain(ctx, live) {
    const master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 2;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    const ceiling = ctx.createWaveShaper();
    ceiling.curve = ceilingCurve(4097);
    ceiling.oversample = 'none';
    master.connect(comp);
    comp.connect(ceiling);
    ceiling.connect(ctx.destination);

    const sfx = ctx.createGain();
    sfx.connect(master);
    const amb = ctx.createGain();
    amb.gain.value = 0;
    amb.connect(master);
    const reverb = ctx.createConvolver();
    reverb.buffer = resources(ctx).ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.6;
    reverb.connect(wet);
    wet.connect(master);
    return { ctx, live, master, sfx, amb, reverb, output: ceiling, analyser: null };
  }

  // ------------------------------------------------------------------ voz (um disparo)

  // Agrupa os nós de um som disparado: saída própria (ganho/pan pedidos), envio de reverb e
  // limpeza automática quando o último componente termina.
  class Voice {
    constructor(chain, t, opts, trimDb) {
      const o = opts || {};
      this.ctx = chain.ctx;
      this.live = chain.live;
      this.t = t;
      this.stopAt = t;
      this.nodes = [];
      const level = (Number.isFinite(o.gain) ? Math.max(0, o.gain) : 1) * Math.pow(10, (trimDb || 0) / 20);
      const pan = Number.isFinite(o.pan) ? clamp(o.pan, -1, 1) : 0;
      this.bus = this.gain(level);
      let tail = this.bus;
      if (pan) {
        tail = this.panner(pan);
        this.bus.connect(tail);
      }
      tail.connect(o.dest || chain.sfx);
      this.fx = this.gain(level);
      this.fx.connect(chain.reverb);
    }

    track(node) {
      this.nodes.push(node);
      return node;
    }

    gain(value) {
      const g = this.ctx.createGain();
      g.gain.value = value;
      return this.track(g);
    }

    panner(pan) {
      return this.track(stereoNode(this.ctx, pan));
    }

    filter(type, freq, q) {
      return this.track(filterNode(this.ctx, type, freq, q));
    }

    noise(t, end) {
      const src = this.ctx.createBufferSource();
      const buf = resources(this.ctx).white;
      src.buffer = buf;
      src.loop = true;
      src.start(t, Math.random() * buf.duration);
      src.stop(end);
      this.until(end);
      return this.track(src);
    }

    osc(type, freq, t, end) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.start(t);
      o.stop(end);
      this.until(end);
      return this.track(o);
    }

    buffer(buf, t) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.start(t);
      this.until(t + buf.duration);
      return this.track(src);
    }

    // Liga `node` à saída da voz (ou a `dest`), com panorâmica e envio de reverb opcionais.
    out(node, pan, send, dest) {
      let tail = node;
      if (pan) {
        const p = this.panner(pan);
        tail.connect(p);
        tail = p;
      }
      tail.connect(dest || this.bus);
      if (send > 0) {
        const s = this.gain(send);
        tail.connect(s);
        s.connect(this.fx);
      }
      return node;
    }

    until(time) {
      if (time > this.stopAt) this.stopAt = time;
    }

    release(onDone) {
      if (!this.live) return;
      const ms = Math.max(0, (this.stopAt - this.ctx.currentTime) * 1000) + 250;
      later(() => {
        for (const n of this.nodes) {
          try { n.disconnect(); } catch (e) { /* já desconectado */ }
        }
        this.nodes.length = 0;
        if (onDone) onDone();
      }, ms);
    }
  }

  // ------------------------------------------------------------------ primitivas

  // Filtros em série sobre `src`. Cada um pode varrer a frequência: {type, f, q, to?, over?}
  // (rampa até `to`) ou {type, f, q, path: [[dt, freq], ...]}.
  function filterChain(v, src, filters, t, end) {
    let node = src;
    for (const f of filters) {
      const bq = v.filter(f.type, f.f, f.q);
      if (f.to || f.path) {
        bq.frequency.setValueAtTime(f.f, t);
        const path = f.path || [[f.over || end - t, f.to]];
        for (const [dt, freq] of path) bq.frequency.exponentialRampToValueAtTime(freq, t + dt);
      }
      node.connect(bq);
      node = bq;
    }
    return node;
  }

  // Rajada de ruído filtrado com envelope percussivo (ou crescendo, se `rise`).
  function noiseHit(v, o) {
    const t = o.t;
    const g = v.gain(0);
    const end = o.rise
      ? swell(g.gain, t, o.peak, o.rise, o.t60)
      : perc(g.gain, t, o.peak, o.attack || 0.001, o.t60);
    filterChain(v, v.noise(t, end + 0.01), o.filters, t, end).connect(g);
    route(v, g, o, t, end);
    return end;
  }

  // Ruído com envelope de textura (curva), para atrito, farfalhar e passagens longas.
  function noiseTexture(v, o) {
    const t = o.t;
    const end = t + o.dur;
    const g = v.gain(0);
    g.gain.setValueCurveAtTime(textureCurve(72, o.peak, o.attack, o.release, o.grain), t, o.dur);
    filterChain(v, v.noise(t, end + 0.01), o.filters, t, end).connect(g);
    route(v, g, o, t, end);
    return end;
  }

  // Oscilador com envelope percussivo e, opcionalmente, queda de altura (f → to em `over`).
  function tone(v, o) {
    const g = v.gain(0);
    const end = perc(g.gain, o.t, o.peak, o.attack || 0.001, o.t60);
    const osc = v.osc(o.type || 'sine', o.f, o.t, end + 0.01);
    if (o.to) {
      osc.frequency.setValueAtTime(o.f, o.t);
      osc.frequency.exponentialRampToValueAtTime(o.to, o.t + o.over);
    }
    osc.connect(g);
    route(v, g, o, o.t, end);
    return end;
  }

  // Síntese modal (metal, vidro, cerâmica): um pulso curto golpeia um passa-banda estreito
  // por modo, que soa sozinho até −60 dB em `t60` (Q = π·f·τ, τ = t60 / ln 1000).
  // Um impulso de área A num passa-banda de pico 0 dB soa com amplitude A·2/(sr·τ); o ganho
  // de cada modo compensa isso, e `peak` é o teto do ataque com todos os modos em fase.
  // modes = [[razão, amplitude, t60], ...]; `tone` = passa-baixa no golpe (golpe macio).
  const STRIKE = [0, 0.5, 1, 0.5, 0];
  const STRIKE_AREA = 2;

  function ring(v, o) {
    const t = o.t;
    let feed = v.buffer(resources(v.ctx).strike, t);
    if (o.tone) {
      const lp = v.filter('lowpass', o.tone, 0.7);
      feed.connect(lp);
      feed = lp;
    }
    let total = 0;
    for (const m of o.modes) total += m[1];
    const sum = v.gain(o.peak / total);
    v.out(sum, o.pan, o.send, o.dest);
    const k = v.ctx.sampleRate / (2 * STRIKE_AREA);
    let end = t;
    for (const [ratio, amp, t60] of o.modes) {
      const f = Math.min(o.f0 * ratio * jitter(1, 0.008), v.ctx.sampleRate * 0.45);
      const decay = t60 * jitter(1, 0.12);
      const tau = decay / Math.log(1000);
      const bp = v.filter('bandpass', f, Math.PI * f * tau);
      const g = v.gain(amp * rand(0.7, 1) * tau * k);
      feed.connect(bp);
      bp.connect(g);
      g.connect(sum);
      end = Math.max(end, t + decay);
    }
    v.until(end + 0.05);
    return end;
  }

  // Saída de um componente: pan fixo ou em movimento (pan → panTo), envio e destino opcionais.
  function route(v, g, o, t, end) {
    if (o.panTo === undefined) {
      v.out(g, o.pan, o.send, o.dest);
      return;
    }
    const p = v.panner(o.pan || 0);
    if (p.pan) {
      p.pan.setValueAtTime(o.pan || 0, t);
      p.pan.linearRampToValueAtTime(clamp(o.panTo, -1, 1), end);
    }
    g.connect(p);
    v.out(p, 0, o.send, o.dest);
  }

  // ------------------------------------------------------------------ materiais do boteco

  // Tampo de chapa de aço da mesa dobrável: modos inarmônicos, amortecidos pela moldura.
  const TABLE_MODES = [
    [1, 1, 0.42], [1.58, 0.85, 0.36], [2.12, 0.7, 0.3], [2.71, 0.6, 0.26],
    [3.35, 0.45, 0.2], [4.07, 0.35, 0.16], [5.2, 0.25, 0.12], [6.3, 0.15, 0.08],
  ];
  // Tampinha (tampa coroa): disco fino de aço com borda serrilhada — agudo e curto.
  const CAP_MODES = [[1, 1, 0.07], [1.46, 0.7, 0.05], [2.1, 0.45, 0.035]];
  // Copo americano (vidro grosso facetado), garrafa de 600 ml e a xicrinha de café.
  const GLASS_MODES = [[1, 1, 0.5], [2.7, 0.45, 0.3], [5.1, 0.2, 0.15]];
  const BOTTLE_MODES = [[1, 1, 0.6], [2.32, 0.5, 0.35], [4.1, 0.25, 0.18]];
  const CUP_MODES = [[1, 1, 0.42], [1.51, 0.22, 0.28], [2.83, 0.55, 0.2], [5.4, 0.25, 0.1]];
  const SPOON_MODES = [[1, 0.8, 0.12], [2.83, 1, 0.08], [5.4, 0.5, 0.05]];

  // A chapa do tampo respondendo a um toque (carta, maço, tampinha).
  function tableRing(v, t, amount, pan, dest) {
    return ring(v, { t, f0: rand(118, 142), modes: TABLE_MODES, peak: 0.4 * amount, tone: 1200, pan, send: 0.06, dest });
  }

  // Maço batido no tampo para acertar as cartas.
  function deckTap(v, t, amount) {
    noiseHit(v, { t, attack: 0.001, t60: 0.06, peak: 0.3 * amount, filters: [{ type: 'lowpass', f: 650, q: 0.8 }] });
    noiseHit(v, { t, attack: 0.0005, t60: 0.02, peak: 0.1 * amount, filters: [{ type: 'bandpass', f: 1800, q: 1 }] });
    tableRing(v, t, 0.45 * amount);
  }

  // Tampinha caindo no tampo: "tic" metálico, a chapa de leve e o chacoalhar de quem assenta
  // girando — cliques cada vez mais rápidos e mais fracos.
  function capDrop(v, t, amount, pan, dest) {
    const f0 = rand(3800, 5200);
    noiseHit(v, { t, attack: 0.0002, t60: 0.006, peak: 0.2 * amount, filters: [{ type: 'highpass', f: 3000, q: 0.7 }], pan, dest });
    ring(v, { t, f0, modes: CAP_MODES, peak: 0.28 * amount, pan, send: 0.05, dest });
    tableRing(v, t, 0.12 * amount, pan, dest);
    let at = t + rand(0.045, 0.07);
    let gap = rand(0.034, 0.046);
    let level = rand(0.35, 0.5) * amount;
    const ticks = 4 + Math.floor(Math.random() * 5);
    for (let i = 0; i < ticks; i++) {
      noiseHit(v, {
        t: at, attack: 0.0002, t60: 0.004, peak: 0.16 * level,
        filters: [{ type: 'bandpass', f: f0 * rand(0.85, 1.15), q: 2.5 }], pan, dest,
      });
      at += gap;
      gap *= rand(0.68, 0.8);
      level *= rand(0.72, 0.86);
    }
    return at;
  }

  // ------------------------------------------------------------------ cordas (Karplus–Strong)

  const INSTRUMENTS = {
    // Cavaquinho: aço, palhetada perto do cavalete, corpo pequeno e anasalado.
    cavaco: {
      damp: 0.14, bright: 0.85, pick: 0.13,
      body: [['highpass', 150, 0.7], ['peaking', 420, 1.1, 3], ['peaking', 2800, 1, 3]],
    },
    // Violão de nylon: mais escuro, com o grave do tampo (Helmholtz ~100 Hz).
    violao: {
      damp: 0.32, bright: 0.55, pick: 0.2,
      body: [['highpass', 65, 0.7], ['peaking', 105, 1.4, 4], ['peaking', 220, 1.2, 2], ['lowpass', 5200, 0.7]],
    },
  };

  // Excitação da corda: ruído com brilho (passa-baixa de 1 polo), pente de posição da palheta,
  // sem DC e com entrada suave de ~0,3 ms.
  function excitation(L, bright, pick) {
    const e = new Float32Array(L);
    const k = 0.15 + 0.85 * clamp(bright, 0, 1);
    let s = 0;
    for (let i = 0; i < L; i++) {
      s += k * ((Math.random() * 2 - 1) - s);
      e[i] = s;
    }
    const P = Math.max(1, Math.round(pick * L));
    for (let i = L - 1; i >= P; i--) e[i] -= e[i - P];
    let mean = 0;
    for (let i = 0; i < L; i++) mean += e[i];
    mean /= L;
    let peak = 0;
    for (let i = 0; i < L; i++) {
      e[i] -= mean;
      peak = Math.max(peak, Math.abs(e[i]));
    }
    const ramp = Math.min(L, 16);
    for (let i = 0; i < L; i++) e[i] = (e[i] / (peak || 1)) * (i < ramp ? i / ramp : 1);
    return e;
  }

  // Karplus–Strong estendido (Jaffe & Smith): filtro de perda de dois pontos com brilho
  // ajustável, perda por período calibrada para `t60` e afinação fracionária por all-pass.
  function pluck(sr, freq, o) {
    const N = sr / freq;
    const S = clamp(o.damp, 0.02, 0.5);
    const L = Math.max(2, Math.floor(N - S - 0.1));
    const d = N - S - L;                 // atraso que falta, em [0,1; 1,1)
    const C = (1 - d) / (1 + d);
    const rho = Math.pow(SILENCE, 1 / (o.t60 * freq));
    const len = Math.max(L + 1, Math.ceil(o.t60 * sr));
    const y = new Float32Array(len);
    const exc = excitation(L, o.bright, o.pick);
    let prev = 0, apIn = 0, apOut = 0;
    for (let n = 0; n < len; n++) {
      const a = n >= L ? y[n - L] : 0;
      const lp = (1 - S) * a + S * prev;
      prev = a;
      const ap = C * lp + apIn - C * apOut;
      apIn = lp;
      apOut = ap;
      y[n] = (n < L ? exc[n] : 0) + rho * ap;
    }
    const tail = Math.min(len, Math.floor(sr * 0.005));
    for (let i = 0; i < tail; i++) y[len - 1 - i] *= i / tail;
    return y;
  }

  // Biquad RBJ aplicado in-place: [tipo, freq, Q, ganhoDb?].
  function biquad(data, sr, spec) {
    const [type, f, q, gainDb] = spec;
    const w0 = (2 * Math.PI * f) / sr;
    const cs = Math.cos(w0);
    const al = Math.sin(w0) / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'peaking') {
      const A = Math.pow(10, (gainDb || 0) / 40);
      b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A;
      a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A;
    } else if (type === 'lowpass') {
      b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2;
      a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
    } else {
      b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2;
      a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
    }
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < data.length; i++) {
      const x = data[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      data[i] = y;
    }
  }

  // Renderiza uma frase: notas por instrumento, corpo (EQ) de cada instrumento, mistura,
  // normalização para `spec.peak` e fades que deixam a primeira e a última amostra em zero.
  function renderMusic(sr, spec) {
    const len = Math.ceil(spec.dur * sr);
    const L = new Float32Array(len);
    const R = new Float32Array(len);
    const buses = {};
    for (const n of spec.notes) {
      const inst = INSTRUMENTS[n.inst];
      const bus = buses[n.inst] || (buses[n.inst] = { L: new Float32Array(len), R: new Float32Array(len) });
      const y = pluck(sr, n.f * cents(rand(-4, 4)), {
        damp: inst.damp, bright: inst.bright * (n.bright || 1), pick: inst.pick * jitter(1, 0.15), t60: n.t60,
      });
      const start = Math.floor(n.t * sr);
      if (start >= len) continue;
      const amp = n.amp * jitter(1, 0.1);
      const ang = ((clamp(n.pan || 0, -1, 1) + 1) * Math.PI) / 4;
      const gl = Math.cos(ang) * amp;
      const gr = Math.sin(ang) * amp;
      const m = Math.min(y.length, len - start);
      for (let i = 0; i < m; i++) {
        bus.L[start + i] += y[i] * gl;
        bus.R[start + i] += y[i] * gr;
      }
    }
    for (const name of Object.keys(buses)) {
      const bus = buses[name];
      for (const b of INSTRUMENTS[name].body) {
        biquad(bus.L, sr, b);
        biquad(bus.R, sr, b);
      }
      for (let i = 0; i < len; i++) {
        L[i] += bus.L[i];
        R[i] += bus.R[i];
      }
    }
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const g = spec.peak / (peak || 1);
    const fadeIn = Math.max(1, Math.floor(sr * 0.002));
    const fadeOut = Math.max(1, Math.floor(sr * 0.08));
    for (let i = 0; i < len; i++) {
      let w = g;
      if (i < fadeIn) w *= i / fadeIn;
      const rest = len - 1 - i;
      if (rest < fadeOut) w *= rest / fadeOut;
      L[i] *= w;
      R[i] *= w;
    }
    return { L, R, length: len };
  }

  // Afinação do cavaquinho (Ré-Sol-Si-Ré) e acordes na região aguda.
  const CHORDS = {
    C: [329.63, 392.0, 523.25, 659.25],
    D: [293.66, 440.0, 587.33, 739.99],
    G: [392.0, 493.88, 587.33, 783.99],
  };

  function strum(freqs, t, o) {
    const order = freqs.map((f, i) => ({ f, i }));
    if (o.dir === 'up') order.reverse();
    let at = t;
    return order.map(({ f, i }) => {
      const note = {
        t: at, f, inst: o.inst, amp: o.amp, t60: o.t60, bright: o.bright,
        pan: (i / (freqs.length - 1) - 0.5) * (o.spread == null ? 0.5 : o.spread),
      };
      at += o.gap * jitter(1, 0.25);
      return note;
    });
  }

  const PHRASES = {
    // "Tchá-ca-TCHÁ!": duas abafadas e o Sol maior aberto, com o baixo do violão.
    win() {
      const lead = pickOne([['D', 'D'], ['C', 'D']]);
      const gap = rand(0.011, 0.016);
      const hit = rand(0.16, 0.18);
      return {
        dur: 2.0, peak: 0.42, notes: [
          ...strum(CHORDS[lead[0]], 0, { dir: 'down', gap, amp: 0.75, t60: 0.16, inst: 'cavaco', bright: 0.8 }),
          ...strum(CHORDS[lead[1]], hit / 2, { dir: 'up', gap, amp: 0.55, t60: 0.14, inst: 'cavaco', bright: 0.75 }),
          ...strum(CHORDS.G, hit, { dir: 'down', gap: gap * 1.2, amp: 1, t60: 1.5, inst: 'cavaco' }),
          { t: hit, f: 98.0, inst: 'violao', amp: 0.75, t60: 1.8 },
          { t: hit + 0.018, f: 196.0, inst: 'violao', amp: 0.6, t60: 1.6 },
        ],
      };
    },
    // Lá menor descendo (Mi–Dó–Lá) e o acorde menor arrastado no violão.
    lose() {
      const gap = rand(0.15, 0.18);
      const notes = [329.63, 261.63, 220.0].map((f, i) => ({
        t: i * gap, f, inst: 'violao', amp: 0.85 - i * 0.08, t60: 0.9, pan: 0.2 - i * 0.2, bright: 0.9,
      }));
      notes.push(...strum([110.0, 164.81, 220.0, 261.63, 329.63], 3 * gap + 0.04, {
        dir: 'down', gap: rand(0.026, 0.034), amp: 0.7, t60: 1.7, inst: 'violao', bright: 0.7, spread: 0.6,
      }));
      return { dur: 2.6, peak: 0.36, notes };
    },
    // Quinta solta tocada duas vezes: nem alegre, nem triste.
    tie() {
      const gap = rand(0.2, 0.24);
      const fifth = (t, amp) => [
        { t, f: 146.83, inst: 'violao', amp, t60: 0.8, pan: -0.1 },
        { t: t + 0.012, f: 220.0, inst: 'violao', amp: amp * 0.9, t60: 0.7, pan: 0.1 },
      ];
      return { dur: 1.3, peak: 0.3, notes: [...fifth(0, 0.85), ...fifth(gap, 0.6)] };
    },
  };

  function musicBuffer(ctx, name) {
    const r = renderMusic(ctx.sampleRate, PHRASES[name]());
    const buf = ctx.createBuffer(2, r.length, ctx.sampleRate);
    buf.getChannelData(0).set(r.L);
    buf.getChannelData(1).set(r.R);
    return buf;
  }

  // Variações pré-calculadas no tempo ocioso para o contexto real: tocar não custa CPU e
  // cada uso dispara o cálculo de uma variação nova no lugar da que saiu.
  const POOL_SIZE = 3;
  let musicPool = null;

  function refillMusic(ctx, name) {
    whenIdle(() => {
      if (!musicPool || musicPool.ctx !== ctx) return;
      const list = musicPool[name];
      if (list.length < POOL_SIZE) list.push(musicBuffer(ctx, name));
    });
  }

  function warmMusic(ctx) {
    musicPool = { ctx, win: [], lose: [], tie: [] };
    for (let k = 0; k < POOL_SIZE; k++) for (const name of Object.keys(PHRASES)) refillMusic(ctx, name);
  }

  function takeMusic(ctx, name) {
    const list = musicPool && musicPool.ctx === ctx ? musicPool[name] : null;
    if (!list || !list.length) {
      if (list) refillMusic(ctx, name);
      return musicBuffer(ctx, name);
    }
    const buf = list.splice(Math.floor(Math.random() * list.length), 1)[0];
    refillMusic(ctx, name);
    return buf;
  }

  // ------------------------------------------------------------------ sons

  const SYNTHS = {
    // Riffle: ~30 estalos de papel alternando entre as metades (esquerda/direita), acelerando
    // no meio; depois a cascata que encaixa as metades e duas batidinhas no tampo.
    shuffle(v) {
      const n = 28 + Math.floor(Math.random() * 6);
      const span = rand(0.5, 0.62);
      const gaps = [];
      let total = 0;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const gap = (1.45 - 0.6 * Math.sin(Math.PI * u)) * rand(0.75, 1.25);
        gaps.push(gap);
        total += gap;
      }
      const edge = v.filter('highpass', 900, 0.7);
      v.out(edge, 0, 0.04);
      let t = v.t;
      let side = Math.random() < 0.5 ? -1 : 1;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        if (Math.random() < 0.8) side = -side;
        noiseHit(v, {
          t, attack: 0.0004, t60: rand(0.018, 0.034),
          peak: (0.5 + 0.5 * Math.sin(Math.PI * u)) * rand(0.6, 1) * 0.5,
          filters: [{ type: 'bandpass', f: rand(1900, 4300), q: rand(0.7, 1.5) }],
          pan: side * rand(0.18, 0.5), dest: edge,
        });
        if (i < n - 1) t += (gaps[i] / total) * span;
      }
      const cascade = noiseTexture(v, {
        t: t + 0.02, dur: rand(0.2, 0.26), peak: 0.1, attack: 0.15, release: 0.5, grain: 0.5,
        filters: [{ type: 'bandpass', f: 1500, to: 2800, q: 0.7 }],
      });
      let tap = cascade + rand(0.06, 0.1);
      deckTap(v, tap, 1);
      tap += rand(0.11, 0.15);
      deckTap(v, tap, 0.6);
    },

    // Carta distribuída: estalo, "fffp" descendo e o pouso no tampo de metal.
    deal(v) {
      const t = v.t;
      const s = rand(0.9, 1.12);
      const pan = rand(-0.15, 0.15);
      noiseHit(v, { t, attack: 0.0003, t60: 0.012, peak: 0.12, filters: [{ type: 'highpass', f: 3000 * s, q: 0.7 }], pan });
      noiseHit(v, {
        t: t + 0.004, attack: 0.006, t60: rand(0.06, 0.08), peak: rand(0.14, 0.2),
        filters: [{ type: 'bandpass', f: 4600 * s, to: 1500 * s, over: 0.08, q: 1.3 }], pan,
      });
      const land = t + rand(0.05, 0.075);
      noiseHit(v, { t: land, attack: 0.001, t60: 0.04, peak: rand(0.08, 0.12), filters: [{ type: 'lowpass', f: 900, q: 0.7 }], pan });
      noiseHit(v, { t: land, attack: 0.0005, t60: 0.015, peak: 0.06, filters: [{ type: 'bandpass', f: 2600 * s, q: 1.2 }], pan });
      tableRing(v, land, 0.1, pan);
    },

    // Virar carta: estalo, o ar deslocado subindo e a carta assentando.
    flip(v) {
      const t = v.t;
      const s = rand(0.92, 1.1);
      noiseHit(v, { t, attack: 0.0003, t60: 0.012, peak: 0.12, filters: [{ type: 'bandpass', f: 3600 * s, q: 1 }] });
      noiseHit(v, {
        t: t + 0.006, attack: 0.03, t60: 0.07, peak: 0.13,
        filters: [{ type: 'bandpass', f: 700 * s, to: 2400 * s, over: 0.08, q: 1.6 }], pan: rand(-0.1, 0.1),
      });
      const land = t + rand(0.08, 0.095);
      noiseHit(v, { t: land, attack: 0.001, t60: 0.035, peak: 0.1, filters: [{ type: 'lowpass', f: 1100, q: 0.7 }] });
      noiseHit(v, { t: land, attack: 0.0004, t60: 0.014, peak: 0.08, filters: [{ type: 'bandpass', f: 2800 * s, q: 1.1 }] });
      tableRing(v, land, 0.1);
    },

    // O "tapa" da carta na mesa de ferro: papel, o colchão de ar que ela empurra e um
    // "tunc" discreto da chapa.
    place(v) {
      const t = v.t;
      const s = rand(0.9, 1.1);
      const k = rand(0.85, 1);
      noiseHit(v, {
        t, attack: 0.0004, t60: 0.035, peak: 0.32 * k,
        filters: [{ type: 'bandpass', f: 1800 * s, q: 0.8 }, { type: 'highpass', f: 700 }], send: 0.05,
      });
      noiseHit(v, { t, attack: 0.0002, t60: 0.009, peak: 0.1 * k, filters: [{ type: 'highpass', f: 4500 }] });
      noiseHit(v, { t, attack: 0.001, t60: 0.05, peak: 0.28 * k, filters: [{ type: 'lowpass', f: 520 * s, q: 0.8 }] });
      tone(v, { t, f: 115 * s, to: 62 * s, over: 0.05, peak: 0.22 * k, attack: 0.0015, t60: 0.08 });
      tableRing(v, t, 0.35 * k);
    },

    // Carta deslizando no tampo pintado: chiado liso, pouco granulado, com um corpo médio.
    slide(v) {
      const t = v.t;
      const dur = rand(0.22, 0.3);
      const s = rand(0.9, 1.1);
      noiseTexture(v, {
        t, dur, peak: 0.13, attack: 0.12, release: 0.35, grain: 0.22, pan: rand(-0.15, 0.15),
        filters: [{ type: 'bandpass', f: 2600 * s, to: 1900 * s, q: 0.8 }, { type: 'lowpass', f: 7000 }],
      });
      noiseTexture(v, { t, dur, peak: 0.07, attack: 0.2, release: 0.4, grain: 0.2, filters: [{ type: 'bandpass', f: 800 * s, q: 0.9 }] });
    },

    // Tentos: uma tampinha de cerveja pousando na fileira do placar.
    bean(v) {
      capDrop(v, v.t, 1, rand(-0.35, 0.35));
    },

    win(v) {
      v.out(v.buffer(takeMusic(v.ctx, 'win'), v.t), 0, 0.18);
    },

    lose(v) {
      v.out(v.buffer(takeMusic(v.ctx, 'lose'), v.t), 0, 0.2);
    },

    tie(v) {
      v.out(v.buffer(takeMusic(v.ctx, 'tie'), v.t), 0, 0.16);
    },

    // TRUCO!: whoosh que atravessa e o murro na mesa de ferro — sub, a mão, a chapa inteira
    // soando, os pés dobráveis chacoalhando e garrafa, copos e tampinhas pulando.
    call(v) {
      const t = v.t;
      const hit = t + 0.09;
      noiseHit(v, {
        t, rise: 0.09, t60: 0.3, peak: 0.24, pan: -0.45, panTo: 0.45, send: 0.2,
        filters: [{ type: 'bandpass', f: 320, q: 0.9, path: [[0.09, 2600], [0.4, 650]] }],
      });
      tone(v, { t: hit, f: 105, to: 40, over: 0.32, peak: 0.42, attack: 0.004, t60: 0.5 });
      noiseHit(v, { t: hit, attack: 0.001, t60: 0.12, peak: 0.42, filters: [{ type: 'lowpass', f: 1300, q: 0.8 }], send: 0.3 });
      noiseHit(v, { t: hit, attack: 0.0005, t60: 0.045, peak: 0.22, filters: [{ type: 'bandpass', f: 2300, q: 0.7 }], send: 0.25 });
      ring(v, { t: hit, f0: rand(95, 115), modes: TABLE_MODES, peak: 0.65, tone: 1600, send: 0.3 });
      let at = hit + 0.012;
      const rattles = 7 + Math.floor(Math.random() * 4);
      for (let i = 0; i < rattles; i++) {
        noiseHit(v, {
          t: at, attack: 0.0002, t60: 0.012, peak: 0.07 * rand(0.5, 1) * (1 - i / (rattles + 2)),
          filters: [{ type: 'bandpass', f: rand(1800, 3600), q: 4 }], pan: rand(-0.4, 0.4),
        });
        at += rand(0.008, 0.02);
      }
      ring(v, { t: hit + rand(0.03, 0.05), f0: rand(1150, 1400), modes: BOTTLE_MODES, peak: 0.17, pan: 0.4, send: 0.3 });
      const glass = rand(1800, 2200);
      ring(v, { t: hit + rand(0.05, 0.08), f0: glass, modes: GLASS_MODES, peak: 0.12, pan: -0.35, send: 0.3 });
      ring(v, { t: hit + rand(0.1, 0.13), f0: glass * rand(0.97, 1.03), modes: GLASS_MODES, peak: 0.075, pan: -0.3, send: 0.3 });
      capDrop(v, hit + rand(0.06, 0.1), 0.5, rand(0.1, 0.5));
    },

    // UI: "tock" curto de botão.
    click(v) {
      const s = jitter(1, 0.03);
      tone(v, { t: v.t, f: 1300 * s, to: 950 * s, over: 0.02, peak: 0.07, attack: 0.0008, t60: 0.045 });
      noiseHit(v, { t: v.t, attack: 0.0002, t60: 0.006, peak: 0.05, filters: [{ type: 'highpass', f: 3500 }] });
    },

    // UI: um "tic" quase subliminar.
    hover(v) {
      tone(v, { t: v.t, f: 1900 * jitter(1, 0.03), peak: 0.018, attack: 0.002, t60: 0.03 });
    },
  };

  // ------------------------------------------------------------------ ambiente do boteco

  // Camadas de "conversa ao redor": ruído rosa em faixas de formantes, com volume e centro
  // modulados por sinais de controle independentes (sílabas + fôlego da conversa).
  const BABBLE = [
    { f: 380, q: 1.0, level: 0.5, rate: 1.0, pan: -0.45 },
    { f: 760, q: 1.2, level: 0.42, rate: 0.97, pan: 0.4 },
    { f: 1500, q: 1.5, level: 0.2, rate: 1.03, pan: 0.05 },
  ];

  // Eventos esporádicos com pesos relativos.
  const AMBIENT_EVENTS = [
    ['toast', 5], ['bottle', 4], ['crate', 3], ['opener', 3], ['coffee', 3], ['roar', 3], ['car', 3],
  ];

  // Buffers do ambiente (~30 ms para gerar): init() os prepara no tempo ocioso.
  function ambientBuffers(ctx) {
    const r = resources(ctx);
    if (!r.pink) r.pink = pinkNoise(ctx, 7);
    if (!r.control) r.control = [19, 23, 29].map((s, i) => controlBuffer(ctx, s, 3.0 + i * 0.7, 0.12 - i * 0.02));
    return r;
  }

  function startAmbient(chain) {
    const ctx = chain.ctx;
    const r = ambientBuffers(ctx);
    const t = ctx.currentTime + 0.02;
    const nodes = [];
    const sources = [];
    const make = (n) => {
      nodes.push(n);
      return n;
    };
    const source = (buffer, rate) => {
      const s = make(ctx.createBufferSource());
      s.buffer = buffer;
      s.loop = true;
      s.playbackRate.value = rate || 1;
      s.start(t, Math.random() * buffer.duration);
      sources.push(s);
      return s;
    };
    const hp = make(filterNode(ctx, 'highpass', 110, 0.7));
    const lp = make(filterNode(ctx, 'lowpass', 2600, 0.6));
    hp.connect(lp);
    lp.connect(chain.amb);
    // `boost` soma a conversa de novo por cima: a turma se anima (ou ri) por uns segundos.
    const talkBus = make(ctx.createGain());
    const boost = make(ctx.createGain());
    boost.gain.value = 0;
    talkBus.connect(hp);
    talkBus.connect(boost);
    boost.connect(hp);
    BABBLE.forEach((layer, i) => {
      const band = make(filterNode(ctx, 'bandpass', layer.f, layer.q));
      const level = make(ctx.createGain());
      level.gain.value = layer.level;
      const pan = make(stereoNode(ctx, layer.pan));
      source(r.pink, layer.rate).connect(band);
      band.connect(level);
      level.connect(pan);
      pan.connect(talkBus);
      const talk = make(ctx.createGain());
      talk.gain.value = layer.level * 0.7;
      source(r.control[i]).connect(talk);
      talk.connect(level.gain);
      const vowel = make(ctx.createGain());
      vowel.gain.value = layer.f * 0.15;
      source(r.control[(i + 1) % r.control.length]).connect(vowel);
      vowel.connect(band.frequency);
    });
    // Tom de sala: um grave abafado que dá corpo à rua e ao salão.
    const roomLp = make(filterNode(ctx, 'lowpass', 160, 0.7));
    const roomGain = make(ctx.createGain());
    roomGain.gain.value = 0.35;
    source(r.pink, 0.5).connect(roomLp);
    roomLp.connect(roomGain);
    roomGain.connect(lp);
    return { nodes, sources, boost, lastRoar: -Infinity, lastCar: -Infinity };
  }

  function stopAmbientNodes(state) {
    for (const s of state.sources) {
      try { s.stop(); } catch (e) { /* já parado */ }
    }
    for (const n of state.nodes) {
      try { n.disconnect(); } catch (e) { /* já desconectado */ }
    }
  }

  function pickAmbientEvent(state, t) {
    let total = 0;
    for (const [, w] of AMBIENT_EVENTS) total += w;
    let r = Math.random() * total;
    let kind = AMBIENT_EVENTS[0][0];
    for (const [k, w] of AMBIENT_EVENTS) {
      r -= w;
      if (r < 0) {
        kind = k;
        break;
      }
    }
    if (kind === 'roar' && t - state.lastRoar < 6) kind = 'toast';
    if (kind === 'car' && t - state.lastCar < 14) kind = 'crate';
    return kind;
  }

  // A turma da mesa ao lado se anima: a conversa cresce ~4 dB e volta.
  function roar(state, t) {
    const g = state.boost.gain;
    const lift = rand(0.45, 0.75);
    hold(g, t);
    g.linearRampToValueAtTime(lift, t + rand(0.4, 0.7));
    g.linearRampToValueAtTime(lift * rand(0.7, 1), t + rand(1.3, 2));
    g.linearRampToValueAtTime(0, t + rand(3, 3.6));
  }

  // Carro passando ao longe no asfalto molhado: ronco abafado + chiado de pneu cruzando o estéreo.
  function carPass(v, t) {
    const dur = rand(4, 6.5);
    const dir = Math.random() < 0.5 ? -1 : 1;
    const common = { t, dur, attack: 0.5, release: 0.5, pan: -0.8 * dir, panTo: 0.8 * dir };
    noiseTexture(v, Object.assign({}, common, {
      peak: 0.5, grain: 0.08, filters: [{ type: 'lowpass', f: 220, q: 0.9, path: [[dur * 0.5, 650], [dur, 240]] }],
    }));
    noiseTexture(v, Object.assign({}, common, {
      peak: 0.12, grain: 0.1, filters: [{ type: 'bandpass', f: 1800, q: 0.7, path: [[dur * 0.5, 3200], [dur, 1500]] }],
    }));
  }

  // Um evento do ambiente em `t`: copos, garrafas, abridor, cafezinho, turma animada ou carro.
  function ambientEvent(chain, state, t) {
    const kind = pickAmbientEvent(state, t);
    if (kind === 'roar') {
      state.lastRoar = t;
      roar(state, t);
      return;
    }
    if (kind === 'car') {
      state.lastCar = t;
      const car = new Voice(chain, t, { gain: rand(0.35, 0.6), dest: chain.amb });
      carPass(car, t);
      car.release();
      return;
    }
    const v = new Voice(chain, t, { pan: rand(-0.8, 0.8), gain: rand(0.3, 0.65), dest: chain.amb });
    const far = v.filter('lowpass', rand(3500, 6000), 0.7);
    v.out(far, 0, 0.6);
    if (kind === 'toast') {
      // "Tim-tim" de dois copos americanos (às vezes a mesa inteira brinda).
      const f0 = rand(1700, 2300);
      ring(v, { t, f0, modes: GLASS_MODES, peak: 0.12, dest: far });
      ring(v, { t: t + 0.002, f0: f0 * rand(1.03, 1.12), modes: GLASS_MODES, peak: 0.1, dest: far });
      if (Math.random() < 0.4) ring(v, { t: t + rand(0.12, 0.3), f0: f0 * rand(0.9, 1.1), modes: GLASS_MODES, peak: 0.075, dest: far });
    } else if (kind === 'bottle') {
      // Garrafa de 600 pousada numa mesa de ferro vizinha.
      noiseHit(v, { t, attack: 0.001, t60: 0.05, peak: 0.1, filters: [{ type: 'lowpass', f: 500 }], dest: far });
      tableRing(v, t, 0.4, 0, far);
      ring(v, { t, f0: rand(1100, 1500), modes: BOTTLE_MODES, peak: 0.09, dest: far });
    } else if (kind === 'crate') {
      // Garrafas vazias batendo no engradado.
      let at = t;
      const count = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < count; i++) {
        ring(v, { t: at, f0: rand(1000, 1600), modes: BOTTLE_MODES, peak: 0.09 * rand(0.6, 1), dest: far });
        at += rand(0.06, 0.16);
      }
    } else if (kind === 'opener') {
      // Abrindo uma cerveja: estalo do abridor, o "tsss" e a tampinha caindo no tampo.
      noiseHit(v, { t, attack: 0.0003, t60: 0.02, peak: 0.08, filters: [{ type: 'bandpass', f: 2500, q: 1.2 }], dest: far });
      noiseHit(v, { t: t + 0.01, attack: 0.006, t60: 0.4, peak: 0.06, filters: [{ type: 'bandpass', f: 5200, to: 3000, q: 0.8 }], dest: far });
      capDrop(v, t + rand(0.35, 0.6), 0.6, 0, far);
    } else {
      // A xicrinha no pires ou a colherinha mexendo o cafezinho.
      const f0 = rand(2000, 2600);
      if (Math.random() < 0.5) {
        ring(v, { t, f0, modes: CUP_MODES, peak: 0.12, dest: far });
        if (Math.random() < 0.5) ring(v, { t: t + rand(0.03, 0.06), f0: f0 * jitter(1, 0.02), modes: CUP_MODES, peak: 0.05, dest: far });
      } else {
        let at = t;
        const count = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
          ring(v, { t: at, f0: f0 * (i % 2 ? 1.06 : 1), modes: SPOON_MODES, peak: 0.07 * rand(0.6, 1), dest: far });
          at += rand(0.12, 0.17);
        }
      }
    }
    v.release();
  }

  // ------------------------------------------------------------------ fala (speechSynthesis)

  // Pitch/rate por assento: 0 = você, 1 e 3 = adversários, 2 = parceiro.
  const SEAT_VOICES = [
    { pitch: 1.0, rate: 1.04 },
    { pitch: 0.78, rate: 0.98 },
    { pitch: 1.2, rate: 1.08 },
    { pitch: 0.92, rate: 0.93 },
  ];

  // `voice` opcional ({ pitch, rate } da ficha do personagem, Personagens.voz) vale no lugar do assento.
  function voiceParams(seat, shout, voice) {
    const s = Number.isFinite(seat) ? ((Math.trunc(seat) % 4) + 4) % 4 : 0;
    const seatBase = SEAT_VOICES[s];
    const v = voice && typeof voice === 'object' ? voice : null;
    const base = {
      pitch: v && Number.isFinite(v.pitch) ? v.pitch : seatBase.pitch,
      rate: v && Number.isFinite(v.rate) ? v.rate : seatBase.rate,
    };
    return {
      pitch: clamp(base.pitch + (shout ? 0.12 : 0), 0.1, 2),
      rate: clamp(base.rate * (shout ? 1.18 : 1), 0.5, 2),
      volume: shout ? 1 : 0.85,
    };
  }

  // Vozes "Eloquence" do macOS/iOS (existem em todos os idiomas): robóticas, algumas caricatas.
  const ELOQUENCE_VOICES = /^(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/;

  // Nota de uma voz para o jogo (−Infinity = não serve): pt-BR antes de pt-PT; locais antes
  // das de rede (latência menor — o grito precisa sair junto com o letreiro); "premium" sobe.
  function voiceScore(v) {
    const lang = String((v && v.lang) || '').replace('_', '-').toLowerCase();
    if (!/^pt(-|$)/.test(lang)) return -Infinity;
    const name = String(v.name || '').toLowerCase();
    let score = lang === 'pt-br' ? 20 : 8;
    if (v.localService) score += 6;
    if (/premium|enhanced|aprimorad|melhorad|natural|neural/.test(name)) score += 3;
    if (/google/.test(name)) score += 2;
    if (ELOQUENCE_VOICES.test(name)) score -= 8;
    return score;
  }

  function rankVoices(list) {
    return (list || [])
      .filter((v) => v && voiceScore(v) > -Infinity)
      .sort((a, b) => voiceScore(b) - voiceScore(a) || String(a.name).localeCompare(String(b.name)));
  }

  // Vozes que os assentos usam: só as do mesmo nível da melhor (até 4). Com uma voz só,
  // os assentos se distinguem por pitch/velocidade.
  function voicePool(ranked) {
    if (!ranked.length) return [];
    const best = voiceScore(ranked[0]);
    return ranked.filter((v) => voiceScore(v) > best - 3).slice(0, 4);
  }

  // Palavras inteiras em caixa-alta seriam soletradas por alguns motores ("T-R-U-C-O").
  function speechText(text) {
    const s = String(text == null ? '' : text)
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\p{Lu}{2,}/gu, (w) => w.toLowerCase());
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }

  const speech = { ranked: [], pool: [], total: 0, pending: new Set(), primed: false, listening: false };

  function speechApi() {
    const s = root.speechSynthesis;
    return s && typeof s.speak === 'function' && typeof root.SpeechSynthesisUtterance === 'function' ? s : null;
  }

  function refreshVoices() {
    const s = speechApi();
    if (!s) return;
    try {
      const all = s.getVoices() || [];
      speech.total = all.length;
      speech.ranked = rankVoices(all);
    } catch (e) {
      speech.ranked = [];
    }
    speech.pool = voicePool(speech.ranked);
    if (!speech.listening && typeof s.addEventListener === 'function') {
      speech.listening = true;
      s.addEventListener('voiceschanged', refreshVoices);
    }
  }

  function cancelSpeech() {
    const s = speechApi();
    if (!s) return;
    try { s.cancel(); } catch (e) { /* sem fala em andamento */ }
  }

  // No iOS a primeira fala precisa nascer de um gesto: init() fala um espaço em silêncio.
  function primeSpeech() {
    const s = speechApi();
    if (!s || speech.primed || !voiceOn) return;
    speech.primed = true;
    try {
      const u = new root.SpeechSynthesisUtterance(' ');
      u.volume = 0;
      s.speak(u);
    } catch (e) { /* ignora */ }
  }

  // ------------------------------------------------------------------ áudio gravado (docs/AUDIO.md)

  const FILE_POOL = 3;         // elementos por efeito (sons que se sobrepõem, como cartas e tampinhas)
  const VOICE_GUARD_MS = 20000; // nenhuma fala gravada segura a promessa mais que isto
  const files = {
    pools: new Map(),      // src → [HTMLAudioElement]
    broken: new Set(),     // src que deu erro de arquivo: não tenta de novo, usa o sintetizado
    playing: new Set(),
    voice: null,           // fala gravada tocando agora: { el, stop }
    played: 0,
    failed: 0,
    last: null,            // { kind: 'sfx'|'vozes', key, ok }
    override: undefined,   // manifesto trocado pelos testes (_setManifest)
  };

  function manifest() {
    const m = files.override !== undefined ? files.override : Truco.AUDIO_MANIFEST;
    return m && typeof m === 'object' ? m : null;
  }

  /** Caminho (ou data: URI) do arquivo: fileFor('sfx', 'call'); fileFor('vozes', 'vini/truco-2'). */
  function fileFor(kind, key) {
    const m = manifest();
    if (!m || typeof key !== 'string' || !key) return null;
    let src = null;
    if (kind === 'sfx') src = m.sfx && Object.prototype.hasOwnProperty.call(m.sfx, key) ? m.sfx[key] : null;
    else {
      const i = key.indexOf('/');
      if (i <= 0) return null;
      const who = m.vozes && Object.prototype.hasOwnProperty.call(m.vozes, key.slice(0, i)) ? m.vozes[key.slice(0, i)] : null;
      src = who && typeof who === 'object' && Object.prototype.hasOwnProperty.call(who, key.slice(i + 1)) ? who[key.slice(i + 1)] : null;
    }
    return typeof src === 'string' && src ? src : null;
  }

  function mediaApi() {
    const A = root.Audio; // HTMLAudioElement (não confundir com Truco.Audio)
    return typeof A === 'function' ? A : null;
  }

  function newElement(src) {
    const A = mediaApi();
    if (!A) return null;
    try {
      const a = new A();
      a.preload = 'auto';
      a.src = src;
      if (typeof a.load === 'function') a.load();
      return a;
    } catch (e) {
      return null;
    }
  }

  // Um elemento livre do pool do arquivo (cria até `size`; cheio, reaproveita o mais antigo).
  function element(src, size) {
    let pool = files.pools.get(src);
    if (!pool) {
      pool = [];
      files.pools.set(src, pool);
    }
    let a = pool.find((e) => !files.playing.has(e));
    if (!a && pool.length < size) {
      a = newElement(src);
      if (!a) return null;
      pool.push(a);
    }
    if (!a) {
      a = pool.shift();
      pool.push(a);
      stopElement(a);
    }
    return a;
  }

  function stopElement(a) {
    files.playing.delete(a);
    try {
      a.pause();
      a.currentTime = 0;
    } catch (e) { /* ignora */ }
    if (typeof a.__trucoStop === 'function') a.__trucoStop();
  }

  function notifyFile(kind, key, ok) {
    files.last = { kind, key, ok };
    if (ok) files.played++;
    else files.failed++;
    try {
      if (typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') {
        root.dispatchEvent(new root.CustomEvent('truco:audio-arquivo', { detail: { kind, key, ok } }));
      }
    } catch (e) { /* ignora */ }
  }

  /**
   * Toca `a` do começo. cb: { started, ended, failed(broken) }. Uma falha de arquivo (a.error) marca o
   * src como quebrado; recusa de autoplay só vale para esta vez.
   */
  function startElement(a, src, base, cb) {
    let done = false;
    const off = () => {
      a.__trucoStop = null;
      if (typeof a.removeEventListener === 'function') {
        a.removeEventListener('ended', onEnded);
        a.removeEventListener('error', onError);
      }
    };
    const onEnded = () => {
      if (done) return;
      done = true;
      off();
      files.playing.delete(a);
      if (cb.ended) cb.ended();
    };
    const onError = () => {
      if (done) return;
      done = true;
      off();
      files.playing.delete(a);
      const broken = !!a.error || !mediaApi();
      if (broken) files.broken.add(src);
      if (cb.failed) cb.failed(broken);
    };
    if (typeof a.addEventListener === 'function') {
      a.addEventListener('ended', onEnded);
      a.addEventListener('error', onError);
    }
    // Parada por fora (mudo, outra fala, aba escondida): conta como fim.
    a.__trucoStop = () => {
      if (done) return;
      done = true;
      off();
      if (cb.ended) cb.ended(true);
    };
    a.__trucoBase = base;
    try {
      a.volume = clamp(base * volume, 0, 1);
      if (a.currentTime) a.currentTime = 0;
    } catch (e) { /* ignora */ }
    files.playing.add(a);
    let p;
    try {
      p = a.play();
    } catch (e) {
      onError();
      return;
    }
    if (p && typeof p.then === 'function') {
      p.then(() => {
        if (!done && cb.started) cb.started();
      }, onError);
    } else if (cb.started) cb.started();
  }

  // Efeito gravado. Devolve false se não houver arquivo (o chamador sintetiza); erro depois do
  // disparo sintetiza no lugar, sem repetir o arquivo quebrado.
  function playFileSfx(name, o, delay) {
    const src = fileFor('sfx', name);
    if (!src || files.broken.has(src) || !mediaApi()) return false;
    const base = clamp(Number.isFinite(o.gain) ? Math.max(0, o.gain) : 1, 0, 1);
    const go = () => {
      if (muted) return;
      const a = element(src, FILE_POOL);
      if (!a) {
        playSound(name, { gain: o.gain, pan: o.pan }, true);
        return;
      }
      startElement(a, src, base, {
        started: () => notifyFile('sfx', name, true),
        failed: () => {
          notifyFile('sfx', name, false);
          if (!muted) playSound(name, { gain: o.gain, pan: o.pan }, true);
        },
      });
    };
    if (delay > 0.02) later(go, delay * 1000);
    else go();
    return true;
  }

  function stopVoiceFile() {
    const v = files.voice;
    files.voice = null;
    if (v) stopElement(v.el);
  }

  function stopFiles() {
    stopVoiceFile();
    for (const a of Array.from(files.playing)) stopElement(a);
  }

  // Fala gravada: resolve true quando termina; se o arquivo falhar, fala com o sintetizador.
  function sayFile(src, o, clean) {
    const a = element(src, 1);
    if (!a) return speakSynth(clean, o);
    stopVoiceFile();
    if (o.shout) cancelSpeech();
    return new Promise((resolve) => {
      let settled = false;
      let timer = 0;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (files.voice && files.voice.el === a) files.voice = null;
        resolve(ok);
      };
      files.voice = { el: a };
      timer = later(() => {
        stopElement(a);
        finish(false);
      }, VOICE_GUARD_MS);
      const base = o.shout ? 1 : 0.9;
      startElement(a, src, base, {
        started: () => notifyFile('vozes', o.clip, true),
        ended: (stopped) => finish(!stopped),
        failed: () => {
          notifyFile('vozes', o.clip, false);
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (files.voice && files.voice.el === a) files.voice = null;
          resolve(speakSynth(clean, o));
        },
      });
    });
  }

  /** Pré-carrega os efeitos gravados (chamado no init, depois do gesto). */
  function preloadSfx() {
    const m = manifest();
    if (!m || !m.sfx || !mediaApi()) return 0;
    let n = 0;
    for (const name of SOUNDS) {
      const src = fileFor('sfx', name);
      if (src && !files.pools.has(src)) {
        element(src, FILE_POOL);
        n++;
      }
    }
    return n;
  }

  /** Pré-carrega as falas gravadas dos personagens (ids) que vão sentar à mesa. */
  function preloadVoices(ids) {
    const m = manifest();
    if (!m || !m.vozes || !mediaApi() || !Array.isArray(ids)) return 0;
    let n = 0;
    for (const id of ids) {
      const who = typeof id === 'string' && Object.prototype.hasOwnProperty.call(m.vozes, id) ? m.vozes[id] : null;
      if (!who || typeof who !== 'object') continue;
      for (const key of Object.keys(who)) {
        const src = fileFor('vozes', id + '/' + key);
        if (src && !files.pools.has(src)) {
          element(src, 1);
          n++;
        }
      }
    }
    return n;
  }

  function fileStatus() {
    const m = manifest();
    let vozes = 0;
    if (m && m.vozes && typeof m.vozes === 'object') {
      for (const id of Object.keys(m.vozes)) vozes += m.vozes[id] && typeof m.vozes[id] === 'object' ? Object.keys(m.vozes[id]).length : 0;
    }
    return {
      sfx: m && m.sfx && typeof m.sfx === 'object' ? Object.keys(m.sfx).length : 0,
      vozes,
      played: files.played,
      failed: files.failed,
      broken: files.broken.size,
      last: files.last ? Object.assign({}, files.last) : null,
    };
  }

  // ------------------------------------------------------------------ estado e API

  let live = null;
  let muted = false;
  let voiceOn = true;
  let ambientOn = false;
  let volume = 1;
  let activeVoices = 0;
  const lastStart = {};
  let ambientState = null;
  let eventTimer = 0;
  let ambientStopTimer = 0;
  let lifecycleReady = false;
  let pausedByVisibility = false;

  function hold(param, now) {
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(now);
    } else {
      const current = param.value;
      param.cancelScheduledValues(now);
      param.setValueAtTime(current, now);
    }
  }

  function applyMaster() {
    if (!live) return;
    const param = live.master.gain;
    const now = live.ctx.currentTime;
    hold(param, now);
    param.setTargetAtTime(muted ? 0 : MASTER_GAIN * volume, now, 0.03);
  }

  function resume() {
    const ctx = live && live.ctx;
    if (!ctx || ctx.state === 'closed') return Promise.resolve(false);
    if (ctx.state === 'running') return Promise.resolve(true);
    let pending;
    try {
      pending = Promise.resolve(ctx.resume()).catch(() => {});
    } catch (e) {
      return Promise.resolve(false);
    }
    // resume() pode ficar pendente até um gesto do usuário: quem aguarda init() não trava.
    const timeout = new Promise((res) => later(res, 500));
    return Promise.race([pending, timeout]).then(() => ctx.state === 'running');
  }

  function installLifecycle() {
    if (lifecycleReady || typeof root.addEventListener !== 'function') return;
    lifecycleReady = true;
    const doc = root.document;
    const unlock = () => {
      if (live && live.ctx.state !== 'running' && !(doc && doc.hidden)) resume();
    };
    for (const type of ['pointerdown', 'keydown', 'touchend']) {
      root.addEventListener(type, unlock, { capture: true, passive: true });
    }
    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('visibilitychange', () => {
        if (!live) return;
        if (doc.hidden) {
          cancelSpeech();
          stopFiles(true);
          if (live.ctx.state === 'running') {
            pausedByVisibility = true;
            try { settle(live.ctx.suspend()); } catch (e) { /* ignora */ }
          }
        } else if (pausedByVisibility) {
          pausedByVisibility = false;
          resume();
        }
      });
    }
  }

  /** Cria (uma vez) o AudioContext e retoma se estiver suspenso. Chamar num gesto do usuário. */
  function init() {
    if (!live) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return Promise.resolve(false);
      let ctx = null;
      try {
        ctx = new AC({ latencyHint: 'interactive' });
      } catch (e) {
        try { ctx = new AC(); } catch (e2) { return Promise.resolve(false); }
      }
      try {
        live = buildChain(ctx, true);
      } catch (e) {
        try { settle(ctx.close()); } catch (e3) { /* ignora */ }
        live = null;
        return Promise.resolve(false);
      }
      live.master.gain.value = muted ? 0 : MASTER_GAIN * volume;
      installLifecycle();
      warmMusic(ctx);
      if (ambientOn) ambient(true);
      else whenIdle(() => ambientBuffers(ctx));
      refreshVoices();
      primeSpeech();
      preloadSfx();
    }
    return resume();
  }

  /** Dispara um efeito. opts: { gain?: multiplicador, pan?: −1..1, delay?: s }. Arquivo gravado tem prioridade. */
  function play(name, opts) {
    return playSound(name, opts, false);
  }

  // `fallback`: o arquivo gravado falhou e o sintetizado entra no lugar (sem o intervalo mínimo de novo).
  function playSound(name, opts, fallback) {
    const synth = Object.prototype.hasOwnProperty.call(SYNTHS, name) ? SYNTHS[name] : null;
    if (!synth || !live || muted) return false;
    const ctx = live.ctx;
    if (ctx.state !== 'running') {
      resume();
      return false;
    }
    if (activeVoices >= MAX_VOICES) return false;
    const o = opts || {};
    const now = ctx.currentTime;
    let t = now + LOOKAHEAD + (Number.isFinite(o.delay) ? clamp(o.delay, 0, 10) : 0);
    if (!fallback) {
      const gap = MIN_GAP[name];
      const last = lastStart[name];
      if (last !== undefined && Math.abs(t - last) < gap) {
        if (!STAGGER[name] || last + gap - now > MAX_BACKLOG) return false;
        t = last + gap * rand(1, 1.4);
      }
      lastStart[name] = t;
      if (playFileSfx(name, o, t - now)) return true;
    }
    let v = null;
    try {
      v = new Voice(live, t, { gain: o.gain, pan: o.pan }, MIX_DB[name]);
      synth(v);
    } catch (e) {
      if (v) v.release();
      return false;
    }
    activeVoices++;
    v.release(() => { activeVoices--; });
    return true;
  }

  /** Fala `text` em pt-BR. Resolve true quando termina; false se não falou. Nunca lança. */
  function say(text, opts) {
    const o = opts || {};
    if (!voiceOn || muted) return Promise.resolve(false);
    const clean = speechText(text);
    if (!clean) return Promise.resolve(false);
    // Fala gravada (opts.clip = '<personagem>/<momento>-<n>'): toca o arquivo; se falhar, sintetiza.
    const src = typeof o.clip === 'string' ? fileFor('vozes', o.clip) : null;
    if (src && !files.broken.has(src) && mediaApi()) return sayFile(src, o, clean);
    return speakSynth(clean, o);
  }

  function speakSynth(clean, o) {
    const s = speechApi();
    if (!s || !voiceOn || muted) return Promise.resolve(false);
    if (!speech.ranked.length) refreshVoices();
    // Há vozes instaladas, mas nenhuma em português: melhor calar do que ler "trúcou" em inglês.
    if (speech.total > 0 && !speech.ranked.length) return Promise.resolve(false);
    const seat = Number.isFinite(o.seat) ? o.seat : 0;
    const p = voiceParams(seat, !!o.shout, o.voice);
    const voices = speech.pool;
    const voice = voices.length ? voices[((Math.trunc(seat) % voices.length) + voices.length) % voices.length] : null;
    let u;
    try {
      u = new root.SpeechSynthesisUtterance(clean);
      u.lang = voice ? voice.lang : 'pt-BR';
      if (voice) u.voice = voice;
      u.pitch = p.pitch;
      u.rate = p.rate;
      u.volume = clamp(p.volume * volume, 0, 1);
    } catch (e) {
      return Promise.resolve(false);
    }
    // Fila curta: se já há fala esperando (ou se é um grito), a anterior perde a vez.
    let interrupted = false;
    try {
      if (s.pending || (s.speaking && o.shout)) {
        s.cancel();
        interrupted = true;
      }
    } catch (e) { /* ignora */ }
    return new Promise((resolve) => {
      let done = false;
      let timer = 0;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        speech.pending.delete(u);
        resolve(ok);
      };
      u.onend = () => finish(true);
      u.onerror = () => finish(false);
      timer = later(() => finish(false), 1500 + clean.length * 120);
      speech.pending.add(u); // referência forte: sem ela o Chrome pode coletar e não emitir 'end'
      const speak = () => {
        if (done) return;
        try {
          if (s.paused) s.resume();
          s.speak(u);
        } catch (e) {
          finish(false);
        }
      };
      // Safari às vezes ignora um speak() colado num cancel().
      if (interrupted) later(speak, 60);
      else speak();
    });
  }

  function setMuted(value) {
    muted = !!value;
    if (muted) {
      cancelSpeech();
      stopFiles(true);
    }
    applyMaster();
  }

  function setVoice(value) {
    voiceOn = !!value;
    if (!voiceOn) {
      cancelSpeech();
      stopVoiceFile();
    }
  }

  /** Volume geral 0..1 (efeitos, ambiente e fala). */
  function setVolume(value) {
    volume = clamp(Number(value) || 0, 0, 1);
    applyMaster();
    for (const a of files.playing) {
      try { a.volume = clamp((a.__trucoBase || 1) * volume, 0, 1); } catch (e) { /* ignora */ }
    }
  }

  function scheduleAmbientEvent() {
    eventTimer = later(() => {
      eventTimer = 0;
      if (!ambientOn || !ambientState || !live) return;
      if (!muted && live.ctx.state === 'running') ambientEvent(live, ambientState, live.ctx.currentTime + 0.05);
      scheduleAmbientEvent();
    }, rand(2500, 7000));
  }

  /** Liga/desliga o burburinho do boteco (com fade). Antes de init() só guarda a preferência. */
  function ambient(on) {
    ambientOn = !!on;
    if (!live) return;
    const param = live.amb.gain;
    const now = live.ctx.currentTime;
    if (ambientOn) {
      clearTimeout(ambientStopTimer);
      if (!ambientState) ambientState = startAmbient(live);
      hold(param, now);
      param.linearRampToValueAtTime(AMBIENT_LEVEL, now + 2.5);
      if (!eventTimer) scheduleAmbientEvent();
    } else if (ambientState) {
      hold(param, now);
      param.linearRampToValueAtTime(0, now + 1.5);
      clearTimeout(eventTimer);
      eventTimer = 0;
      clearTimeout(ambientStopTimer);
      ambientStopTimer = later(() => {
        if (ambientOn || !ambientState) return;
        stopAmbientNodes(ambientState);
        ambientState = null;
      }, 1800);
    }
  }

  function isMuted() {
    return muted;
  }

  function status() {
    return {
      supported: !!(root.AudioContext || root.webkitAudioContext),
      ready: !!live,
      state: live ? live.ctx.state : 'none',
      muted,
      voice: voiceOn,
      ambient: ambientOn,
      volume,
      activeVoices,
      speech: !!speechApi(),
      voices: speech.ranked.map((v) => v.name + ' (' + v.lang + ')'),
      voicesInUse: speech.pool.map((v) => v.name + ' (' + v.lang + ')'),
      files: fileStatus(),
    };
  }

  /** AnalyserNode na saída final (medidores); null antes de init(). */
  function analyser() {
    if (!live) return null;
    if (!live.analyser) {
      const a = live.ctx.createAnalyser();
      a.fftSize = 2048;
      live.output.connect(a);
      live.analyser = a;
    }
    return live.analyser;
  }

  /**
   * Renderiza um som (ou 'ambient') offline pela mesma cadeia de saída, sem tocar nada.
   * Serve para medir níveis e desenhar formas de onda. Resolve AudioBuffer ou null.
   */
  function render(name, opts) {
    const OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    const isAmbient = name === 'ambient';
    if (!OAC || (!isAmbient && !Object.prototype.hasOwnProperty.call(SYNTHS, name))) return Promise.resolve(null);
    const o = opts || {};
    const sr = o.sampleRate || 48000;
    const seconds = o.duration || RENDER_SECONDS[name];
    let ctx;
    try {
      ctx = new OAC(2, Math.ceil(sr * (seconds + RENDER_PREROLL)), sr);
    } catch (e) {
      return Promise.resolve(null);
    }
    try {
      const chain = buildChain(ctx, false);
      if (isAmbient) {
        chain.amb.gain.value = AMBIENT_LEVEL;
        const state = startAmbient(chain);
        for (let t = RENDER_PREROLL + rand(0.5, 1.2); t < RENDER_PREROLL + seconds - 1; t += rand(1.6, 2.8)) ambientEvent(chain, state, t);
      } else {
        SYNTHS[name](new Voice(chain, RENDER_PREROLL, { gain: o.gain, pan: o.pan }, MIX_DB[name]));
      }
    } catch (e) {
      return Promise.resolve(null);
    }
    const trim = (full) => {
      if (!full) return null;
      const from = Math.floor(RENDER_PREROLL * sr);
      const out = ctx.createBuffer(full.numberOfChannels, full.length - from, sr);
      for (let ch = 0; ch < full.numberOfChannels; ch++) out.getChannelData(ch).set(full.getChannelData(ch).subarray(from));
      return out;
    };
    return new Promise((resolve) => {
      let settled = false;
      const done = (buf) => {
        if (settled) return;
        settled = true;
        resolve(trim(buf));
      };
      ctx.oncomplete = (e) => done(e.renderedBuffer);
      const p = ctx.startRendering();
      if (p && typeof p.then === 'function') p.then(done, () => done(null));
    });
  }

  refreshVoices();

  const AudioApi = {
    SOUNDS,
    init,
    play,
    say,
    setMuted,
    setVoice,
    setVolume,
    ambient,
    isMuted,
    status,
    analyser,
    render,
    preloadVoices,
    fileFor,
    // Peças puras expostas para os testes (tests/audio.test.js).
    _internals: { pluck, renderMusic, rankVoices, voicePool, speechText, voiceParams, ceilingCurve, controlSignal, textureCurve, PHRASES },
    // Só para os testes: troca o manifesto (undefined volta a ler Truco.AUDIO_MANIFEST) e zera os arquivos.
    _setManifest(m) {
      stopFiles();
      files.override = m;
      files.pools.clear();
      files.broken.clear();
      files.played = 0;
      files.failed = 0;
      files.last = null;
    },
  };

  Truco.Audio = AudioApi;
  if (typeof module === 'object' && module.exports) module.exports = AudioApi;
})(typeof window !== 'undefined' ? window : globalThis);
