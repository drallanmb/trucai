/*
 * TrucAÍ — Truco.Tween: interpolação numérica com promessas, dirigida pelo laço da cena.
 *
 *   Tween.to(target, { x: 1, y: 2 }, { duration, ease, delay, onUpdate }) -> Promise
 *   Tween.run(duration, fn(e, t), { ease, delay }) -> Promise   // fn recebe o valor suavizado e o bruto (0..1)
 *   Tween.delay(seconds) -> Promise
 *   Tween.update(dt)            // dt em segundos (tempo real); multiplicado por Tween.speed
 *   Tween.kill(target, { complete }) / Tween.killAll({ complete })
 *   Tween.ease.*               // funções de suavização
 *   Tween.speed                // multiplicador global (1 = normal)
 *   Tween.reducedMotion        // null = segue prefers-reduced-motion; true/false força
 *
 * Durações em SEGUNDOS. Toda promessa resolve (nunca rejeita): ao terminar, ao ser
 * substituída por outro tween nas mesmas propriedades ou ao ser cancelada com kill.
 *
 * Também define Truco.GfxUtil (= Tween.util), utilidades comuns de js/gfx lidas no uso:
 *   GfxUtil.report(err, where)            // Truco.reportError(err, where) se existir; senão console.error
 *   GfxUtil.fontsReady(fonts)             // true se a família de cada fonte CSS está declarada E carregada
 *   GfxUtil.onFonts(fonts, redraw, alive) // redesenha quando alguma dessas famílias terminar de carregar
 */
(function (root) {
  'use strict';
  const Truco = (root.Truco = root.Truco || {});

  const PI = Math.PI;

  function outBounce(t) {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }

  const ease = {
    linear: (t) => t,
    inQuad: (t) => t * t,
    outQuad: (t) => t * (2 - t),
    inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
    inCubic: (t) => t * t * t,
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outQuart: (t) => 1 - Math.pow(1 - t, 4),
    inOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
    inSine: (t) => 1 - Math.cos((t * PI) / 2),
    outSine: (t) => Math.sin((t * PI) / 2),
    inOutSine: (t) => -(Math.cos(PI * t) - 1) / 2,
    inBack: (t) => {
      const c1 = 1.70158;
      return (c1 + 1) * t * t * t - c1 * t * t;
    },
    outBack: (t) => {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
    outElastic: (t) => {
      if (t === 0 || t === 1) return t;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * PI) / 3)) + 1;
    },
    outBounce,
  };

  const active = [];
  let reducedQuery = null;

  // ---------------------------------------------------------------------------
  // Utilidades comuns da cena: relator de erros e espera de fontes.
  // ---------------------------------------------------------------------------

  /** Erro interno da cena: vai para Truco.reportError (→ __truco.errors) quando existe. */
  function report(err, where) {
    const T = root.Truco;
    try {
      if (T && typeof T.reportError === 'function') {
        T.reportError(err, where);
        return;
      }
    } catch (e) {
      // o relator do jogo falhou: cai no console
    }
    if (root.console && root.console.error) root.console.error(where || 'Truco.gfx', err);
  }

  /** Primeira família de uma fonte CSS ('700 40px "Barlow Condensed", Arial' → 'Barlow Condensed'). */
  function familyOf(font) {
    const m = String(font || '').match(/(?:^|\s)(?:\d+px|\d*\.?\d+(?:em|rem|pt))(?:\/\S+)?\s+(.+)$/);
    const list = (m ? m[1] : String(font || '')).split(',');
    return list[0].trim().replace(/^["']|["']$/g, '');
  }

  function fontSet() {
    return typeof document !== 'undefined' && document.fonts && typeof document.fonts.forEach === 'function' ? document.fonts : null;
  }

  /** Famílias com alguma FontFace declarada E carregada (document.fonts.check devolve true sem nenhuma declarada). */
  function loadedFamilies() {
    const out = new Set();
    const fs = fontSet();
    if (!fs) return out;
    try {
      fs.forEach((face) => {
        if (face.status === 'loaded') out.add(String(face.family).replace(/["']/g, '').trim());
      });
    } catch (e) {
      // sem acesso às faces: trata como nenhuma carregada
    }
    return out;
  }

  /** true quando não há o que esperar (sem document.fonts) ou todas as famílias pedidas já carregaram. */
  function fontsReady(fonts) {
    if (!fontSet()) return true;
    const loaded = loadedFamilies();
    return (fonts || []).every((f) => loaded.has(familyOf(f)));
  }

  const fontWaiters = [];
  let fontListening = false;

  function pumpFonts() {
    const loaded = loadedFamilies();
    for (let i = fontWaiters.length - 1; i >= 0; i--) {
      const w = fontWaiters[i];
      if (w.alive && !w.alive()) {
        fontWaiters.splice(i, 1);
        continue;
      }
      const got = w.families.filter((f) => loaded.has(f));
      if (got.length > w.have) {
        w.have = got.length;
        // Falha do próprio redesenho é bug: vai para o relator (não é "fonte indisponível").
        try {
          w.redraw();
        } catch (e) {
          report(e, 'redesenho');
        }
      }
      if (w.have >= w.families.length) fontWaiters.splice(i, 1);
    }
  }

  /**
   * Chama redraw() quando alguma das famílias de `fonts` terminar de carregar (e de novo a cada
   * família nova, até todas). Se as fontes nunca chegarem, nada acontece (ficam as de reserva).
   * alive(): opcional; devolve false quando o dono foi descartado. Devolve true se ficou esperando.
   */
  function onFonts(fonts, redraw, alive) {
    const fs = fontSet();
    if (!fs || typeof redraw !== 'function') return false;
    const families = Array.from(new Set((fonts || []).map(familyOf)));
    const loaded = loadedFamilies();
    const have = families.filter((f) => loaded.has(f)).length;
    if (have >= families.length) return false;
    fontWaiters.push({ families, have, redraw, alive });
    if (!fontListening && typeof fs.addEventListener === 'function') {
      fontListening = true;
      fs.addEventListener('loadingdone', pumpFonts);
    }
    // Pede o carregamento (se o CSS já declarou as faces); a falha da fonte em si é ignorada.
    if (typeof fs.load === 'function') {
      for (const f of fonts || []) {
        try {
          Promise.resolve(fs.load(f)).then(pumpFonts, () => {});
        } catch (e) {
          // fonte inválida: fica a de reserva
        }
      }
    }
    return true;
  }

  const GfxUtil = { report, familyOf, loadedFamilies, fontsReady, onFonts };

  function prefersReducedMotion() {
    if (Tween.reducedMotion === true || Tween.reducedMotion === false) return Tween.reducedMotion;
    if (reducedQuery === null) {
      reducedQuery = false;
      try {
        if (typeof root.matchMedia === 'function') reducedQuery = root.matchMedia('(prefers-reduced-motion: reduce)');
      } catch (e) {
        reducedQuery = false;
      }
    }
    return !!(reducedQuery && reducedQuery.matches);
  }

  function resolveEase(e) {
    if (typeof e === 'function') return e;
    return (e && ease[e]) || ease.outCubic;
  }

  function finite(n, fallback) {
    return typeof n === 'number' && isFinite(n) ? n : fallback;
  }

  function finish(tw, complete) {
    if (tw.done) return;
    tw.done = true;
    if (complete) {
      try {
        tw.apply(1);
      } catch (e) {
        // Um alvo descartado não pode segurar a promessa.
      }
    }
    tw.resolve();
  }

  function removeDone() {
    for (let i = active.length - 1; i >= 0; i--) if (active[i].done) active.splice(i, 1);
  }

  /** Tira de outros tweens as propriedades que `tw` passa a controlar. */
  function overwrite(tw) {
    if (!tw.target || !tw.keys) return;
    for (const other of active) {
      if (other === tw || other.done || other.target !== tw.target || !other.keys || !other.started) continue;
      other.keys = other.keys.filter((k) => tw.keys.indexOf(k) < 0);
      if (!other.keys.length) finish(other, false);
    }
  }

  function add(tw) {
    if (tw.duration <= 0 && tw.delay <= 0) {
      tw.start();
      tw.apply(1);
      tw.done = true;
      tw.resolve();
      return;
    }
    active.push(tw);
  }

  function makeRecord(opts) {
    const o = opts || {};
    const scale = prefersReducedMotion() ? 0.6 : 1;
    const rec = {
      target: null,
      keys: null,
      duration: Math.max(0, finite(o.duration, 0.4)) * scale,
      delay: Math.max(0, finite(o.delay, 0)) * scale,
      elapsed: 0,
      ease: resolveEase(o.ease),
      started: false,
      done: false,
      resolve: null,
      start() {},
      apply() {},
    };
    rec.promise = new Promise((res) => {
      rec.resolve = res;
    });
    return rec;
  }

  const Tween = {
    ease,
    speed: 1,
    reducedMotion: null,
    time: 0,

    /** Anima propriedades numéricas de `target` até os valores de `props`. */
    to(target, props, opts) {
      const o = opts || {};
      const rec = makeRecord(o);
      const keys = Object.keys(props || {}).filter((k) => typeof props[k] === 'number');
      rec.target = target;
      rec.keys = keys;
      const from = {};
      rec.start = () => {
        for (const k of rec.keys) from[k] = finite(target[k], 0);
        overwrite(rec);
      };
      rec.apply = (t) => {
        const e = t >= 1 ? 1 : rec.ease(t);
        for (const k of rec.keys) target[k] = t >= 1 ? props[k] : from[k] + (props[k] - from[k]) * e;
        if (o.onUpdate) o.onUpdate(e, t);
      };
      if (!target || !keys.length) {
        rec.target = null;
        rec.keys = null;
        rec.apply = (t) => {
          if (o.onUpdate) o.onUpdate(t >= 1 ? 1 : rec.ease(t), t);
        };
      }
      add(rec);
      return rec.promise;
    },

    /** Executa fn(eased, raw) a cada quadro durante `duration` segundos. */
    run(duration, fn, opts) {
      const o = Object.assign({}, opts || {}, { duration });
      const rec = makeRecord(o);
      rec.target = o.target || null;
      rec.apply = (t) => {
        fn(t >= 1 ? 1 : rec.ease(t), t);
      };
      add(rec);
      return rec.promise;
    },

    delay(seconds) {
      return Tween.run(seconds, () => {}, { ease: 'linear' });
    },

    update(dt) {
      const step = Math.max(0, finite(dt, 0)) * Math.max(0, finite(Tween.speed, 1));
      Tween.time += step;
      if (!active.length) return;
      const list = active.slice();
      for (const tw of list) {
        if (tw.done) continue;
        tw.elapsed += step;
        if (tw.elapsed < tw.delay) continue;
        if (!tw.started) {
          tw.started = true;
          tw.start();
          if (tw.done) continue;
        }
        const local = tw.elapsed - tw.delay;
        const t = tw.duration > 0 ? Math.min(1, local / tw.duration) : 1;
        try {
          tw.apply(t);
        } catch (e) {
          finish(tw, false);
          report(e, 'animação (tween)');
          continue;
        }
        if (t >= 1) finish(tw, false);
      }
      removeDone();
    },

    /** Encerra os tweens de um alvo (os de `run` com opts.target também). */
    kill(target, opts) {
      const complete = !!(opts && opts.complete);
      for (const tw of active.slice()) if (tw.target === target) finish(tw, complete);
      removeDone();
    },

    killAll(opts) {
      const complete = !!(opts && opts.complete);
      for (const tw of active.slice()) finish(tw, complete);
      active.length = 0;
    },

    isTweening(target) {
      return active.some((tw) => !tw.done && tw.target === target);
    },

    activeCount() {
      return active.length;
    },

    /** Promessa que resolve com a primeira entre `promise` e o limite de `seconds` reais. */
    guard(promise, seconds) {
      let timer = null;
      const limit = new Promise((res) => {
        timer = setTimeout(res, Math.max(0, seconds) * 1000);
      });
      return Promise.race([Promise.resolve(promise), limit]).then((v) => {
        clearTimeout(timer);
        return v;
      });
    },

    prefersReducedMotion,
  };

  Tween.util = GfxUtil;
  Truco.Tween = Tween;
  Truco.GfxUtil = GfxUtil;
  if (typeof module === 'object' && module.exports) module.exports = Tween;
})(typeof window !== 'undefined' ? window : globalThis);
