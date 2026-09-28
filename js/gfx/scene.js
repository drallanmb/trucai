/*
 * TrucAÍ — Truco.Scene: renderer, câmera, luz, laço de render, picking da mão do humano e a
 * API pública da cena 3D (docs/ARCHITECTURE.md §6). Delegação interna:
 *   Truco.Table   (table.js)    mesa
 *   Truco.World   (world.js)    salão e adereços        — substituível (docs/SCENE-INTERNALS.md §3)
 *   Truco.Avatars (avatars.js)  oponentes e parceiro    — substituível (docs/SCENE-INTERNALS.md §4)
 *   Truco.Cards3D (cards3d.js)  cartas, monte, feijões e animações
 *
 *   const scene = Scene.create(stageEl, { players: 2|4, quality: 'high'|'low' })
 */
(function (root) {
  'use strict';
  const Truco = (root.Truco = root.Truco || {});

  const SEAT_RADIUS = 5.0;
  /**
   * Enquadramento: elevação (graus) e FOV vertical em paisagem e retrato; interpolados pela proporção
   * da tela. bodyOut: ponto do corpo dos avatares laterais (assento + direção para fora × bodyOut,
   * na altura bodyY) que também precisa caber na largura. maxY: teto da câmera (abaixo do toldo);
   * se o enquadramento pedir mais alto, a elevação desce até caber.
   * Paisagem ~35° (olhar de quem está sentado à mesa; era 47°), retrato 50° (era 68°).
   * hud: cantos de cima ocupados pelos painéis do HUD, em px CSS (largura w a partir da borda
   * side −1 = esquerda / +1 = direita; altura min(h, hFrac × altura da tela)). Em paisagem
   * (proporção ≥ hudAspect) o rosto dos avatares não pode entrar neles: o retângulo de meia-largura
   * hudFace.r em volta do centro da cabeça, até hudFace.up acima dele (o alto da cabeça/boné pode).
   */
  const CAMERA = {
    landscape: { elev: 35, fov: 54, aspect: 1.45, headRoom: 0.95, xMax: 0.95, yMax: 0.9, handPad: 0.04, bodyOut: 1.2 },
    portrait: { elev: 50, fov: 68, aspect: 0.55, headRoom: 0.7, xMax: 0.99, yMax: 0.58, handPad: 0.3, bodyOut: 0.5 },
    bodyY: 2.4,
    maxY: 17.5,
    hudAspect: 1,
    hudFace: { r: 0.8, up: 0.45 },
    hud: [
      { side: -1, w: 256, h: 96, hFrac: 0.19 }, // placar
      { side: 1, w: 230, h: 184, hFrac: 0.37 }, // vira, manilha e rodadas
      { side: 1, w: 446, h: 68, hFrac: 0.18 }, // ícones (menu, ajuda, som)
    ],
  };
  const HEAD_Y_ESTIMATE = 3.97;
  const DEFAULT_AVATARS = {
    1: { name: 'Tião', shirt: '#2F5D8A', skin: '#b5835a', hair: '#3a2a1e' },
    2: { name: 'Dona Cida', shirt: '#9B3B2E', skin: '#e0b48e', hair: '#5a3a24' },
    3: { name: 'Zé', shirt: '#3E6B45', skin: '#8d5a3b', hair: '#1c1512' },
  };

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function seatDir(seat, players) {
    const dirs = players === 2 ? [[0, 1], [0, -1]] : [[0, 1], [1, 0], [0, -1], [-1, 0]];
    return dirs[seat] || dirs[0];
  }

  function pixelRatioFor(quality) {
    const dpr = (root.devicePixelRatio || 1);
    return Math.min(dpr, quality === 'low' ? 1.25 : 2);
  }

  /** Ambiente para reflexos (PMREM de uma sala simples: luminária quente em cima, penumbra ao redor). */
  function buildEnvironment(THREE, renderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = new THREE.Scene();
    const disposables = [];
    const add = (geo, color, setup) => {
      const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
      const m = new THREE.Mesh(geo, mat);
      setup(m);
      env.add(m);
      disposables.push(geo, mat);
    };
    add(new THREE.BoxGeometry(30, 16, 30), new THREE.Color(0x2a1d15), (m) => {
      m.material.side = THREE.BackSide;
    });
    add(new THREE.CircleGeometry(2.4, 32), new THREE.Color(0xffc98a).multiplyScalar(9), (m) => {
      m.position.y = 7.5;
      m.rotation.x = Math.PI / 2;
    });
    add(new THREE.PlaneGeometry(12, 5), new THREE.Color(0xffa45c).multiplyScalar(0.9), (m) => {
      m.position.set(0, 2, -14.5);
    });
    add(new THREE.PlaneGeometry(10, 6), new THREE.Color(0x3a5a8a).multiplyScalar(0.5), (m) => {
      m.position.set(14.5, 3, 0);
      m.rotation.y = -Math.PI / 2;
    });
    const rt = pmrem.fromScene(env, 0.04);
    disposables.forEach((d) => d.dispose());
    pmrem.dispose();
    return rt;
  }

  function create(stageEl, opts) {
    const THREE = root.THREE;
    if (!THREE) throw new Error('Truco.Scene: THREE não está carregado');
    if (!stageEl) throw new Error('Truco.Scene: elemento do palco ausente');
    const Tween = Truco.Tween;
    const o = opts || {};
    let quality = o.quality === 'low' ? 'low' : 'high';
    let players = o.players === 2 ? 2 : 4;
    let disposed = false;

    // ------------------------------------------------------------------ renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    renderer.setPixelRatio(pixelRatioFor(quality));
    const canvas = renderer.domElement;
    canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Mesa de truco em 3D');
    stageEl.appendChild(canvas);
    const report = (e, where) => (Truco.GfxUtil && Truco.GfxUtil.report ? Truco.GfxUtil.report(e, where) : root.console && root.console.error(where, e));
    const CT = Truco.CardTex;
    try {
      if (CT && typeof CT.setQuality === 'function') CT.setQuality(quality);
      if (CT && typeof CT.setRenderer === 'function') CT.setRenderer(renderer);
    } catch (e) {
      report(e, 'CardTex');
    }

    const scene3 = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1.6, 0.05, 160);
    scene3.add(camera);

    // ------------------------------------------------------------------ luz
    const key = new THREE.SpotLight(0xffcf98, 260, 0, 0.48, 0.75, 2);
    key.name = 'lampKey';
    key.position.set(0, 9.6, 0.3);
    key.target.position.set(0, 0, 0.25);
    key.castShadow = true;
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.02;
    key.shadow.camera.near = 3;
    key.shadow.camera.far = 22;
    // Luz de preenchimento quente e sem sombra, na lâmpada: ilumina os avatares fora do cone.
    const fill = new THREE.PointLight(0xffb878, 42, 0, 2);
    fill.position.set(0, 8.4, 0.3);
    // Ambiente com contraponto frio: céu azul-noite e chão âmbar escuro (a lâmpada continua dominante).
    const hemi = new THREE.HemisphereLight(0x8fa3d6, 0x3a2412, 0.42);
    // Contraluz alaranjada (luz de sódio da rua, DESIGN v2), baixa: recorta as costas dos avatares
    // sem tingir de laranja o piso preto e branco da calçada.
    const rim = new THREE.DirectionalLight(0xff9d52, 0.9);
    rim.position.set(-5, 3.2, -12);
    scene3.add(key, key.target, fill, hemi, rim);
    const lights = { key, fill, hemi, rim };

    function applyShadowQuality() {
      const size = quality === 'high' ? 2048 : 1024;
      if (key.shadow.mapSize.x !== size) {
        key.shadow.mapSize.set(size, size);
        if (key.shadow.map) {
          key.shadow.map.dispose();
          key.shadow.map = null;
        }
      }
      renderer.shadowMap.type = quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    }
    applyShadowQuality();

    // Mapa de ambiente de reserva: só quando o World não gera o dele (World.build falhou).
    let envRT = null;
    function useFallbackEnv(afterContextLoss) {
      // Com o contexto restaurado, os objetos GL antigos já não existem: só troca a referência.
      if (envRT && !afterContextLoss) envRT.dispose();
      envRT = buildEnvironment(THREE, renderer);
      scene3.environment = envRT.texture;
      ctx.envMap = envRT.texture;
    }

    // ------------------------------------------------------------------ contexto compartilhado
    const sfxListeners = [];
    const avatars = {};
    const ctx = {
      THREE,
      scene: scene3,
      renderer,
      camera,
      quality,
      envMap: null, // o World põe o dele em scene.environment; este só existe no caminho de reserva
      players,
      lights,
      table: null,
      reducedMotion: Tween.prefersReducedMotion(),
      seatPosition: (seat, n) => {
        const d = seatDir(seat, n || players);
        return new THREE.Vector3(d[0] * SEAT_RADIUS, 0, d[1] * SEAT_RADIUS);
      },
      seatFacing: (seat, n) => {
        const d = seatDir(seat, n || players);
        return Math.atan2(-d[0], -d[1]);
      },
      sfx(name) {
        for (const cb of sfxListeners) {
          try {
            cb(name);
          } catch (e) {
            report(e, 'onSfx');
          }
        }
      },
      avatar: (seat) => avatars[seat] || null,
    };

    const table = Truco.Table.build(ctx);
    ctx.table = Object.assign({}, table.info, { keepOut: [] });
    const cards = Truco.Cards3D.create(ctx);
    ctx.table.keepOut = cards.keepOut();

    let world = null;
    function buildWorld() {
      try {
        if (Truco.World && typeof Truco.World.build === 'function') world = Truco.World.build(ctx);
      } catch (e) {
        report(e, 'World.build');
        world = null;
      }
      if (!world) {
        scene3.background = new THREE.Color(0x0e0907);
        world = { update() {}, dispose() {}, setQuality() {} };
      }
      if (!scene3.environment) useFallbackEnv();
    }
    buildWorld();

    // ------------------------------------------------------------------ perda de contexto WebGL
    // O r159 recria o estado do renderer ao restaurar e reenvia texturas e geometrias; o que era só
    // da GPU (o PMREM do mapa de ambiente) precisa ser refeito. scene.onContext avisa o HUD.
    const contextListeners = [];
    function emitContext(kind) {
      for (const cb of contextListeners.slice()) {
        try {
          cb(kind);
        } catch (e) {
          report(e, 'onContext');
        }
      }
    }
    function onContextLost(e) {
      if (e && e.preventDefault) e.preventDefault();
      emitContext('lost');
    }
    function onContextRestored() {
      try {
        if (envRT) useFallbackEnv(true);
        if (world.onEvent) world.onEvent('contextRestored');
        if (!scene3.environment) useFallbackEnv(true);
      } catch (e) {
        report(e, 'contexto restaurado');
      }
      emitContext('restored');
    }
    canvas.addEventListener('webglcontextlost', onContextLost, false);
    canvas.addEventListener('webglcontextrestored', onContextRestored, false);

    // ------------------------------------------------------------------ avatares
    function fallbackAvatar(seat) {
      const group = new THREE.Group();
      group.position.copy(ctx.seatPosition(seat));
      group.rotation.y = ctx.seatFacing(seat);
      const cardAnchor = new THREE.Object3D();
      cardAnchor.position.set(0, 1.7, 1.3);
      cardAnchor.rotation.set(-0.87, Math.PI, 0);
      group.add(cardAnchor);
      scene3.add(group);
      const head = new THREE.Vector3(0, HEAD_Y_ESTIMATE, 0);
      return {
        group,
        cardAnchor,
        headWorldPos: (t) => group.localToWorld((t || new THREE.Vector3()).copy(head)),
        act: () => Promise.resolve(),
        lookAt() {},
        setTurn() {},
        update() {},
        dispose: () => scene3.remove(group),
      };
    }

    function disposeAvatars() {
      Object.keys(avatars).forEach((s) => {
        try {
          avatars[s].dispose();
        } catch (e) {
          report(e, 'Avatar.dispose');
        }
        delete avatars[s];
      });
    }

    function setup(cfg) {
      const c = cfg || {};
      players = c.players === 2 ? 2 : c.players === 4 ? 4 : players;
      ctx.players = players;
      disposeAvatars();
      const specs = Array.isArray(c.avatars) ? c.avatars : [];
      const anchors = {};
      for (let s = 1; s < players; s++) {
        const spec = Object.assign({}, DEFAULT_AVATARS[players === 2 ? 1 : s] || {}, specs.find((a) => a && a.seat === s) || {});
        const args = Object.assign({}, spec, { seat: s, position: ctx.seatPosition(s), facing: ctx.seatFacing(s) });
        let av = null;
        try {
          if (Truco.Avatars && typeof Truco.Avatars.create === 'function') av = Truco.Avatars.create(ctx, args);
        } catch (e) {
          report(e, 'Avatars.create');
          av = null;
        }
        avatars[s] = av && av.cardAnchor ? av : fallbackAvatar(s);
        anchors[s] = avatars[s].cardAnchor;
      }
      cards.setSeats(players, anchors);
      ctx.table.keepOut = cards.keepOut();
      if (world.setPlayers) world.setPlayers(players);
      currentTurn = null;
      frameCamera();
    }

    // ------------------------------------------------------------------ câmera
    const view = {
      width: 1,
      height: 1,
      basePos: new THREE.Vector3(0, 6, 7),
      baseTarget: new THREE.Vector3(0, 0, 0),
      mouse: new THREE.Vector2(),
      mouseSmooth: new THREE.Vector2(),
      punch: { push: 0, roll: 0, fov: 0 },
      baseFov: 40,
    };

    function framePoints(headRoom, bodyOut) {
      const pts = [];
      for (let s = 1; s < players; s++) {
        const a = avatars[s];
        const p = a ? a.headWorldPos(new THREE.Vector3()) : ctx.seatPosition(s).add(new THREE.Vector3(0, HEAD_Y_ESTIMATE, 0));
        pts.push({ p, r: headRoom, kind: 'head' });
        const d = seatDir(s, players);
        if (d[0] !== 0 && bodyOut > 0) {
          // Ombro/braço de fora dos laterais: só limita a largura.
          const b = ctx.seatPosition(s);
          pts.push({ p: new THREE.Vector3(b.x + d[0] * bodyOut, CAMERA.bodyY, b.z + d[1] * bodyOut), r: 0, kind: 'body' });
        }
      }
      const half = table.info.size.w / 2;
      for (const sx of [-1, 1]) {
        pts.push({ p: new THREE.Vector3(sx * half, table.info.rimTopY, -half), r: 0, kind: 'far' });
        pts.push({ p: new THREE.Vector3(sx * half, table.info.rimTopY, 0), r: 0, kind: 'side' });
      }
      const slot = cards.slotWorld(0, 2);
      pts.push({ p: new THREE.Vector3(0, 0, slot.z + 0.2), r: 0, kind: 'near' });
      return pts;
    }

    const tmpP = new THREE.Vector3();
    const camRight = new THREE.Vector3();
    const camUp = new THREE.Vector3();

    function placeCamera(D, tz, elev) {
      view.baseTarget.set(0, 0, tz);
      view.basePos.set(0, Math.sin(elev) * D, tz + Math.cos(elev) * D);
      camera.position.copy(view.basePos);
      camera.up.set(0, 1, 0);
      camera.lookAt(view.baseTarget);
      camera.updateMatrixWorld(true);
    }

    function fits(points, limits) {
      camRight.setFromMatrixColumn(camera.matrixWorld, 0);
      camUp.setFromMatrixColumn(camera.matrixWorld, 1);
      let ok = true;
      let minNear = Infinity;
      let maxTop = -Infinity;
      for (const it of points) {
        tmpP.copy(it.p).project(camera);
        if (tmpP.z > 1 || tmpP.z < -1) return { ok: false };
        let rx = 0;
        let ry = 0;
        if (it.r) {
          const e = tmpP.clone();
          const up = it.p.clone().addScaledVector(camUp, it.r).project(camera);
          const side = it.p.clone().addScaledVector(camRight, it.r).project(camera);
          ry = Math.abs(up.y - e.y);
          rx = Math.abs(side.x - e.x);
        }
        if (Math.abs(tmpP.x) + rx > limits.xMax) ok = false;
        if (it.kind === 'head' && limits.hud && hitsHud(it.p, tmpP, limits)) ok = false;
        if (it.kind === 'head' || it.kind === 'far') {
          maxTop = Math.max(maxTop, tmpP.y + ry);
          if (tmpP.y + ry > limits.yMax) ok = false;
        }
        if (it.kind === 'near') {
          minNear = Math.min(minNear, tmpP.y);
          if (tmpP.y < limits.yMin) ok = false;
        }
      }
      return { ok, minNear, maxTop };
    }

    const hudP = new THREE.Vector3();
    /** O rosto (cabeça em p; ndc = p projetado) invade algum canto do HUD (limits.hud, px CSS)? */
    function hitsHud(p, ndc, limits) {
      const W = limits.w;
      const H = limits.h;
      const face = CAMERA.hudFace || { r: 0.8, up: 0.45 };
      const rx = Math.abs(hudP.copy(p).addScaledVector(camRight, face.r).project(camera).x - ndc.x);
      const topY = hudP.copy(p).addScaledVector(camUp, face.up).project(camera).y;
      const x0 = ((ndc.x - rx + 1) / 2) * W;
      const x1 = ((ndc.x + rx + 1) / 2) * W;
      const top = ((1 - topY) / 2) * H;
      for (const b of limits.hud) {
        const bh = Math.min(b.h, (b.hFrac || 1) * H);
        if (top >= bh) continue;
        if (b.side < 0 ? x0 < b.w : x1 > W - b.w) return true;
      }
      return false;
    }

    /** Enquadramento: acha a câmera mais próxima que mostra avatares, mesa e a área de jogo acima da mão. */
    function frameCamera() {
      const w = Math.max(1, view.width);
      const h = Math.max(1, view.height);
      const aspect = w / h;
      const L = CAMERA.landscape;
      const Pt = CAMERA.portrait;
      const t = clamp((aspect - Pt.aspect) / (L.aspect - Pt.aspect), 0, 1);
      const elev0 = lerp(Pt.elev, L.elev, t);
      const fov = lerp(Pt.fov, L.fov, t);
      view.baseFov = fov;
      camera.fov = fov;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      cards.setHandFrame({ fov, aspect });
      const handTop = -1 + 2 * cards.handTopFraction();
      // yMax: limite de cima (NDC) para cabeças e fundo da mesa, abaixo dos painéis do HUD.
      // handPad: folga (NDC) entre a área de jogo do humano e a mão; em retrato cabe a faixa de botões.
      const limits = {
        xMax: lerp(Pt.xMax, L.xMax, t),
        yMax: lerp(Pt.yMax, L.yMax, t),
        yMin: handTop + lerp(Pt.handPad, L.handPad, t),
        w,
        h,
        hud: aspect >= (CAMERA.hudAspect || 1) && Array.isArray(CAMERA.hud) && CAMERA.hud.length ? CAMERA.hud : null,
      };
      const points = framePoints(lerp(Pt.headRoom, L.headRoom, t), lerp(Pt.bodyOut, L.bodyOut, t));
      const maxY = CAMERA.maxY > 0 ? CAMERA.maxY : Infinity;
      // Se a câmera sairia acima do teto (o toldo), baixa a elevação até caber.
      let best = null;
      let elev = 0;
      for (let deg = elev0; deg >= Math.min(elev0, 30); deg -= 1) {
        elev = (deg * Math.PI) / 180;
        best = solveFrame(points, limits, elev);
        if (Math.sin(elev) * best.D <= maxY) break;
      }
      placeCamera(best.D, best.tz, elev);
    }

    function solveFrame(points, limits, elev) {
      const found = [];
      for (let tz = -2.4; tz <= 3.01; tz += 0.2) {
        let lo = 3;
        let hi = 90;
        placeCamera(hi, tz, elev);
        if (!fits(points, limits).ok) continue;
        for (let k = 0; k < 24; k++) {
          const mid = (lo + hi) / 2;
          placeCamera(mid, tz, elev);
          if (fits(points, limits).ok) hi = mid;
          else lo = mid;
        }
        placeCamera(hi, tz, elev);
        const f = fits(points, limits);
        found.push({ D: hi, tz, center: (f.minNear + f.maxTop) / 2 });
      }
      // Menor distância possível; havendo folga vertical (retrato), centraliza o conteúdo na faixa livre.
      let best = { D: 16, tz: 0, center: 0 };
      if (found.length) {
        const minD = Math.min(...found.map((f) => f.D));
        const mid = (limits.yMin + limits.yMax) / 2;
        const near = found.filter((f) => f.D <= minD * 1.02);
        best = near.reduce((a, b) => (Math.abs(b.center - mid) < Math.abs(a.center - mid) ? b : a));
      }
      return best;
    }

    function resize() {
      const rect = stageEl.getBoundingClientRect();
      let w = Math.round(rect.width);
      let h = Math.round(rect.height);
      if (w < 2 || h < 2) {
        w = root.innerWidth || 800;
        h = root.innerHeight || 600;
      }
      if (w === view.width && h === view.height) return;
      view.width = w;
      view.height = h;
      renderer.setSize(w, h, false);
      frameCamera();
    }

    let resizeObserver = null;
    if (typeof root.ResizeObserver === 'function') {
      resizeObserver = new root.ResizeObserver(() => resize());
      resizeObserver.observe(stageEl);
    }
    const onWindowResize = () => resize();
    root.addEventListener('resize', onWindowResize);

    function updateCamera(dt, t) {
      const reduced = Tween.prefersReducedMotion();
      const k = 1 - Math.exp(-dt * 3);
      view.mouseSmooth.x += ((reduced ? 0 : view.mouse.x) - view.mouseSmooth.x) * k;
      view.mouseSmooth.y += ((reduced ? 0 : view.mouse.y) - view.mouseSmooth.y) * k;
      const breathe = reduced ? 0 : 1;
      camera.position.copy(view.basePos);
      camera.position.x += view.mouseSmooth.x * 0.35 + Math.sin(t * 0.37) * 0.03 * breathe;
      camera.position.y += -view.mouseSmooth.y * 0.2 + Math.sin(t * 0.83) * 0.025 * breathe;
      tmpP.copy(view.baseTarget);
      tmpP.x += view.mouseSmooth.x * 0.08;
      camera.up.set(Math.sin(view.punch.roll), Math.cos(view.punch.roll), 0);
      camera.lookAt(tmpP);
      if (view.punch.push) {
        tmpP.set(0, 0, -1).applyQuaternion(camera.quaternion);
        camera.position.addScaledVector(tmpP, view.punch.push);
      }
      const fov = view.baseFov + view.punch.fov;
      if (Math.abs(camera.fov - fov) > 1e-4) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    }

    // ------------------------------------------------------------------ picking da mão do humano
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const playListeners = [];
    let pressed = -1;
    const BLOCKING = 'button, a, input, select, textarea, label, [role="button"], [role="dialog"], dialog, [data-block-3d]';

    function pointerAllowed(e) {
      if (e.target === canvas) return true;
      const tgt = e.target;
      if (tgt && tgt.closest && tgt.closest(BLOCKING)) return false;
      const r = canvas.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    }

    function pickAt(e) {
      const r = canvas.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return -1;
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      camera.updateMatrixWorld(true);
      raycaster.setFromCamera(ndc, camera);
      return cards.pickHuman(raycaster);
    }

    function onPointerMove(e) {
      if (disposed) return;
      if (e.pointerType === 'mouse') cards.setPointerKind('mouse');
      const r = canvas.getBoundingClientRect();
      if (e.pointerType === 'mouse' && r.width > 0) {
        view.mouse.set(clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1), clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1));
      }
      if (e.pointerType === 'touch') return;
      const idx = pointerAllowed(e) && cards.isInteractive() ? pickAt(e) : -1;
      cards.setHover(idx);
      canvas.style.cursor = idx >= 0 ? 'pointer' : '';
    }

    function onPointerDown(e) {
      if (!disposed && e.pointerType) cards.setPointerKind(e.pointerType);
      if (disposed || !pointerAllowed(e) || !cards.isInteractive()) {
        pressed = -1;
        return;
      }
      pressed = pickAt(e);
      if (pressed >= 0 && e.pointerType === 'touch') cards.setHover(pressed);
    }

    function onPointerUp(e) {
      if (disposed) return;
      const was = pressed;
      pressed = -1;
      if (was < 0 || !pointerAllowed(e)) return;
      const idx = pickAt(e);
      if (idx !== was) {
        if (e.pointerType === 'touch') cards.setHover(-1);
        return;
      }
      const req = cards.requestPlay(idx);
      canvas.style.cursor = '';
      if (!req) return;
      for (const cb of playListeners.slice()) {
        try {
          cb(req.cardId, { index: req.index });
        } catch (err) {
          report(err, 'onHumanPlay');
        }
      }
    }

    function onPointerCancel() {
      pressed = -1;
      cards.setHover(-1);
    }

    root.addEventListener('pointermove', onPointerMove, { passive: true });
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointercancel', onPointerCancel);

    // Efeito da galáxia do Seis (Truco.Galaxy), criado só na primeira vez que alguém grita seis.
    let galaxy = null;

    // ------------------------------------------------------------------ laço
    let time = 0;
    let rafId = 0;
    let last = 0;
    let lastTick = 0;

    function tick(dt) {
      time += dt;
      Tween.update(dt);
      try {
        world.update(dt, time);
      } catch (e) {
        world.update = () => {};
        report(e, 'World.update');
      }
      Object.keys(avatars).forEach((s) => avatars[s].update(dt, time));
      cards.update(dt, time);
      if (galaxy) galaxy.update(dt * Math.max(0, Tween.speed || 1));
      updateCamera(dt, time);
    }

    function now() {
      return root.performance && root.performance.now ? root.performance.now() : Date.now();
    }

    function frame(ts) {
      if (disposed) return;
      rafId = root.requestAnimationFrame(frame);
      const n = typeof ts === 'number' ? ts : now();
      const dt = last ? Math.min(0.1, Math.max(0, (n - last) / 1000)) : 1 / 60;
      last = n;
      lastTick = now();
      tick(dt);
      renderer.render(scene3, camera);
    }

    // Se o rAF parar (aba em segundo plano), o relógio das animações segue para nenhuma promessa ficar pendurada.
    const fallbackTimer = root.setInterval(() => {
      if (disposed) return;
      const n = now();
      const gap = n - lastTick;
      if (gap > 300) {
        lastTick = n;
        last = 0;
        tick(Math.min(0.5, gap / 1000));
      }
    }, 250);

    resize();
    lastTick = now();
    rafId = root.requestAnimationFrame(frame);

    // ------------------------------------------------------------------ utilidades da API
    let currentTurn = null;

    function guarded(promise, seconds) {
      const safe = Promise.resolve(promise).catch((err) => report(err, 'cena'));
      const speed = Math.max(0.1, Tween.speed || 1);
      return Tween.guard(safe, seconds / speed + 4).then(() => undefined);
    }

    function lookAll(seat) {
      const camPos = camera.getWorldPosition(new THREE.Vector3());
      Object.keys(avatars).forEach((k) => {
        const s = Number(k);
        const a = avatars[s];
        if (seat == null) {
          a.lookAt(null);
          a.setTurn(false);
        } else if (seat === s) {
          a.lookAt(cards.slotWorld(s, 1));
          a.setTurn(true);
        } else {
          a.setTurn(false);
          // Olham para quem está na vez; às vezes para o humano (o rosto fica para a câmera).
          if (seat === 0 || Math.random() < 0.3) a.lookAt(camPos);
          else if (avatars[seat]) a.lookAt(avatars[seat].headWorldPos(new THREE.Vector3()));
          else a.lookAt(null);
        }
      });
    }

    const api = {
      setup(cfg) {
        setup(cfg);
      },

      dealHand(opts) {
        const n = players * 3;
        return guarded(cards.dealHand(opts || {}), 3.5 + n * 0.2);
      },

      playCard(seat, card, opts) {
        const slot = cards.slotWorld(seat, 1);
        const camPos = camera.getWorldPosition(new THREE.Vector3());
        const playerHead = avatars[seat] ? avatars[seat].headWorldPos(new THREE.Vector3()) : camPos;
        Object.keys(avatars).forEach((k) => {
          const s = Number(k);
          if (s === seat) return;
          // Só parte dos outros acompanha a carta (o parceiro de quem jogou sempre); os demais olham
          // para quem jogou (giro limitado no avatar) ou para o humano, com o rosto para a câmera.
          const partner = players === 4 && s === (seat + 2) % 4;
          const r = Math.random();
          if (partner || r < 0.4) avatars[s].lookAt(slot);
          else if (r < 0.7) avatars[s].lookAt(playerHead);
          else avatars[s].lookAt(camPos);
        });
        return guarded(cards.playCard(seat, card, opts || {}), 2);
      },

      markRoundWinner(roundIndex, winnerSeat) {
        return guarded(cards.markRoundWinner(roundIndex, winnerSeat == null ? null : winnerSeat), 2);
      },

      clearTable() {
        return guarded(cards.clearTable(), 4);
      },

      setHumanHand(cardsList, opts) {
        cards.setHumanHand(cardsList || [], opts || {});
      },

      onHumanPlay(cb) {
        if (typeof cb === 'function') playListeners.push(cb);
        return () => {
          const i = playListeners.indexOf(cb);
          if (i >= 0) playListeners.splice(i, 1);
        };
      },

      setFaceDownMode(on) {
        cards.setFaceDownMode(!!on);
      },

      showPartnerHand(list) {
        return guarded(cards.showPartnerHand(list || null), 2);
      },

      setScore(score, opts) {
        return guarded(cards.setScore(score, opts), 6);
      },

      avatarAct(seat, kind) {
        const a = avatars[seat];
        if (!a) return Promise.resolve();
        return guarded(a.act(kind), 4);
      },

      /** Sinal de truco do parceiro (docs/PERSONAGENS.md): um gesto de ~1 s olhando para a câmera. */
      avatarSignal(seat, gesto) {
        const a = avatars[seat];
        if (!a || typeof a.signal !== 'function') return Promise.resolve();
        return guarded(a.signal(gesto), 3);
      },

      seatScreenPos(seat) {
        const w = view.width;
        const h = view.height;
        if (seat === 0 || !avatars[seat]) {
          return { x: w / 2, y: h * (1 - cards.handTopFraction()) };
        }
        camera.updateMatrixWorld(true);
        const p = avatars[seat].headWorldPos(new THREE.Vector3());
        p.y += 0.95;
        p.project(camera);
        return { x: clamp(((p.x + 1) / 2) * w, 8, w - 8), y: clamp(((1 - p.y) / 2) * h, 8, h - 8) };
      },

      setTurn(seat) {
        const valid = seat != null && seat >= 0 && seat < players;
        currentTurn = valid ? seat : null;
        cards.setTurn(currentTurn);
        lookAll(currentTurn);
      },

      /** Galáxia de estrelas que forma um 6 sobre a mesa; resolve quando some. */
      galaxySix() {
        if (!Truco.Galaxy) return Promise.resolve();
        try {
          if (!galaxy) galaxy = Truco.Galaxy.create(ctx);
          return galaxy.play({ center: new THREE.Vector3(0, 0, 0) });
        } catch (e) {
          report(e, 'galáxia do seis');
          return Promise.resolve();
        }
      },

      cameraPunch() {
        if (Tween.prefersReducedMotion()) return Promise.resolve();
        const p = view.punch;
        Tween.kill(p);
        return Tween.to(p, { push: 0.7, fov: -2.2, roll: 0.018 }, { duration: 0.07, ease: 'outQuad' })
          .then(() => Tween.to(p, { push: -0.12, fov: 0.4, roll: -0.008 }, { duration: 0.16, ease: 'inOutSine' }))
          .then(() => Tween.to(p, { push: 0, fov: 0, roll: 0 }, { duration: 0.3, ease: 'outCubic' }));
      },

      setSpeed(mult) {
        const m = Number(mult);
        Tween.speed = isFinite(m) && m > 0 ? clamp(m, 0.1, 10) : 1;
      },

      setQuality(q) {
        const next = q === 'low' ? 'low' : 'high';
        if (next === quality) return;
        quality = next;
        ctx.quality = quality;
        if (galaxy) galaxy.setQuality(quality);
        renderer.setPixelRatio(pixelRatioFor(quality));
        applyShadowQuality();
        scene3.traverse((obj) => {
          const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
          mats.forEach((m) => {
            m.needsUpdate = true;
          });
        });
        // Texturas grandes acompanham a qualidade (tampo, cenário e cartas).
        for (const [fn, where] of [
          [() => table.setQuality && table.setQuality(quality), 'Table.setQuality'],
          [() => world.setQuality && world.setQuality(quality), 'World.setQuality'],
          [() => Truco.CardTex && Truco.CardTex.setQuality && Truco.CardTex.setQuality(quality), 'CardTex.setQuality'],
        ]) {
          try {
            fn();
          } catch (e) {
            report(e, where);
          }
        }
        view.width = 0;
        resize();
        // Pré-compila os shaders novos fora do quadro (evita o tranco na primeira renderização).
        const parallel = renderer.extensions && renderer.extensions.has && renderer.extensions.has('KHR_parallel_shader_compile');
        if (parallel && typeof renderer.compileAsync === 'function') {
          Promise.resolve(renderer.compileAsync(scene3, camera)).catch(() => {});
        }
      },

      /**
       * Extra: avisa perda e restauração do contexto WebGL: cb('lost' | 'restored'). Devolve a
       * função que cancela a inscrição. A cena já se recupera sozinha; o HUD pode pausar/avisar.
       */
      onContext(cb) {
        if (typeof cb === 'function') contextListeners.push(cb);
        return () => {
          const i = contextListeners.indexOf(cb);
          if (i >= 0) contextListeners.splice(i, 1);
        };
      },

      /** Extra: ouvir efeitos sonoros sincronizados com as animações ('shuffle','deal','flip','place','slide','bean','hover'). */
      onSfx(cb) {
        if (typeof cb === 'function') sfxListeners.push(cb);
        return () => {
          const i = sfxListeners.indexOf(cb);
          if (i >= 0) sfxListeners.splice(i, 1);
        };
      },

      /** Extra: repassa um evento de jogo ao World (ex.: 'truco' para a luz tremer), se ele souber tratar. */
      worldEvent(name, data) {
        if (world.onEvent) world.onEvent(name, data);
      },

      getRenderer() {
        return renderer;
      },

      getCamera() {
        return camera;
      },

      /** Só para testes: refaz o enquadramento (depois de mudar Scene.CAMERA). */
      debugReframe() {
        frameCamera();
        const pts = framePoints(0, 0).map((it) => {
          const v = it.p.clone().project(camera);
          return [it.kind, +v.x.toFixed(2), +v.y.toFixed(2)];
        });
        return { pos: view.basePos.toArray(), target: view.baseTarget.toArray(), fov: view.baseFov, pts };
      },

      /** Só para testes: posições em px das cartas da mão do humano. */
      debugHandScreenPoints() {
        camera.updateMatrixWorld(true);
        return cards.handScreenPoints().map((p) => {
          p.project(camera);
          return { x: ((p.x + 1) / 2) * view.width, y: ((1 - p.y) / 2) * view.height };
        });
      },

      dispose() {
        if (disposed) return;
        disposed = true;
        root.cancelAnimationFrame(rafId);
        root.clearInterval(fallbackTimer);
        if (resizeObserver) resizeObserver.disconnect();
        root.removeEventListener('resize', onWindowResize);
        root.removeEventListener('pointermove', onPointerMove);
        root.removeEventListener('pointerdown', onPointerDown);
        root.removeEventListener('pointerup', onPointerUp);
        root.removeEventListener('pointercancel', onPointerCancel);
        canvas.removeEventListener('webglcontextlost', onContextLost, false);
        canvas.removeEventListener('webglcontextrestored', onContextRestored, false);
        contextListeners.length = 0;
        if (galaxy) galaxy.dispose();
        Tween.killAll();
        disposeAvatars();
        cards.dispose();
        try {
          world.dispose();
        } catch (e) {
          report(e, 'World.dispose');
        }
        table.dispose();
        if (envRT) envRT.dispose();
        if (scene3.environment === ctx.envMap) scene3.environment = null;
        renderer.dispose();
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        playListeners.length = 0;
        sfxListeners.length = 0;
      },
    };

    setup({ players, avatars: o.avatars });
    return api;
  }

  const Scene = { create, SEAT_RADIUS, CAMERA };
  Truco.Scene = Scene;
  if (typeof module === 'object' && module.exports) module.exports = Scene;
})(typeof window !== 'undefined' ? window : globalThis);
