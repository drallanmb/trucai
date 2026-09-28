/*
 * TrucAÍ — Truco.Table: a mesa de jogo. Segundo docs/DESIGN.md (v2, boteco paulistano):
 * mesa quadrada de ferro dobrável pintada de vermelho, com a marca fictícia de cerveja "Garoa"
 * no centro do tampo, arranhões, marcas de copo e pés de ferro em X. Tudo procedural.
 *
 *   Table.DIM                         // medidas (1 unidade = 10 cm; tampo em y = 0)
 *   Table.build(ctx) -> { group, top, info, setQuality(q), dispose() }
 *   Table.tex.makeCanvas(w, h) / noise(seed) / mulberry32(seed) / canvasTexture(THREE, canvas, opts)
 *
 * A mesa é parte da base da cena (não do World); quem cuidar do ambiente pode refiná-la aqui,
 * mantendo DIM.topY = 0 e o tamanho útil (slots, monte e placar dependem disso).
 */
(function (root) {
  'use strict';
  const Truco = (root.Truco = root.Truco || {});

  const DIM = Object.freeze({
    size: 7.0, // tampo 70 × 70 cm
    cornerRadius: 0.16,
    topY: 0,
    lip: 0.3, // aba dobrada do tampo
    floorY: -7.4,
  });

  const COLORS = Object.freeze({
    paint: '#B3261E',
    logoYellow: '#F2C230',
    logoWhite: '#FFFFFF',
    iron: '#5c1410',
  });

  // ---------------------------------------------------------------------------
  // Utilidades de canvas e ruído (também usadas pelo World)
  // ---------------------------------------------------------------------------

  function makeCanvas(w, h) {
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    throw new Error('Table: canvas indisponível');
  }

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

  /** Ruído de valor 2D com fbm (0..1); com período, a textura emenda sem costura. */
  function noise(seed) {
    const rand = mulberry32(seed || 1);
    const SIZE = 256;
    const perm = new Uint8Array(SIZE * 2);
    const vals = new Float32Array(SIZE);
    for (let i = 0; i < SIZE; i++) {
      perm[i] = i;
      vals[i] = rand();
    }
    for (let i = SIZE - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = perm[i];
      perm[i] = perm[j];
      perm[j] = t;
    }
    for (let i = 0; i < SIZE; i++) perm[i + SIZE] = perm[i];
    const lattice = (ix, iy) => vals[perm[(perm[ix & 255] + iy) & 511]];
    const wrap = (i, p) => (p ? ((i % p) + p) % p : i);
    function value(x, y, px, py) {
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const a = lattice(wrap(x0, px), wrap(y0, py));
      const b = lattice(wrap(x0 + 1, px), wrap(y0, py));
      const c = lattice(wrap(x0, px), wrap(y0 + 1, py));
      const d = lattice(wrap(x0 + 1, px), wrap(y0 + 1, py));
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
    return function fbm(x, y, octaves, px, py) {
      let sum = 0;
      let amp = 0.5;
      let norm = 0;
      let f = 1;
      const n = octaves || 4;
      for (let o = 0; o < n; o++) {
        sum += amp * value(x * f, y * f, px ? px * f : 0, py ? py * f : 0);
        norm += amp;
        amp *= 0.5;
        f *= 2;
      }
      return sum / norm;
    };
  }

  function canvasTexture(THREE, canvas, opts) {
    const o = opts || {};
    const tex = new THREE.CanvasTexture(canvas);
    if (o.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = o.wrap === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    if (o.repeat) tex.repeat.set(o.repeat[0], o.repeat[1]);
    tex.anisotropy = o.anisotropy || 8;
    tex.needsUpdate = true;
    return tex;
  }

  /** Fonte pronta = família declarada E carregada (document.fonts.check devolve true sem nenhuma declarada). */
  function fontReady(font) {
    const U = Truco.GfxUtil;
    if (U && U.fontsReady) return U.fontsReady([font]);
    try {
      return typeof document === 'undefined' || !document.fonts || document.fonts.check(font);
    } catch (e) {
      return true;
    }
  }

  // ---------------------------------------------------------------------------
  // Textura do tampo: tinta vermelha gasta + logo "Garoa" + marcas de copo e arranhões
  // ---------------------------------------------------------------------------

  const LOGO_FONT = '400 150px Shrikhand, "Cooper Black", Georgia, serif';
  const SUB_FONT = '700 44px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';

  function paintTop(S, seed) {
    const color = makeCanvas(S, S);
    const rough = makeCanvas(S, S);
    const bump = makeCanvas(S, S);
    const g = color.getContext('2d');
    const r = rough.getContext('2d');
    const b = bump.getContext('2d');
    const rnd = mulberry32(seed);
    const fbm = noise(seed + 3);
    const k = S / 1024;

    // Tinta: vermelho com manchas suaves e pinceladas horizontais (calculado em 512 e ampliado).
    const B = 512;
    const baseCanvas = makeCanvas(B, B);
    const bg = baseCanvas.getContext('2d');
    const img = bg.createImageData(B, B);
    const base = [0xb3, 0x26, 0x1e];
    for (let y = 0; y < B; y++) {
      for (let x = 0; x < B; x++) {
        const n = fbm((x / B) * 6, (y / B) * 6, 4) - 0.5;
        const streak = fbm((x / B) * 2, (y / B) * 90, 2) - 0.5;
        const u = x / B - 0.5;
        const v = y / B - 0.5;
        const edge = Math.max(Math.abs(u), Math.abs(v));
        const worn = edge > 0.46 ? (edge - 0.46) * 5 : 0;
        const f = 1 + n * 0.16 + streak * 0.06 - worn * 0.25;
        const i = (y * B + x) * 4;
        img.data[i] = base[0] * f;
        img.data[i + 1] = base[1] * f;
        img.data[i + 2] = base[2] * f;
        img.data[i + 3] = 255;
      }
    }
    bg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(baseCanvas, 0, 0, S, S);
    r.fillStyle = 'rgb(140,140,140)';
    r.fillRect(0, 0, S, S);
    b.fillStyle = 'rgb(128,128,128)';
    b.fillRect(0, 0, S, S);

    // Logo no centro: faixa amarela e "Garoa" em letra cursiva branca.
    const cx = S / 2;
    const cy = S / 2;
    g.save();
    g.translate(cx, cy);
    g.rotate(-0.06);
    g.fillStyle = COLORS.logoYellow;
    g.beginPath();
    g.ellipse(0, 0, 330 * k, 150 * k, 0, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 12 * k;
    g.strokeStyle = COLORS.logoWhite;
    g.stroke();
    g.fillStyle = '#8f1b15';
    g.fillRect(-360 * k, -26 * k, 720 * k, 52 * k);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = LOGO_FONT.replace('150px', Math.round(150 * k) + 'px');
    g.lineWidth = 16 * k;
    g.strokeStyle = '#8f1b15';
    g.strokeText('Garoa', 0, 8 * k);
    g.fillStyle = COLORS.logoWhite;
    g.fillText('Garoa', 0, 8 * k);
    g.font = SUB_FONT.replace('44px', Math.round(44 * k) + 'px');
    if ('letterSpacing' in g) g.letterSpacing = Math.round(8 * k) + 'px';
    g.fillStyle = '#8f1b15';
    g.fillText('CERVEJA PILSEN · SÃO PAULO', 0, 112 * k);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.restore();
    // O logo é mais liso (tinta nova).
    r.fillStyle = 'rgb(110,110,110)';
    r.beginPath();
    r.ellipse(cx, cy, 330 * k, 150 * k, -0.06, 0, Math.PI * 2);
    r.fill();

    // Tinta descascada no logo e no tampo: pontinhos claros.
    for (let i = 0; i < 500; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const rr = (0.6 + rnd() * 2.2) * k;
      g.fillStyle = rnd() < 0.5 ? 'rgba(60, 20, 16, 0.35)' : 'rgba(255, 210, 190, 0.18)';
      g.beginPath();
      g.arc(x, y, rr, 0, Math.PI * 2);
      g.fill();
    }

    // Marcas redondas de copo (anéis) e gotas de condensação.
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2;
      const d = (0.22 + rnd() * 0.22) * S;
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      const rr = (30 + rnd() * 10) * k;
      const start = rnd() * Math.PI * 2;
      const span = Math.PI * (1.1 + rnd() * 0.9);
      g.lineWidth = (2 + rnd() * 3) * k;
      g.strokeStyle = 'rgba(40, 8, 6, 0.28)';
      g.beginPath();
      g.arc(x, y, rr, start, start + span);
      g.stroke();
      r.lineWidth = g.lineWidth * 2;
      r.strokeStyle = 'rgb(60,60,60)';
      r.beginPath();
      r.arc(x, y, rr, start, start + span);
      r.stroke();
      for (let j = 0; j < 8; j++) {
        const da = rnd() * Math.PI * 2;
        const dd = rr * (0.6 + rnd() * 0.7);
        g.fillStyle = 'rgba(255, 190, 170, 0.14)';
        g.beginPath();
        g.arc(x + Math.cos(da) * dd, y + Math.sin(da) * dd, (1.5 + rnd() * 3) * k, 0, Math.PI * 2);
        g.fill();
      }
    }

    // Arranhões: linhas finas claras (metal/primer aparecendo) com sulco no bump.
    for (let i = 0; i < 140; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const a = rnd() * Math.PI;
      const len = (10 + rnd() * 70) * k;
      const x2 = x + Math.cos(a) * len;
      const y2 = y + Math.sin(a) * len;
      const w = (0.6 + rnd() * 1.4) * k;
      g.lineWidth = w;
      g.strokeStyle = rnd() < 0.7 ? 'rgba(255, 200, 185, 0.22)' : 'rgba(150, 150, 150, 0.35)';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x2, y2);
      g.stroke();
      r.lineWidth = w * 1.5;
      r.strokeStyle = 'rgb(170,170,170)';
      r.beginPath();
      r.moveTo(x, y);
      r.lineTo(x2, y2);
      r.stroke();
      b.lineWidth = w * 1.5;
      b.strokeStyle = 'rgb(95,95,95)';
      b.beginPath();
      b.moveTo(x, y);
      b.lineTo(x2, y2);
      b.stroke();
    }

    // Lascas de tinta na borda (ferro escuro aparecendo).
    for (let i = 0; i < 40; i++) {
      const side = Math.floor(rnd() * 4);
      const t = rnd() * S;
      const depth = rnd() * 14 * k;
      const x = side === 0 ? depth : side === 1 ? S - depth : t;
      const y = side === 2 ? depth : side === 3 ? S - depth : t;
      g.fillStyle = 'rgba(45, 40, 38, 0.75)';
      g.beginPath();
      g.ellipse(x, y, (3 + rnd() * 10) * k, (2 + rnd() * 5) * k, rnd() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    return { color, rough, bump };
  }

  // ---------------------------------------------------------------------------
  // Geometria
  // ---------------------------------------------------------------------------

  function roundedRectShape(THREE, w, h, r) {
    const s = new THREE.Shape();
    const x = -w / 2;
    const y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);
    s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }

  function roundedRectPath(THREE, w, h, r) {
    const p = new THREE.Path();
    const x = -w / 2;
    const y = -h / 2;
    p.moveTo(x + r, y);
    p.quadraticCurveTo(x, y, x, y + r);
    p.lineTo(x, y + h - r);
    p.quadraticCurveTo(x, y + h, x + r, y + h);
    p.lineTo(x + w - r, y + h);
    p.quadraticCurveTo(x + w, y + h, x + w, y + h - r);
    p.lineTo(x + w, y + r);
    p.quadraticCurveTo(x + w, y, x + w - r, y);
    p.lineTo(x + r, y);
    return p;
  }

  /** Tubo de ferro entre dois pontos. */
  function tube(THREE, a, b, radius, material, radial) {
    const va = new THREE.Vector3().fromArray(a);
    const vb = new THREE.Vector3().fromArray(b);
    const dir = vb.clone().sub(va);
    const geo = new THREE.CylinderGeometry(radius, radius, dir.length(), radial || 10);
    const m = new THREE.Mesh(geo, material);
    m.position.copy(va).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  function build(ctx) {
    const THREE = ctx.THREE;
    const low = ctx.quality === 'low';
    const group = new THREE.Group();
    group.name = 'table';
    const S = DIM.size;
    const disposables = [];
    const track = (x) => {
      disposables.push(x);
      return x;
    };

    let texSize = low ? 1024 : 2048;
    const seed = 17;
    let disposed = false;
    let painted = paintTop(texSize, seed);
    const map = track(canvasTexture(THREE, painted.color, { wrap: false }));
    const roughnessMap = track(canvasTexture(THREE, painted.rough, { wrap: false, srgb: false }));
    const bumpMap = track(canvasTexture(THREE, painted.bump, { wrap: false, srgb: false }));
    /** Repinta o tampo (fontes novas ou outro tamanho); com outro tamanho a textura é recriada na GPU. */
    function repaint(size) {
      const resized = size !== texSize;
      texSize = size;
      painted = paintTop(texSize, seed);
      for (const [tex, img] of [
        [map, painted.color],
        [roughnessMap, painted.rough],
        [bumpMap, painted.bump],
      ]) {
        // r159 aloca a textura com texStorage2D (imutável): trocar o tamanho exige descartar antes.
        if (resized) tex.dispose();
        tex.image = img;
        tex.needsUpdate = true;
      }
    }
    // O logo usa Shrikhand (e o subtítulo Barlow Condensed): redesenha quando cada uma chegar.
    const U = Truco.GfxUtil;
    if (U && U.onFonts) U.onFonts([LOGO_FONT, SUB_FONT], () => repaint(texSize), () => !disposed);
    else if (!fontReady(LOGO_FONT) && typeof document !== 'undefined' && document.fonts && document.fonts.load) {
      Promise.all([document.fonts.load(LOGO_FONT, 'Garoa'), document.fonts.load(SUB_FONT, 'CERVEJA')]).then(
        () => {
          if (!disposed) repaint(texSize);
        },
        () => {}
      );
    }

    const topMat = track(
      new THREE.MeshStandardMaterial({
        map,
        roughnessMap,
        roughness: 1,
        bumpMap,
        bumpScale: 0.35,
        metalness: 0.1,
        envMapIntensity: 0.55,
      })
    );
    const paintMat = track(
      new THREE.MeshStandardMaterial({ color: new THREE.Color(COLORS.paint), roughness: 0.5, metalness: 0.2, envMapIntensity: 0.6 })
    );
    const ironMat = track(new THREE.MeshStandardMaterial({ color: new THREE.Color(COLORS.iron), roughness: 0.55, metalness: 0.45 }));

    // Tampo (y = 0) com UV 0..1 de ponta a ponta.
    const topGeo = track(new THREE.ShapeGeometry(roundedRectShape(THREE, S, S, DIM.cornerRadius), 6));
    topGeo.rotateX(-Math.PI / 2);
    const pos = topGeo.attributes.position;
    const uv = topGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / S + 0.5, 0.5 - pos.getZ(i) / S);
    uv.needsUpdate = true;
    const top = new THREE.Mesh(topGeo, topMat);
    top.name = 'tabletop';
    top.receiveShadow = true;
    group.add(top);

    // Aba dobrada (a chapa desce pelas bordas) com quina arredondada.
    const ring = roundedRectShape(THREE, S, S, DIM.cornerRadius);
    ring.holes.push(roundedRectPath(THREE, S - 0.08, S - 0.08, Math.max(0.02, DIM.cornerRadius - 0.04)));
    const lipGeo = track(
      new THREE.ExtrudeGeometry(ring, {
        depth: DIM.lip,
        bevelEnabled: true,
        bevelThickness: 0.025,
        bevelSize: 0.025,
        bevelSegments: low ? 2 : 3,
        curveSegments: low ? 4 : 8,
      })
    );
    lipGeo.rotateX(Math.PI / 2);
    lipGeo.translate(0, -0.026, 0);
    const lip = new THREE.Mesh(lipGeo, paintMat);
    lip.castShadow = true;
    lip.receiveShadow = true;
    group.add(lip);

    // Fundo do tampo.
    const under = new THREE.Mesh(track(new THREE.BoxGeometry(S - 0.1, 0.04, S - 0.1)), ironMat);
    under.position.y = -0.05;
    group.add(under);

    // Pés dobráveis em X nas laterais esquerda/direita, com barra no chão.
    const legR = 0.075;
    const topY = -0.08;
    const footY = DIM.floorY + legR;
    const inset = S / 2 - 0.35;
    for (const sx of [-1, 1]) {
      const x = sx * inset;
      group.add(tube(THREE, [x, topY, -inset], [x, footY, inset], legR, ironMat));
      group.add(tube(THREE, [x, topY, inset], [x, footY, -inset], legR, ironMat));
      group.add(tube(THREE, [x, footY, -inset - 0.2], [x, footY, inset + 0.2], legR * 0.9, ironMat));
    }
    group.add(tube(THREE, [-inset, topY - 0.1, -inset + 0.2], [inset, topY - 0.1, -inset + 0.2], legR * 0.7, ironMat));
    group.add(tube(THREE, [-inset, topY - 0.1, inset - 0.2], [inset, topY - 0.1, inset - 0.2], legR * 0.7, ironMat));

    ctx.scene.add(group);

    return {
      group,
      top,
      info: {
        topY: DIM.topY,
        rimTopY: DIM.topY,
        size: { w: S, d: S },
        playSize: { w: S - 0.4, d: S - 0.4 },
        floorY: DIM.floorY,
      },
      /** 'low' repinta o tampo em 1024 px; 'high' volta a 2048 (a textura é recriada na GPU). */
      setQuality(q) {
        const size = q === 'low' ? 1024 : 2048;
        if (size !== texSize && !disposed) repaint(size);
      },
      dispose() {
        disposed = true;
        ctx.scene.remove(group);
        group.traverse((o) => {
          if (o.geometry && disposables.indexOf(o.geometry) < 0) o.geometry.dispose();
        });
        disposables.forEach((d) => d.dispose());
      },
    };
  }

  const Table = {
    DIM,
    COLORS,
    build,
    tex: { makeCanvas, noise, mulberry32, canvasTexture },
    shapes: { roundedRectShape, roundedRectPath },
  };

  Truco.Table = Table;
  if (typeof module === 'object' && module.exports) module.exports = Table;
})(typeof window !== 'undefined' ? window : globalThis);
