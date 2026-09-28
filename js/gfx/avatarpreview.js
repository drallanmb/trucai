/*
 * TrucAÍ — Truco.AvatarPreview: prévia 3D de um personagem (tela "Criar personagem").
 *
 *   AvatarPreview.create(el, { quality, background }) -> { setSpec(spec), act(kind), signal(gesto), dispose() }
 *
 * Um avatar sozinho numa cadeira de ferro "Garoa" (simplificada), luz quente de cima + preenchimento,
 * câmera em retrato 3/4 (cabeça e tronco). Gira devagar sozinho; arrastar (mouse, toque, caneta) gira.
 * Renderer próprio dentro de `el` (acompanha o tamanho dele com ResizeObserver).
 *
 *   quality     'high' | 'low'   (padrão 'high')
 *   background  '#17110D' (padrão, sólido) | 'transparent'
 *
 * spec: o mesmo de Truco.Avatars.create (docs/PERSONAGENS.md, apêndice). setSpec troca o avatar e
 * libera a geometria/os materiais do anterior. act/signal devolvem Promise que sempre resolve.
 * O relógio das animações é PRÓPRIO (ctx.tween): a prévia pode rodar por cima da mesa sem acelerar
 * nem congelar as animações do jogo (o Truco.Tween global continua sendo só da cena).
 * Sem WebGL, mostra um aviso no elemento e devolve a mesma API (tudo vira no-op).
 */
(function (root) {
  'use strict';
  const Truco = (root.Truco = root.Truco || {});

  const BG = '#17110D';
  // Enquadramento: centro do retrato (entre o peito e a cabeça) e o que precisa caber.
  const FRAME = Object.freeze({ target: [0, 2.8, 0.45], height: 5.7, width: 4.8, fov: 30, elevation: 0.16, baseAz: 0.5 });

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  /**
   * Relógio de animação independente, com a parte da API do Truco.Tween que os avatares usam
   * (to, run, kill, killAll, isTweening, update, ease, prefersReducedMotion). Promessas sempre resolvem.
   */
  function makeTween() {
    const G = Truco.Tween;
    const ease = (G && G.ease) || { linear: (t) => t, outCubic: (t) => 1 - Math.pow(1 - t, 3) };
    const active = [];
    const resolveEase = (e) => (typeof e === 'function' ? e : (e && ease[e]) || ease.outCubic || ease.linear);
    const reduced = () => (G && typeof G.prefersReducedMotion === 'function' ? G.prefersReducedMotion() : false);
    function finish(tw) {
      if (tw.done) return;
      tw.done = true;
      tw.resolve();
    }
    function add(tw) {
      tw.promise = new Promise((res) => (tw.resolve = res));
      if (tw.duration <= 0) {
        tw.start();
        tw.apply(1);
        tw.done = true;
        tw.resolve();
      } else active.push(tw);
      return tw.promise;
    }
    const T = {
      ease,
      speed: 1,
      prefersReducedMotion: reduced,
      to(target, props, opts) {
        const o = opts || {};
        const keys = Object.keys(props || {}).filter((k) => typeof props[k] === 'number');
        const from = {};
        const e = resolveEase(o.ease);
        const tw = {
          target,
          keys,
          duration: Math.max(0, +o.duration || 0.4) * (reduced() ? 0.6 : 1),
          elapsed: 0,
          started: false,
          done: false,
          start() {
            for (const k of keys) from[k] = +target[k] || 0;
            // Sobrescreve outros tweens do mesmo alvo nas mesmas chaves.
            for (const other of active) {
              if (other === tw || other.done || other.target !== target || !other.keys) continue;
              other.keys = other.keys.filter((k) => keys.indexOf(k) < 0);
              if (!other.keys.length) finish(other);
            }
          },
          apply(t) {
            const k = t >= 1 ? 1 : e(t);
            for (const key of tw.keys) target[key] = t >= 1 ? props[key] : from[key] + (props[key] - from[key]) * k;
          },
        };
        return add(tw);
      },
      run(duration, fn, opts) {
        const o = opts || {};
        const e = resolveEase(o.ease);
        const tw = {
          target: o.target || null,
          keys: null,
          duration: Math.max(0, +duration || 0) * (reduced() ? 0.6 : 1),
          elapsed: 0,
          started: false,
          done: false,
          start() {},
          apply(t) {
            fn(t >= 1 ? 1 : e(t), t);
          },
        };
        return add(tw);
      },
      update(dt) {
        const step = Math.max(0, +dt || 0) * T.speed;
        for (const tw of active.slice()) {
          if (tw.done) continue;
          if (!tw.started) {
            tw.started = true;
            tw.start();
            if (tw.done) continue;
          }
          tw.elapsed += step;
          const t = Math.min(1, tw.elapsed / tw.duration);
          try {
            tw.apply(t);
          } catch (err) {
            finish(tw);
            report(err, 'AvatarPreview (tween)');
            continue;
          }
          if (t >= 1) finish(tw);
        }
        for (let i = active.length - 1; i >= 0; i--) if (active[i].done) active.splice(i, 1);
      },
      kill(target) {
        for (const tw of active) if (tw.target === target) finish(tw);
        for (let i = active.length - 1; i >= 0; i--) if (active[i].done) active.splice(i, 1);
      },
      killAll() {
        for (const tw of active) finish(tw);
        active.length = 0;
      },
      isTweening(target) {
        return active.some((tw) => !tw.done && tw.target === target);
      },
      activeCount() {
        return active.length;
      },
    };
    return T;
  }

  function report(err, where) {
    const U = Truco.GfxUtil;
    if (U && typeof U.report === 'function') U.report(err, where);
    else if (root.console) root.console.error(where, err);
  }

  /** Encosto da cadeira: vermelho, faixa amarela e "Garoa" (fonte de reserva se Shrikhand não chegou). */
  function chairBackCanvas() {
    const W = 256;
    const H = 128;
    const c = root.document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#b3261e';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#f2c230';
    g.fillRect(0, H / 2 - 17, W, 34);
    g.font = 'italic 700 34px Shrikhand, Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.strokeStyle = '#8f1b15';
    g.strokeText('Garoa', W / 2, H / 2 + 2);
    g.fillStyle = '#ffffff';
    g.fillText('Garoa', W / 2, H / 2 + 2);
    return c;
  }

  /** Cadeira de ferro dobrável "Garoa" simplificada (mesmas medidas da do World), no referencial do avatar. */
  function buildChair(THREE, track) {
    const group = new THREE.Group();
    const paint = track(new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.45, metalness: 0.35 }));
    const tex = track(new THREE.CanvasTexture(chairBackCanvas()));
    tex.colorSpace = THREE.SRGBColorSpace;
    const backMat = track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.3 }));
    const add = (geo, mat, x, y, z, rx) => {
      const m = new THREE.Mesh(track(geo), mat);
      m.position.set(x, y, z);
      if (rx) m.rotation.x = rx;
      m.castShadow = m.receiveShadow = true;
      group.add(m);
      return m;
    };
    const rod = (a, b, r) => {
      const va = new THREE.Vector3().fromArray(a);
      const vb = new THREE.Vector3().fromArray(b);
      const geo = new THREE.CylinderGeometry(r, r, va.distanceTo(vb), 8);
      const m = add(geo, paint, 0, 0, 0);
      m.position.copy(va).add(vb).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.sub(va).normalize());
    };
    const seatTop = 4.5;
    add(new THREE.BoxGeometry(3.9, 0.14, 3.6), paint, 0, seatTop - 0.07, 0);
    add(new THREE.BoxGeometry(3.9, 0.3, 0.08), paint, 0, seatTop - 0.2, 1.78);
    for (const sx of [-1.85, 1.85]) {
      rod([sx, 0, -2.3], [sx, 9.6, -2.05], 0.1);
      rod([sx * 0.97, 0, 1.7], [sx * 0.97, seatTop - 0.1, -1.7], 0.09);
    }
    rod([-1.8, 0.6, 1.62], [1.8, 0.6, 1.62], 0.07);
    rod([-1.85, 1.2, -2.27], [1.85, 1.2, -2.27], 0.07);
    // Encosto: logo dos dois lados (a prévia gira).
    add(new THREE.BoxGeometry(3.6, 1.55, 0.08), [paint, paint, paint, paint, backMat, backMat], 0, 8.35, -2.12, -0.08);
    // Mesmo lugar do World: cadeira 0,45 atrás do avatar, pés no chão (y = −7,4).
    group.position.set(0, -7.4, -0.45);
    return group;
  }

  /** Leque de três cartas de costas na mão (a prévia não tem mesa nem Cards3D). */
  function buildFan(THREE, track, anchor) {
    const c = root.document.createElement('canvas');
    c.width = 64;
    c.height = 90;
    const g = c.getContext('2d');
    g.fillStyle = '#16120f';
    g.fillRect(0, 0, 64, 90);
    g.strokeStyle = '#c9a15b';
    g.lineWidth = 3;
    g.strokeRect(5, 5, 54, 80);
    g.fillStyle = '#f4efe4';
    for (let i = 0; i < 3; i++) g.fillRect(19 + i * 5, 34 + i * 5, 12, 12);
    const tex = track(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 }));
    const geo = track(new THREE.BoxGeometry(0.63, 0.88, 0.006));
    geo.translate(0, 0.44, 0);
    const fan = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.z = (1 - i) * 0.22;
      m.position.set((i - 1) * 0.1, 0, i * 0.008);
      fan.add(m);
    }
    anchor.add(fan);
    return fan;
  }

  function noop() {
    return Promise.resolve();
  }

  function create(el, opts) {
    const o = opts || {};
    const THREE = root.THREE;
    const quality = o.quality === 'low' ? 'low' : 'high';
    const transparent = o.background === 'transparent';
    const disposables = [];
    const track = (x) => {
      disposables.push(x);
      return x;
    };

    let renderer = null;
    try {
      if (!THREE || !el) throw new Error('THREE ou elemento ausente');
      renderer = new THREE.WebGLRenderer({ antialias: quality === 'high', alpha: transparent, powerPreference: 'low-power' });
    } catch (err) {
      report(err, 'AvatarPreview.create');
      if (el) {
        const msg = root.document.createElement('p');
        msg.className = 'avatar-preview-fallback';
        msg.textContent = 'Prévia 3D indisponível neste navegador.';
        el.appendChild(msg);
      }
      return { setSpec() {}, act: noop, signal: noop, dispose() {}, ok: false };
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = quality === 'high';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, quality === 'high' ? 2 : 1.25));
    if (transparent) renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'pan-y';
    canvas.style.cursor = 'grab';
    canvas.setAttribute('data-block-3d', '');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Prévia 3D do personagem');
    el.appendChild(canvas);

    const scene = new THREE.Scene();
    scene.background = transparent ? null : new THREE.Color(BG);
    const camera = new THREE.PerspectiveCamera(FRAME.fov, 1, 0.5, 80);

    // Luz: lâmpada quente de cima (com sombra), preenchimento quente, céu/chão e contraluz de sódio.
    const key = new THREE.SpotLight(0xffd6a0, 520, 40, 0.62, 0.55, 1.6);
    key.position.set(1.2, 13, 5.5);
    key.target.position.set(0, 2.6, 0);
    key.castShadow = quality === 'high';
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0004;
    key.shadow.camera.near = 4;
    key.shadow.camera.far = 30;
    const fill = new THREE.PointLight(0xffc48a, 60, 40, 1.6);
    fill.position.set(-5, 6, 7);
    const hemi = new THREE.HemisphereLight(0x8fa3d6, 0x3a2414, 0.55);
    const rim = new THREE.DirectionalLight(0xff9a4a, 1.6);
    rim.position.set(-3, 6, -8);
    scene.add(key, key.target, fill, hemi, rim);

    // Chão escuro só para receber a sombra (some no fundo).
    const floorMat = track(new THREE.ShadowMaterial({ opacity: 0.35 }));
    const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(40, 40)), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -7.4;
    floor.receiveShadow = true;
    scene.add(floor);

    const chair = buildChair(THREE, track);
    scene.add(chair);

    const tween = makeTween();
    const ctx = {
      THREE,
      scene,
      renderer,
      camera,
      quality,
      envMap: null,
      players: 4,
      lights: { key, fill, hemi, rim },
      table: { topY: 0, rimTopY: 0, size: { w: 7, d: 7 }, playSize: { w: 6, d: 6 }, floorY: -7.4, keepOut: [] },
      reducedMotion: tween.prefersReducedMotion(),
      tween,
      seatPosition: () => new THREE.Vector3(0, 0, 0),
      seatFacing: () => 0,
      sfx() {},
      avatar: () => null,
    };

    let avatar = null;
    let fan = null;
    let alive = true;
    // Leque: um modelo só (geometria/material/textura compartilhados), clonado para cada avatar.
    let fanProto = null;
    function attachFan(anchor) {
      if (!fanProto) fanProto = buildFan(THREE, track, new THREE.Object3D());
      const f = fanProto.clone();
      anchor.add(f);
      return f;
    }

    function removeAvatar() {
      if (!avatar) return;
      try {
        avatar.dispose();
      } catch (err) {
        report(err, 'AvatarPreview.setSpec (dispose)');
      }
      avatar = null;
      fan = null;
    }

    function setSpec(spec) {
      if (!alive) return;
      removeAvatar();
      tween.killAll();
      try {
        const Avatars = Truco.Avatars;
        if (!Avatars || typeof Avatars.create !== 'function') throw new Error('Truco.Avatars ausente');
        const s = Object.assign({ seat: 2 }, spec || {});
        avatar = Avatars.create(ctx, Object.assign({}, s, { position: new THREE.Vector3(0, 0, 0), facing: 0 }));
        fan = attachFan(avatar.cardAnchor);
        avatar.group.traverse((m) => {
          if (m.isMesh) m.castShadow = quality === 'high' && m.castShadow;
        });
      } catch (err) {
        report(err, 'AvatarPreview.setSpec');
        avatar = null;
      }
    }
    function act(kind) {
      return avatar && alive ? Promise.resolve(avatar.act(kind)).catch((e) => report(e, 'AvatarPreview.act')) : noop();
    }

    function signal(g) {
      if (!avatar || !alive) return noop();
      const fn = avatar.signal || avatar.act;
      return Promise.resolve(fn(g)).catch((e) => report(e, 'AvatarPreview.signal'));
    }

    // ------------------------------------------------------------------ câmera e giro
    const orbit = { az: FRAME.baseAz, dragging: false, pointerId: null, lastX: 0, idle: 99, vel: 0, t: 0 };
    let width = 0;
    let height = 0;

    function frameCamera() {
      const aspect = width / Math.max(1, height);
      camera.aspect = aspect;
      const tanV = Math.tan((FRAME.fov * Math.PI) / 360);
      const dist = Math.max(FRAME.height / (2 * tanV), FRAME.width / (2 * tanV * aspect));
      camera.userData.dist = dist;
      camera.updateProjectionMatrix();
    }

    function placeCamera() {
      const d = camera.userData.dist || 12;
      const t = FRAME.target;
      const ce = Math.cos(FRAME.elevation);
      camera.position.set(t[0] + Math.sin(orbit.az) * d * ce, t[1] + Math.sin(FRAME.elevation) * d, t[2] + Math.cos(orbit.az) * d * ce);
      camera.lookAt(t[0], t[1], t[2]);
    }

    function resize() {
      const r = el.getBoundingClientRect();
      const w = Math.max(0, Math.round(r.width));
      const h = Math.max(0, Math.round(r.height));
      if (w === width && h === height) return;
      width = w;
      height = h;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      frameCamera();
    }

    let ro = null;
    if (typeof root.ResizeObserver === 'function') {
      ro = new root.ResizeObserver(resize);
      ro.observe(el);
    } else root.addEventListener('resize', resize);
    resize();

    function onDown(e) {
      if (orbit.dragging) return;
      orbit.dragging = true;
      orbit.pointerId = e.pointerId;
      orbit.lastX = e.clientX;
      orbit.vel = 0;
      canvas.style.cursor = 'grabbing';
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (err) {
        // Sem captura: segue funcionando enquanto o ponteiro estiver sobre o canvas.
      }
    }
    function onMove(e) {
      if (!orbit.dragging || e.pointerId !== orbit.pointerId) return;
      const dx = e.clientX - orbit.lastX;
      orbit.lastX = e.clientX;
      const k = 5.5 / Math.max(240, width);
      orbit.az -= dx * k;
      orbit.vel = -dx * k * 60;
      orbit.idle = 0;
    }
    function onUp(e) {
      if (e.pointerId !== orbit.pointerId) return;
      orbit.dragging = false;
      orbit.pointerId = null;
      canvas.style.cursor = 'grab';
    }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    // ------------------------------------------------------------------ laço
    let raf = 0;
    let paused = false;
    let last = 0;
    let time = 0;
    const wrap = (a) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

    function step(dt) {
      time += dt;
      tween.update(dt);
      const reduced = tween.prefersReducedMotion();
      if (!orbit.dragging) {
        // Inércia curta depois de soltar; depois de 2,5 s parado, volta a balançar sozinho (± ~45°
        // em torno do 3/4), puxando devagar para a faixa se o arrasto deixou o avatar de costas.
        orbit.az += orbit.vel * dt;
        orbit.vel *= Math.exp(-dt * 5);
        orbit.idle += dt;
        if (orbit.idle > 2.5 && !reduced) {
          orbit.t += dt;
          const goal = FRAME.baseAz * 0.4 + Math.sin(orbit.t * 0.28) * 0.75;
          orbit.az = wrap(orbit.az);
          orbit.az += (goal - orbit.az) * Math.min(1, dt * 0.6);
        }
      }
      placeCamera();
      if (avatar) avatar.update(dt, time);
    }

    function frame(now) {
      raf = 0;
      if (!alive) return;
      const dt = last ? clamp((now - last) / 1000, 0, 0.05) : 1 / 60;
      last = now;
      if (!el.isConnected) {
        // Elemento fora do documento: espera voltar (ou o dispose).
        raf = root.requestAnimationFrame(frame);
        return;
      }
      if (width && height) {
        if (!paused) step(dt);
        else placeCamera();
        renderer.render(scene, camera);
      }
      raf = root.requestAnimationFrame(frame);
    }
    raf = root.requestAnimationFrame(frame);

    function dispose() {
      if (!alive) return;
      alive = false;
      if (raf) root.cancelAnimationFrame(raf);
      raf = 0;
      if (ro) ro.disconnect();
      else root.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      removeAvatar();
      tween.killAll();
      disposables.forEach((d) => {
        try {
          if (d && d.dispose) d.dispose();
        } catch (err) {
          // segue liberando o resto
        }
      });
      key.shadow.map && key.shadow.map.dispose();
      renderer.dispose();
      try {
        renderer.forceContextLoss();
      } catch (err) {
        // navegador sem WEBGL_lose_context
      }
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    }

    if (o.spec) setSpec(o.spec);

    return {
      setSpec,
      act,
      signal,
      dispose,
      ok: true,
      // Só para testes/ferramentas (tools/preview-avatars.html).
      debug: {
        renderer,
        scene,
        camera,
        tween,
        step,
        orbit,
        pause: (on) => (paused = !!on),
        avatar: () => avatar,
        render: () => renderer.render(scene, camera),
        info: () => ({ geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: (renderer.info.programs || []).length }),
      },
    };
  }

  const AvatarPreview = { create, makeTween, buildChair, FRAME };
  Truco.AvatarPreview = AvatarPreview;
  if (typeof module === 'object' && module.exports) module.exports = AvatarPreview;
})(typeof window !== 'undefined' ? window : globalThis);
