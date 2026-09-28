/*
 * TrucAÍ — efeito "galáxia do Seis" (Truco.Galaxy).
 *
 * Quando alguém grita "Seis!", estrelas surgem espalhadas sobre a mesa, se juntam girando
 * e formam uma galáxia espiral cujo braço desenha o número 6, virada para a câmera. O 6
 * brilha e gira um pouco e depois se desfaz em poeira de estrelas que cai na mesa.
 *
 * Tudo acontece no shader: cada estrela tem posição inicial, posição no 6 e semente; o
 * tempo vai num uniform, então o custo por quadro é só o de desenhar os pontos.
 *
 *   const fx = Galaxy.create(ctx)      // ctx: { THREE, scene, camera, renderer, quality }
 *   await fx.play({ center })          // center: THREE.Vector3 (padrão: centro da mesa)
 *   fx.update(dt)                      // no laço de render (dt já multiplicado pela velocidade)
 *   fx.setQuality('high'|'low'); fx.dispose()
 */
(function (root) {
  'use strict';
  const Truco = (root.Truco = root.Truco || {});

  // Linha do tempo (segundos, velocidade 1).
  const T_IN = 0.35; // estrelas espalhadas acendem
  const T_FORM = 1.75; // fim da convergência
  const T_HOLD = 2.85; // o 6 brilha e gira
  const T_END = 3.7; // poeira caiu e sumiu
  const T_END_REDUCED = 1.6; // movimento reduzido: aparece, brilha, some

  const COUNT = { high: 2600, low: 1800 };
  const HEIGHT = 5.6; // altura do 6 em unidades de mundo (1 u = 10 cm)
  const LIFT = 4.3; // quanto o centro do 6 flutua acima do tampo

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

  function gauss(rnd) {
    const u = Math.max(1e-6, rnd());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  }

  // Forma do 6 no plano local (unidade ≈ altura 2): barriga = espiral logarítmica em volta do
  // núcleo; o braço externo continua para cima e faz a curva do topo.
  const CORE = [0.02, -0.38];
  const BOWL_R = 0.56;
  const TURNS = 1.25;
  const END_ANGLE = Math.PI; // a espiral termina no lado esquerdo da barriga, onde nasce a perna
  const STEM = [
    [CORE[0] - BOWL_R, CORE[1]],
    [-0.66, 0.42],
    [-0.12, 0.98],
    [0.5, 0.86],
  ];

  function spiralPoint(t) {
    // t = 0 no núcleo, 1 na borda; r cresce exponencialmente como numa galáxia
    const r = 0.1 + (BOWL_R - 0.1) * t;
    const a = END_ANGLE + (1 - t) * TURNS * 2 * Math.PI;
    return [CORE[0] + Math.cos(a) * r, CORE[1] + Math.sin(a) * r * 0.94, a, r];
  }

  function bezier(t) {
    const u = 1 - t;
    const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return [
      k[0] * STEM[0][0] + k[1] * STEM[1][0] + k[2] * STEM[2][0] + k[3] * STEM[3][0],
      k[0] * STEM[0][1] + k[1] * STEM[1][1] + k[2] * STEM[2][1] + k[3] * STEM[3][1],
    ];
  }

  function buildAttributes(THREE, n) {
    const rnd = mulberry32(606);
    const start = new Float32Array(n * 3);
    const target = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const size = new Float32Array(n);
    const color = new Float32Array(n * 3);
    const orbit = new Float32Array(n); // 1 = gira em volta do núcleo (barriga), 0 = parado (perna)
    const cool = new THREE.Color('#DCE6FF');
    const white = new THREE.Color('#FFFFFF');
    const warm = new THREE.Color('#FFB46B');
    const c = new THREE.Color();
    const scale = HEIGHT / 2;

    for (let i = 0; i < n; i++) {
      const pick = rnd();
      let x;
      let y;
      let spin = 1;
      let bright = 1;
      if (pick < 0.07) {
        // núcleo denso e brilhante
        x = CORE[0] + gauss(rnd) * 0.06;
        y = CORE[1] + gauss(rnd) * 0.06;
        bright = 1.15;
      } else if (pick < 0.68) {
        // dois braços da espiral (o segundo defasado meia volta, mais fraco)
        const t = Math.pow(rnd(), 0.55); // mais estrelas no braço externo: a barriga do 6 fica nítida
        const p = spiralPoint(t);
        const second = rnd() < 0.3;
        const a = p[2] + (second ? Math.PI : 0);
        const spread = 0.018 + 0.03 * t;
        x = CORE[0] + Math.cos(a) * p[3] + gauss(rnd) * spread;
        y = CORE[1] + Math.sin(a) * p[3] * 0.94 + gauss(rnd) * spread;
        bright = second ? 0.55 : 0.8 + 0.5 * t;
      } else if (pick < 0.94) {
        // perna do 6: afina e esmaece para a ponta
        const t = rnd();
        const p = bezier(t);
        const spread = 0.03 * (1 - 0.5 * t);
        x = p[0] + gauss(rnd) * spread;
        y = p[1] + gauss(rnd) * spread;
        spin = 1 - t; // perto da barriga ainda acompanha o giro
        bright = 1 - 0.45 * t;
      } else {
        // halo de estrelas soltas
        const a = rnd() * Math.PI * 2;
        const r = 0.2 + rnd() * 0.9;
        x = CORE[0] + Math.cos(a) * r;
        y = CORE[1] + 0.3 + Math.sin(a) * r;
        spin = 0.4;
        bright = 0.45;
      }
      target[i * 3] = x * scale;
      target[i * 3 + 1] = y * scale;
      target[i * 3 + 2] = gauss(rnd) * 0.05;
      orbit[i] = spin;

      // começo: espalhadas num volume largo sobre a mesa
      start[i * 3] = (rnd() * 2 - 1) * 5.2;
      start[i * 3 + 1] = (rnd() * 2 - 1) * 2.8;
      start[i * 3 + 2] = (rnd() * 2 - 1) * 2.0;

      seed[i] = rnd();
      const big = rnd() < 0.04;
      size[i] = (big ? 3.2 + rnd() * 2.5 : 0.7 + Math.pow(rnd(), 2.4) * 2.2) * (0.75 + 0.25 * bright);

      const hue = rnd();
      c.copy(hue < 0.16 ? warm : hue < 0.55 ? white : cool);
      c.multiplyScalar(Math.min(1.8, bright));
      color[i * 3] = c.r;
      color[i * 3 + 1] = c.g;
      color[i * 3 + 2] = c.b;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(target, 3));
    g.setAttribute('aStart', new THREE.BufferAttribute(start, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    g.setAttribute('aOrbit', new THREE.BufferAttribute(orbit, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6);
    return g;
  }

  const VERT = `
    uniform float uTime;
    uniform float uPixel;
    uniform float uReduced;
    uniform vec2 uCore;
    attribute vec3 aStart;
    attribute float aSeed;
    attribute float aSize;
    attribute vec3 aColor;
    attribute float aOrbit;
    varying vec3 vColor;
    varying float vAlpha;

    float easeInOut(float t) { return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0; }

    vec2 rotateAround(vec2 p, vec2 c, float a) {
      vec2 d = p - c;
      float s = sin(a), co = cos(a);
      return c + vec2(d.x * co - d.y * s, d.x * s + d.y * co);
    }

    void main() {
      float t = uTime;
      vec3 target = position;
      vec3 p;
      float alpha;

      if (uReduced > 0.5) {
        // versão curta: surge no lugar, brilha e some, sem voar nem girar
        p = target;
        alpha = smoothstep(0.0, 0.35, t) * (1.0 - smoothstep(${(T_END_REDUCED - 0.45).toFixed(2)}, ${T_END_REDUCED.toFixed(2)}, t));
      } else {
        float delay = aSeed * 0.45;
        float k = easeInOut(clamp((t - ${T_IN.toFixed(2)} * 0.5 - delay) / (${T_FORM.toFixed(2)} - ${T_IN.toFixed(2)} * 0.5 - 0.45), 0.0, 1.0));

        // giro: forte enquanto converge, bem lento depois
        float spin = aOrbit * ((1.0 - k) * 4.2 + t * 0.22);
        vec2 swirled = rotateAround(target.xy, uCore, spin);
        vec3 formed = vec3(swirled, target.z);

        // as espalhadas derivam devagar enquanto esperam
        vec3 drift = aStart + vec3(sin(t * 0.7 + aSeed * 30.0), cos(t * 0.6 + aSeed * 17.0), 0.0) * 0.08;
        p = mix(drift, formed, k);

        // no fim a poeira cai e se abre
        float fall = clamp((t - ${T_HOLD.toFixed(2)} - aSeed * 0.25) / (${T_END.toFixed(2)} - ${T_HOLD.toFixed(2)} - 0.25), 0.0, 1.0);
        p.y -= fall * fall * (2.6 + aSeed * 2.2);
        p.xz += vec2(aSeed - 0.5, fract(aSeed * 7.3) - 0.5) * fall * 1.6;

        alpha = smoothstep(0.0, ${T_IN.toFixed(2)}, t - aSeed * 0.15) * (1.0 - fall);
        alpha *= mix(0.55, 1.0, k); // espalhadas mais apagadas que o 6 formado
      }

      // cintilar
      alpha *= 0.78 + 0.22 * sin(t * (6.0 + aSeed * 9.0) + aSeed * 40.0);

      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = aSize * uPixel * (38.0 / max(0.5, -mv.z));
      vColor = aColor;
      vAlpha = clamp(alpha, 0.0, 1.0);
    }
  `;

  const FRAG = `
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vec2 d = gl_PointCoord - 0.5;
      float r2 = dot(d, d) * 4.0;
      if (r2 > 1.0) discard;
      float glow = exp(-r2 * 4.5);           // halo suave (bokeh)
      float core = exp(-r2 * 28.0) * 0.9;    // miolo brilhante
      gl_FragColor = vec4(vColor * (glow * 0.55 + core) * vAlpha, 1.0);
    }
  `;

  function create(ctx) {
    const THREE = ctx.THREE || root.THREE;
    let quality = ctx.quality === 'low' ? 'low' : 'high';
    let points = null;
    let material = null;
    let veilMat = null;
    let running = null; // { time, duration, resolve, baseExposure }

    function build() {
      const geometry = buildAttributes(THREE, COUNT[quality]);
      material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPixel: { value: ctx.renderer.getPixelRatio() },
          uReduced: { value: 0 },
          uCore: { value: new THREE.Vector2(CORE[0] * (HEIGHT / 2), CORE[1] * (HEIGHT / 2)) },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      points.renderOrder = 20;
      points.visible = false;

      // Véu escuro atrás das estrelas: um pedaço de céu noturno para o 6 ter contraste sobre a mesa vermelha.
      veilMat = new THREE.ShaderMaterial({
        uniforms: { uAlpha: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader:
          'uniform float uAlpha; varying vec2 vUv;' +
          'void main() { vec2 d = (vUv - 0.5) * vec2(2.0, 2.0); float r = length(d);' +
          ' float a = uAlpha * (1.0 - smoothstep(0.15, 1.0, r));' +
          ' gl_FragColor = vec4(0.02, 0.025, 0.05, a); }',
        transparent: true,
        depthWrite: false,
      });
      const veil = new THREE.Mesh(new THREE.PlaneGeometry(HEIGHT * 1.35, HEIGHT * 1.25), veilMat);
      veil.position.set(0, HEIGHT * 0.02, -0.3);
      veil.renderOrder = 19;
      veil.frustumCulled = false;
      points.add(veil);
      ctx.scene.add(points);
    }

    function destroy() {
      if (!points) return;
      ctx.scene.remove(points);
      points.children.forEach((c) => c.geometry.dispose());
      points.geometry.dispose();
      material.dispose();
      veilMat.dispose();
      veilMat = null;
      points = null;
      material = null;
    }

    function finish() {
      if (!running) return;
      const r = running;
      running = null;
      if (points) points.visible = false;
      ctx.renderer.toneMappingExposure = r.baseExposure;
      r.resolve();
    }

    const reducedMotion = () => (Truco.Tween && Truco.Tween.prefersReducedMotion ? Truco.Tween.prefersReducedMotion() : false);

    return {
      /** Toca o efeito; resolve quando a poeira some. Chamar de novo reinicia. */
      play(opts) {
        const o = opts || {};
        finish();
        if (!points) build();
        const center = o.center || new THREE.Vector3(0, 0, 0);
        const reduced = reducedMotion();
        points.position.set(center.x, center.y + LIFT, center.z + 0.6);
        // de frente para a câmera (inclusive na inclinação), para o 6 não sair achatado
        points.quaternion.copy(ctx.camera.getWorldQuaternion(new THREE.Quaternion()));
        // tamanho pelo campo de visão: ~metade da altura da tela, sem passar da largura no retrato
        const cam = ctx.camera;
        const dist = cam.getWorldPosition(new THREE.Vector3()).distanceTo(points.position);
        const visH = 2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
        const visW = visH * (cam.aspect || 1);
        const want = Math.min(0.52 * visH, (0.86 * visW) / 0.62);
        points.scale.setScalar(Math.max(0.4, Math.min(1.6, want / HEIGHT)));
        material.uniforms.uTime.value = 0;
        material.uniforms.uReduced.value = reduced ? 1 : 0;
        // pontos proporcionais à tela; em retrato a câmera fica longe, então as estrelas crescem um pouco
        const el = ctx.renderer.domElement;
        const portrait = (el.clientWidth || 1) < (el.clientHeight || 1);
        material.uniforms.uPixel.value = ctx.renderer.getPixelRatio() * ((el.clientHeight || 800) / 800) * (portrait ? 1.5 : 1);
        points.visible = true;
        return new Promise((resolve) => {
          running = {
            time: 0,
            duration: reduced ? T_END_REDUCED : T_END,
            resolve,
            baseExposure: ctx.renderer.toneMappingExposure,
            dim: reduced ? 0.15 : 0.32,
          };
        });
      },

      /** dt em segundos, já multiplicado pela velocidade do jogo. */
      update(dt) {
        if (!running) return;
        running.time += dt;
        const t = running.time;
        material.uniforms.uTime.value = t;
        // o salão escurece um pouco enquanto a galáxia brilha
        const on = Math.min(1, t / 0.4) * (1 - Math.max(0, (t - (running.duration - 0.6)) / 0.6));
        ctx.renderer.toneMappingExposure = running.baseExposure * (1 - running.dim * Math.max(0, on));
        veilMat.uniforms.uAlpha.value = 0.62 * Math.max(0, on);
        if (t >= running.duration) finish();
      },

      setQuality(q) {
        const next = q === 'low' ? 'low' : 'high';
        if (next === quality) return;
        quality = next;
        finish();
        destroy();
      },

      isPlaying() {
        return !!running;
      },

      dispose() {
        finish();
        destroy();
      },
    };
  }

  const Galaxy = { create, DURATION: T_END };
  Truco.Galaxy = Galaxy;
  if (typeof module === 'object' && module.exports) module.exports = Galaxy;
})(typeof window !== 'undefined' ? window : globalThis);
