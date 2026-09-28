/*
 * TrucAÍ — Truco.World: o entorno da mesa (docs/DESIGN.md v2: boteco paulistano à noite).
 *
 *   World.build(ctx) -> { group, update(dt, t), dispose(), setQuality(q), setPlayers(n), onEvent(name, data) }
 *
 * Contrato em docs/SCENE-INTERNALS.md §4. Tudo procedural (canvas + geometria), nada externo.
 *
 * Composição (1 unidade = 10 cm, tampo em y = 0, humano em +Z):
 *   - Calçada de ladrilho antiderrapante paulistano (placas de quadradinhos em relevo, brancas, pretas
 *     e divididas na diagonal, formando faixas em zigue-zague), úmida sob o toldo e molhada de garoa
 *     fora dele (brilho e poças num shader).
 *   - Direita (+X): fachada do boteco "TrucAÍ — Bar e Lanches", porta de aço enrolada,
 *     balcão virado para a calçada (letreiro "TRUCAÍ · BAR E LANCHES" na faixa vermelha da
 *     frente) com a estufa de salgados iluminada, azulejos, piso vermelho, prateleira com garrafas e
 *     espelho, ventilador de teto, freezer "Garoa" e plaquinha "FIADO SÓ AMANHÃ". A câmera do jogo
 *     olha de cima e não vê nada alto perto do bar: a TV com futebol fica num rack na calçada, na
 *     quina do prédio (TV_SPOT), e o cavalete com a lousa de preços do lado esquerdo (BOARD_SPOT).
 *   - Toldo sobre a mesa, com a luminária de alumínio (a SpotLight `key` da cena fica na lâmpada;
 *     em retrato a lâmpada sobe 2 un. para não encostar na cabeça da parceira).
 *   - Fundo (−Z): a mureta baixa com guarda-corpo de um mirante. Atrás dela, uma camada distante presa ao olho da câmera
 *     ("backdrop"): rua de baixo com poste de sódio, orelhão e placa azul, carros passando, o tapete
 *     de luzes da cidade, Copan, Edifício Itália e as antenas da Paulista piscando. A câmera do jogo
 *     olha a mesa de quem está sentado (~35°), então só uma faixa do fundo aparece; o backdrop se
 *     reposiciona a cada quadro para ocupar essa faixa, entre a borda de cima da tela e a mureta.
 *   - Mesa: pingado no copo americano, porta-guardanapo, garrafa de 600 ml no porta-garrafa com
 *     copo de cerveja, amendoim, paliteiro e tampinhas soltas (fora de ctx.table.keepOut).
 *   - Ao lado da mesa: engradados empilhados com a xicrinha de café (com vapor) e o açucareiro.
 *   - Cadeiras de ferro dobráveis "Garoa" atrás dos avatares (setPlayers mostra só as ocupadas).
 *   - Partículas: garoa só no fundo (rua de baixo, atrás da mureta; nada cai sobre a mesa, o toldo
 *     ou o bar), poeira no cone de luz e vapor ('high').
 *   - Mapa de ambiente próprio (PMREMGenerator.fromScene) em scene.environment, para reflexos em
 *     vidro e metal; o dispose devolve o ctx.envMap da cena. A névoa (scene.fog) também é daqui.
 *
 * Qualidade: 'low' desliga a poeira e as luzes interna e fria do bar, reduz o vapor e
 * repinta calçada, fachada e parede lateral em tamanho menor (ao vivo); criado em 'low', também
 * usa menos prédios/luzes no fundo (isso só muda recarregando).
 *
 * Eventos (scene.worldEvent): 'truco' faz a luminária balançar e piscar (a SpotLight acompanha);
 * 'contextRestored' (a cena manda depois da perda do contexto WebGL) refaz o PMREM do ambiente;
 * 'debugBackdrop' com { freeze: true|false } congela o fundo numa pose física (nivelado, abaixo
 * do mirante) para inspeção com câmera livre (tools/preview-scene.html?orbit=1).
 */
(function (root) {
  'use strict';
  const Truco = (root.Truco = root.Truco || {});

  const D2R = Math.PI / 180;

  // ---------------------------------------------------------------------------
  // Layout (puro, testável em node)
  // ---------------------------------------------------------------------------

  const LAYOUT = Object.freeze({
    murZ: -16, // face da mureta do mirante voltada para a mesa
    murH: 1.8, // mureta baixa com guarda-corpo de ferro em cima
    murT: 1.4,
    railH: 10.4,
    facadeX: 9.2, // fachada do bar (plano voltado para −X)
    barCornerZ: -11, // quina do prédio do bar (a parede lateral fica em z = −11)
    barFarZ: 34,
    barH: 42,
    opening: { z0: -9.8, z1: -1.4, h: 24 }, // vão da porta de aço, com o balcão
    counter: { x0: 9.35, x1: 11.6, h: 10.5 },
    awning: { x0: -8.5, x1: 9.2, z0: -10.5, z1: 12.5, yWall: 27.4, yEdge: 24.2 }, // alturas a partir do chão
    crate: { x: -5.6, z: 3.8, yaw: 0.1, w: 3.6, d: 3.1, h: 3.0 }, // engradados com a xicrinha (ao lado da mesa)
    chairBack: 0.45, // centro do assento da cadeira atrás do avatar
  });

  // Onde a câmera de paisagem (a do jogo) enxerga a TV e a lousa fora dos avatares e dos painéis do
  // HUD: a TV entre a parceira e o painel da vira, a lousa à esquerda, acima da cadeira do lateral.
  const TV_SPOT = Object.freeze({ x: 10.0, z: -13.2, h: 6.0 });
  const BOARD_SPOT = Object.freeze({ x: -16.0, z: -13.0, w: 3.6, h: 4.6 });

  /** Adereços sobre o tampo: centro (x, z) e raio da pegada. Precisam ficar fora de keepOut. */
  const TABLE_PROPS = Object.freeze([
    { id: 'pingado', x: -3.0, z: 2.3, r: 0.38 },
    { id: 'guardanapos', x: -2.15, z: 2.9, r: 0.55 },
    { id: 'garrafa', x: 2.95, z: 2.95, r: 0.48 },
    { id: 'cerveja', x: 1.98, z: 2.92, r: 0.38 },
    { id: 'amendoim', x: -1.5, z: -3.0, r: 0.5 },
    { id: 'paliteiro', x: 1.2, z: -3.05, r: 0.2 },
    { id: 'tampinha-a', x: 1.75, z: -2.9, r: 0.15 },
    { id: 'tampinha-b', x: 0.9, z: -3.25, r: 0.15 },
    { id: 'tampinha-c', x: -1.3, z: 3.25, r: 0.15 },
  ]);

  /**
   * Ladrilho da calçada paulistana (o antiderrapante de quadradinhos em relevo): placas quadradas de
   * `tile` un. (25 cm), cada uma com `bumps` × `bumps` quadradinhos separados por sulcos. Três tipos
   * de placa — toda branca, toda preta e dividida na diagonal (dois triângulos) — que, juntas,
   * desenham faixas em zigue-zague: a fronteira preto/branco é y + tri(x) = múltiplo de `band`, com
   * tri(x) uma onda triangular de amplitude `amp` placas e inclinação 1 (sempre na diagonal da
   * placa). O desenho se repete a cada `period` placas nos dois eixos (4 × 25 cm = 1 m).
   */
  const SIDEWALK = Object.freeze({ tile: 2.5, bumps: 8, amp: 2, band: 2, period: 4 });

  /** Cor do padrão no ponto (x, y), em placas: 0 = branco, 1 = preto (puro). */
  function sidewalkField(x, y) {
    const A = SIDEWALK.amp;
    const m = ((x % (2 * A)) + 2 * A) % (2 * A);
    const tri = A - Math.abs(m - A);
    const b = Math.floor((y + tri) / SIDEWALK.band);
    return ((b % 2) + 2) % 2;
  }

  /**
   * Tipo da placa (i, j) (puro): { kind: 'branca'|'preta'|'dividida', diag, a, b }.
   * diag 'anti' = diagonal de (i, j+1) a (i+1, j) — a = triângulo de baixo/esquerda (perto de (i, j)),
   * b = o de cima/direita; diag 'main' = de (i, j) a (i+1, j+1) — a = triângulo de cima/esquerda
   * (perto de (i, j+1)), b = o de baixo/direita. a e b: 0 = branco, 1 = preto.
   */
  function sidewalkTile(i, j) {
    const A = SIDEWALK.amp;
    const rising = ((i % (2 * A)) + 2 * A) % (2 * A) < A; // tri sobe na coluna: fronteira desce → anti
    const diag = rising ? 'anti' : 'main';
    const a = rising ? sidewalkField(i + 1 / 3, j + 1 / 3) : sidewalkField(i + 1 / 3, j + 2 / 3);
    const b = rising ? sidewalkField(i + 2 / 3, j + 2 / 3) : sidewalkField(i + 2 / 3, j + 1 / 3);
    return { kind: a !== b ? 'dividida' : a ? 'preta' : 'branca', diag, a, b };
  }

  const PRICES = [
    ['Cerveja 600 ml', 'R$ 12'],
    ['Pinga', 'R$ 5'],
    ['Porção de calabresa', 'R$ 30'],
    ['Cafezinho', 'R$ 3,00'],
    ['Pingado', 'R$ 5,00'],
    ['Pão na chapa', 'R$ 7,00'],
  ];

  const FONT_DISPLAY = 'Shrikhand, "Cooper Black", Georgia, serif';
  const FONT_COND = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';

  /** Distância de um círculo (x, z, r) a uma zona de keepOut (negativa = sobreposição). */
  function clearance(c, zone) {
    if (zone.kind === 'circle') return Math.hypot(c.x - zone.x, c.z - zone.z) - zone.r - c.r;
    const hx = zone.w / 2;
    const hz = zone.d / 2;
    const dx = Math.max(Math.abs(c.x - zone.x) - hx, 0);
    const dz = Math.max(Math.abs(c.z - zone.z) - hz, 0);
    return Math.hypot(dx, dz) - c.r;
  }

  /** Confere os adereços contra as zonas reservadas e a borda da mesa; devolve a lista de conflitos. */
  function checkProps(zones, halfSize) {
    const half = halfSize == null ? 3.5 : halfSize;
    const problems = [];
    for (const p of TABLE_PROPS) {
      if (Math.abs(p.x) + p.r > half || Math.abs(p.z) + p.r > half) problems.push({ id: p.id, zone: 'borda' });
      for (const z of zones || []) {
        if (clearance(p, z) < 0) problems.push({ id: p.id, zone: z });
      }
    }
    for (let i = 0; i < TABLE_PROPS.length; i++) {
      for (let j = i + 1; j < TABLE_PROPS.length; j++) {
        const a = TABLE_PROPS[i];
        const b = TABLE_PROPS[j];
        if (Math.hypot(a.x - b.x, a.z - b.z) < a.r + b.r) problems.push({ id: a.id, zone: b.id });
      }
    }
    return problems;
  }

  /** Faixa do fundo em ângulos de depressão (radianos): da borda de cima da tela até a mureta. */
  function backdropBand(eyeY, eyeZ, pitch, fovDeg, murTopY, murZ, out) {
    const o = out || {};
    const top = -(pitch + (fovDeg * D2R) / 2);
    let bottom = Math.atan2(eyeY - murTopY, eyeZ - murZ);
    if (!(bottom > top + 1.2 * D2R)) bottom = top + 9 * D2R;
    o.top = top;
    o.bottom = bottom;
    o.center = Math.max(2 * D2R, (top + bottom) / 2);
    o.k = Math.min(1.5, Math.max(0.45, (bottom - top) / (9 * D2R)));
    return o;
  }

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function hash1(n) {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  /** Fontes prontas = famílias declaradas E carregadas (check() devolve true sem nenhuma declarada). */
  function fontsReady(fonts) {
    const U = Truco.GfxUtil;
    if (U && U.fontsReady) return U.fontsReady(fonts);
    try {
      if (typeof document === 'undefined' || !document.fonts) return true;
      return fonts.every((f) => document.fonts.check(f));
    } catch (e) {
      return true;
    }
  }

  function tracker() {
    const list = [];
    return {
      track(x) {
        if (x && list.indexOf(x) < 0) list.push(x);
        return x;
      },
      dispose() {
        for (const x of list) {
          try {
            x.dispose();
          } catch (e) {
            /* recurso já liberado */
          }
        }
        list.length = 0;
      },
    };
  }

  /** Matriz a partir de posição, rotação (Euler XYZ) e escala. */
  function xf(THREE, x, y, z, rx, ry, rz, sx, sy, sz) {
    const s = sx == null ? 1 : sx;
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x || 0, y || 0, z || 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)),
      new THREE.Vector3(s, sy == null ? s : sy, sz == null ? s : sz)
    );
  }

  /** Junta várias geometrias (com transformação e cor opcionais) numa só: uma chamada de desenho. */
  function merge(THREE, parts, withColor) {
    let total = 0;
    const prepared = [];
    for (const p of parts) {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      if (p.m) g.applyMatrix4(p.m);
      if (!g.attributes.normal) g.computeVertexNormals();
      prepared.push({ g, c: p.c });
      total += g.attributes.position.count;
    }
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    const col = withColor ? new Float32Array(total * 3) : null;
    const tmpC = new THREE.Color();
    let o = 0;
    for (const { g, c } of prepared) {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      if (col) {
        tmpC.set(c == null ? 0xffffff : c);
        for (let i = 0; i < n; i++) {
          col[(o + i) * 3] = tmpC.r;
          col[(o + i) * 3 + 1] = tmpC.g;
          col[(o + i) * 3 + 2] = tmpC.b;
        }
      }
      o += n;
      g.dispose();
    }
    for (const p of parts) p.geo.dispose();
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
  }

  /** Geometria com normais por face (facetas nítidas mesmo depois de juntada a partes lisas). */
  function faceted(geo) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    g.computeVertexNormals();
    return g;
  }

  function lathe(THREE, pts, seg, phiStart, phiLength) {
    return new THREE.LatheGeometry(
      pts.map((p) => new THREE.Vector2(p[0], p[1])),
      seg,
      phiStart || 0,
      phiLength == null ? Math.PI * 2 : phiLength
    );
  }

  /** Cilindro entre dois pontos. */
  function rod(THREE, a, b, r, seg, r2) {
    const va = new THREE.Vector3().fromArray(a);
    const vb = new THREE.Vector3().fromArray(b);
    const dir = vb.clone().sub(va);
    const g = new THREE.CylinderGeometry(r2 == null ? r : r2, r, dir.length(), seg || 8);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    const mid = va.clone().addScaledVector(dir, 0.5);
    g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
    return g;
  }

  /** Plano com UV em unidades do mundo (para texturas que repetem por tamanho real). */
  function worldPlane(THREE, w, h, uScale, vScale) {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * uScale, uv.getY(i) * h * vScale);
    return g;
  }

  // ---------------------------------------------------------------------------
  // Pintura em canvas
  // ---------------------------------------------------------------------------

  function shade(rgb, f) {
    return 'rgb(' + rgb.map((v) => Math.round(clamp(v * f, 0, 255))).join(',') + ')';
  }

  /**
   * Calçada paulistana (foto de referência do usuário): SIDEWALK.period² placas de quadradinhos em
   * relevo — brancas, pretas e divididas na diagonal — formando as faixas em zigue-zague. Devolve
   * color (sRGB: preto e branco de verdade, desgaste, sujeira nos sulcos, chiclete e manchas) e
   * data (linear: R = altura para o bumpMap — quadradinho alto com bisel, sulco fundo, rejunte mais
   * fundo; G = aspereza para o roughnessMap — topo gasto e liso, sulco sujo e áspero).
   */
  function paintSidewalk(T, S) {
    const color = T.makeCanvas(S, S);
    const height = T.makeCanvas(S, S);
    const rough = T.makeCanvas(S, S);
    const g = color.getContext('2d');
    const h = height.getContext('2d');
    const r = rough.getContext('2d');
    const rnd = T.mulberry32(1966);
    const N = SIDEWALK.period;
    const nb = SIDEWALK.bumps;
    const t = S / N;
    const cell = t / nb;
    const joint = Math.max(1.5, t * 0.022); // rejunte entre placas
    const gap = Math.max(1.2, cell * 0.15); // sulco entre os quadradinhos
    const bevel = Math.max(0.6, cell * 0.06);
    // Preto e branco de verdade (croma baixo). Sulco do branco encardido (terra e fuligem).
    const PAL = [
      { top: [228, 228, 223], edge: [200, 198, 190], groove: [96, 90, 80] },
      { top: [40, 40, 41], edge: [28, 28, 28], groove: [12, 11, 10] },
    ];
    // Cada quadradinho tem um sorteio fixo (tom, lasca) para o mesmo valer na cor, altura e aspereza.
    const bumpsInfo = [];
    for (let k = 0; k < N * N * nb * nb; k++) {
      const chip = rnd() < 0.035 ? 1 + Math.floor(rnd() * 4) : 0; // canto lascado (1..4)
      bumpsInfo.push({ f: 0.92 + rnd() * 0.1, chip, worn: rnd() });
    }
    const info = (i, j, bx, by) => bumpsInfo[((j * N + i) * nb + by) * nb + bx];
    /** Quadradinho em (x, y) de lado s; lasca num canto (o canto vira sulco). */
    function bumpRect(ctx, x, y, s, chip) {
      ctx.beginPath();
      if (!chip) ctx.rect(x, y, s, s);
      else {
        const c = s * 0.45;
        const pts = [
          [x, y],
          [x + s, y],
          [x + s, y + s],
          [x, y + s],
        ];
        const k = chip - 1;
        pts.forEach((p, n) => {
          if (n !== k) return n === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]);
          const prev = pts[(n + 3) % 4];
          const next = pts[(n + 1) % 4];
          const a = [p[0] + Math.sign(prev[0] - p[0]) * c, p[1] + Math.sign(prev[1] - p[1]) * c];
          const b2 = [p[0] + Math.sign(next[0] - p[0]) * c, p[1] + Math.sign(next[1] - p[1]) * c];
          if (n === 0) ctx.moveTo(a[0], a[1]);
          else ctx.lineTo(a[0], a[1]);
          ctx.lineTo(b2[0], b2[1]);
        });
        ctx.closePath();
      }
      ctx.fill();
    }
    /** Pinta os quadradinhos da placa (i, j) com a paleta `pal` (a cor; a área já vem recortada). */
    function paintColor(i, j, pal, dirt) {
      const x0 = i * t;
      const y0 = j * t;
      g.fillStyle = shade(pal.groove, dirt);
      g.fillRect(x0, y0, t, t);
      for (let by = 0; by < nb; by++) {
        for (let bx = 0; bx < nb; bx++) {
          const q = info(i, j, bx, by);
          const x = x0 + bx * cell + gap / 2;
          const y = y0 + by * cell + gap / 2;
          const s = cell - gap;
          g.fillStyle = shade(pal.edge, q.f);
          bumpRect(g, x, y, s, q.chip);
          // Topo: gasto no meio (um pouco mais claro no preto, mais cinza no branco).
          const wornK = q.worn < 0.12 ? (pal === PAL[1] ? 1.25 : 0.93) : 1;
          g.fillStyle = shade(pal.top, q.f * wornK);
          bumpRect(g, x + bevel, y + bevel, s - 2 * bevel, q.chip);
        }
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const tile = sidewalkTile(i, j);
        const x0 = i * t;
        const y0 = j * t;
        const dirt = 0.85 + rnd() * 0.3;
        // Triângulos em px (y do canvas para baixo = +y das placas).
        const triA =
          tile.diag === 'anti'
            ? [[x0, y0], [x0 + t, y0], [x0, y0 + t]]
            : [[x0, y0 + t], [x0, y0], [x0 + t, y0 + t]];
        const triB =
          tile.diag === 'anti'
            ? [[x0 + t, y0 + t], [x0 + t, y0], [x0, y0 + t]]
            : [[x0 + t, y0], [x0, y0], [x0 + t, y0 + t]];
        for (const [tri, c] of [[triA, tile.a], [triB, tile.b]]) {
          g.save();
          g.beginPath();
          g.moveTo(tri[0][0], tri[0][1]);
          g.lineTo(tri[1][0], tri[1][1]);
          g.lineTo(tri[2][0], tri[2][1]);
          g.closePath();
          g.clip();
          paintColor(i, j, PAL[c], dirt);
          g.restore();
        }
        // Altura e aspereza não dependem da cor.
        h.fillStyle = 'rgb(60,60,60)';
        h.fillRect(x0, y0, t, t);
        r.fillStyle = 'rgb(255,255,255)';
        r.fillRect(x0, y0, t, t);
        for (let by = 0; by < nb; by++) {
          for (let bx = 0; bx < nb; bx++) {
            const q = info(i, j, bx, by);
            const x = x0 + bx * cell + gap / 2;
            const y = y0 + by * cell + gap / 2;
            const s = cell - gap;
            h.fillStyle = 'rgb(150,150,150)';
            bumpRect(h, x, y, s, q.chip);
            const top = Math.round(212 - (q.worn < 0.12 ? 18 : 0));
            h.fillStyle = 'rgb(' + top + ',' + top + ',' + top + ')';
            bumpRect(h, x + bevel, y + bevel, s - 2 * bevel, q.chip);
            const ro = Math.round(120 + q.worn * 60);
            r.fillStyle = 'rgb(' + ro + ',' + ro + ',' + ro + ')';
            bumpRect(r, x + bevel, y + bevel, s - 2 * bevel, q.chip);
          }
        }
      }
    }
    /** Desenha fn(x, y) e as cópias do outro lado das bordas (a textura repete sem emenda). */
    function wrapped(x, y, rad, fn) {
      for (const dx of [-S, 0, S]) {
        for (const dy of [-S, 0, S]) {
          if (x + dx + rad < 0 || x + dx - rad > S || y + dy + rad < 0 || y + dy - rad > S) continue;
          fn(x + dx, y + dy);
        }
      }
    }
    const px = S / 1024;
    // Encardido e manchas (sujeira acumula; o branco nunca é branco de azulejo).
    for (let i = 0; i < 46; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const rad = (20 + rnd() * 90) * px;
      const a = 0.05 + rnd() * 0.12;
      wrapped(x, y, rad, (cx, cy) => {
        const grd = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
        grd.addColorStop(0, 'rgba(46,36,26,' + a + ')');
        grd.addColorStop(1, 'rgba(46,36,26,0)');
        g.fillStyle = grd;
        g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      });
    }
    // Chiclete e pingos escuros (a calçada do centro tem de monte).
    for (let i = 0; i < 26; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const rad = (2.5 + rnd() * 5) * px;
      wrapped(x, y, rad, (cx, cy) => {
        g.fillStyle = 'rgba(38,34,32,' + (0.45 + rnd() * 0.3) + ')';
        g.beginPath();
        g.ellipse(cx, cy, rad, rad * (0.7 + rnd() * 0.3), rnd() * 3, 0, Math.PI * 2);
        g.fill();
        r.fillStyle = 'rgb(90,90,90)';
        r.beginPath();
        r.arc(cx, cy, rad, 0, Math.PI * 2);
        r.fill();
      });
    }
    // Poeira fina (mais visível no preto) e grão.
    for (let i = 0; i < 6000; i++) {
      const v = rnd();
      g.fillStyle = v < 0.5 ? 'rgba(0,0,0,' + rnd() * 0.18 + ')' : 'rgba(210,205,195,' + rnd() * 0.12 + ')';
      const s = (0.6 + rnd() * 1.4) * Math.max(1, px);
      g.fillRect(rnd() * S, rnd() * S, s, s);
    }
    // Rachaduras finas.
    g.lineCap = h.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      let x = rnd() * S * 0.8 + S * 0.1;
      let y = rnd() * S * 0.8 + S * 0.1;
      g.strokeStyle = 'rgba(15,12,10,0.6)';
      g.lineWidth = (0.8 + rnd()) * Math.max(1, px);
      h.strokeStyle = 'rgb(50,50,50)';
      h.lineWidth = g.lineWidth + 1;
      g.beginPath();
      h.beginPath();
      g.moveTo(x, y);
      h.moveTo(x, y);
      let a = rnd() * Math.PI * 2;
      for (let k = 0; k < 6; k++) {
        a += (rnd() - 0.5) * 1.2;
        x += Math.cos(a) * S * 0.018;
        y += Math.sin(a) * S * 0.018;
        g.lineTo(x, y);
        h.lineTo(x, y);
      }
      g.stroke();
      h.stroke();
    }
    // Rejunte entre as placas (mais fundo e mais áspero que os sulcos).
    g.fillStyle = '#2c2925';
    h.fillStyle = 'rgb(18,18,18)';
    r.fillStyle = 'rgb(255,255,255)';
    for (let k = 0; k <= N; k++) {
      const p = k * t - joint / 2;
      for (const c of [g, h, r]) {
        c.fillRect(p, 0, joint, S);
        c.fillRect(0, p, S, joint);
      }
    }
    // Junta altura (R) e aspereza (G) numa textura de dados só.
    const data = T.makeCanvas(S, S);
    const d = data.getContext('2d');
    const hi = h.getImageData(0, 0, S, S).data;
    const ri = r.getImageData(0, 0, S, S).data;
    const out = d.createImageData(S, S);
    for (let k = 0; k < out.data.length; k += 4) {
      out.data[k] = hi[k];
      out.data[k + 1] = ri[k];
      out.data[k + 2] = 0;
      out.data[k + 3] = 255;
    }
    d.putImageData(out, 0, 0);
    return { color, data };
  }

  /** Ruído suave e periódico (poças da garoa). */
  function paintNoise(T, S, seed) {
    const c = T.makeCanvas(S, S);
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    const fbm = T.noise(seed);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const v = fbm((x / S) * 4, (y / S) * 4, 4, 4, 4);
        const i = (y * S + x) * 4;
        const n = Math.round(clamp(v, 0, 1) * 255);
        img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  /** Azulejos quadrados (n × n) com rejunte; opcionalmente uma faixa colorida. */
  function paintTiles(T, S, n, base, groutColor, seed, stripe) {
    const c = T.makeCanvas(S, S);
    const g = c.getContext('2d');
    const rnd = T.mulberry32(seed);
    const t = S / n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const f = 0.94 + rnd() * 0.08;
        const col = stripe && j === stripe.row ? stripe.color : base;
        const grd = g.createLinearGradient(i * t, j * t, (i + 1) * t, (j + 1) * t);
        grd.addColorStop(0, shade(col, f * 1.03));
        grd.addColorStop(1, shade(col, f * 0.96));
        g.fillStyle = grd;
        g.fillRect(i * t, j * t, t, t);
      }
    }
    g.fillStyle = groutColor;
    const w = Math.max(1.5, S / 180);
    for (let k = 0; k <= n; k++) {
      g.fillRect(k * t - w / 2, 0, w, S);
      g.fillRect(0, k * t - w / 2, S, w);
    }
    for (let i = 0; i < 900; i++) {
      g.fillStyle = 'rgba(40,30,20,' + rnd() * 0.08 + ')';
      g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 3, 1 + rnd() * 3);
    }
    return c;
  }

  function paintConcrete(T, S, seed, base) {
    const c = T.makeCanvas(S, S);
    const g = c.getContext('2d');
    const rnd = T.mulberry32(seed);
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,' + rnd() * 0.12 + ')' : 'rgba(255,255,255,' + rnd() * 0.07 + ')';
      const s = 0.5 + rnd() * 2.5;
      g.fillRect(rnd() * S, rnd() * S, s, s);
    }
    for (let i = 0; i < 18; i++) {
      const x = rnd() * S;
      const grd = g.createLinearGradient(0, 0, 0, S);
      grd.addColorStop(0, 'rgba(20,16,12,0.25)');
      grd.addColorStop(1, 'rgba(20,16,12,0)');
      g.fillStyle = grd;
      g.fillRect(x, 0, 2 + rnd() * 10, S * (0.3 + rnd() * 0.7));
    }
    return c;
  }

  /** Texto em giz: várias passadas tremidas e falhas apagadas. */
  function chalkText(g, text, x, y, color, rnd) {
    g.fillStyle = color;
    for (let k = 0; k < 3; k++) {
      g.globalAlpha = 0.45;
      g.fillText(text, x + (rnd() - 0.5) * 1.6, y + (rnd() - 0.5) * 1.6);
    }
    g.globalAlpha = 1;
  }

  function paintChalkboard(T, W, H) {
    const c = T.makeCanvas(W, H);
    const g = c.getContext('2d');
    const rnd = T.mulberry32(303);
    const k = W / 512;
    g.fillStyle = '#1d2a24';
    g.fillRect(0, 0, W, H);
    // Restos de giz apagado.
    for (let i = 0; i < 40; i++) {
      g.fillStyle = 'rgba(220,230,220,' + rnd() * 0.05 + ')';
      g.beginPath();
      g.ellipse(rnd() * W, rnd() * H, 20 * k + rnd() * 80 * k, 6 * k + rnd() * 20 * k, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.textBaseline = 'alphabetic';
    g.textAlign = 'center';
    g.font = '400 ' + Math.round(58 * k) + 'px ' + FONT_DISPLAY;
    chalkText(g, 'TrucAÍ', W / 2, 80 * k, '#f2d27a', rnd);
    g.font = '600 ' + Math.round(26 * k) + 'px ' + FONT_COND;
    chalkText(g, 'BAR E LANCHES · TRUCO TODA NOITE', W / 2, 118 * k, '#f3b7b0', rnd);
    g.strokeStyle = 'rgba(240,240,230,0.55)';
    g.lineWidth = 2 * k;
    g.beginPath();
    g.moveTo(60 * k, 136 * k);
    g.bezierCurveTo(200 * k, 128 * k, 320 * k, 144 * k, 452 * k, 134 * k);
    g.stroke();
    const top = 190 * k;
    const step = (H - top - 70 * k) / PRICES.length;
    g.font = '600 ' + Math.round(34 * k) + 'px ' + FONT_COND;
    PRICES.forEach(([name, price], i) => {
      const y = top + i * step;
      g.textAlign = 'left';
      chalkText(g, name, 40 * k, y, '#f4f1e8', rnd);
      g.textAlign = 'right';
      chalkText(g, price, W - 40 * k, y, i < 3 ? '#f7e08a' : '#a8e0f0', rnd);
      g.fillStyle = 'rgba(240,240,230,0.35)';
      const nameW = g.measureText(price).width;
      for (let x = 40 * k + g.measureText(name).width + 14 * k; x < W - 50 * k - nameW; x += 12 * k) {
        g.fillRect(x, y - 4 * k, 3 * k, 3 * k);
      }
    });
    // Xicrinha desenhada em giz.
    const cx = W / 2;
    const cy = H - 38 * k;
    g.strokeStyle = 'rgba(245,240,230,0.75)';
    g.lineWidth = 3 * k;
    g.beginPath();
    g.moveTo(cx - 34 * k, cy - 16 * k);
    g.lineTo(cx - 26 * k, cy + 8 * k);
    g.lineTo(cx + 26 * k, cy + 8 * k);
    g.lineTo(cx + 34 * k, cy - 16 * k);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.arc(cx + 38 * k, cy - 6 * k, 9 * k, -1.2, 1.4);
    g.stroke();
    for (let s = -1; s <= 1; s++) {
      g.beginPath();
      g.moveTo(cx + s * 12 * k, cy - 22 * k);
      g.bezierCurveTo(cx + s * 12 * k - 8 * k, cy - 34 * k, cx + s * 12 * k + 8 * k, cy - 40 * k, cx + s * 12 * k, cy - 52 * k);
      g.stroke();
    }
    // Falhas do giz.
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = 'rgba(0,0,0,' + rnd() * 0.5 + ')';
      g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = '#1d2a24';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    return c;
  }

  function paintPlaque(T) {
    const W = 256;
    const H = 128;
    const c = T.makeCanvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#f4efe2';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#1a1a1a';
    g.lineWidth = 6;
    g.strokeRect(8, 8, W - 16, H - 16);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#c0272d';
    g.font = '700 50px ' + FONT_COND;
    g.fillText('FIADO', W / 2, 46);
    g.fillStyle = '#1a1a1a';
    g.font = '700 34px ' + FONT_COND;
    g.fillText('SÓ AMANHÃ', W / 2, 90);
    return c;
  }

  /** Logotipo "Garoa" (marca fictícia) sobre fundo; usado no porta-garrafa, cadeira e freezer. */
  function drawGaroa(g, x, y, size, fill, stroke) {
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '400 ' + Math.round(size) + 'px ' + FONT_DISPLAY;
    g.lineJoin = 'round';
    if (stroke) {
      g.lineWidth = size * 0.14;
      g.strokeStyle = stroke;
      g.strokeText('Garoa', x, y);
    }
    g.fillStyle = fill;
    g.fillText('Garoa', x, y);
    g.restore();
  }

  function paintKoozie(T) {
    const W = 512;
    const H = 256;
    const c = T.makeCanvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#b3261e';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#f2c230';
    g.fillRect(0, 26, W, 16);
    g.fillRect(0, H - 42, W, 16);
    for (const x of [W * 0.25, W * 0.75]) {
      g.fillStyle = '#f2c230';
      g.beginPath();
      g.ellipse(x, H / 2, 108, 54, 0, 0, Math.PI * 2);
      g.fill();
      drawGaroa(g, x, H / 2 + 4, 64, '#ffffff', '#8f1b15');
    }
    return c;
  }

  function paintBottleLabel(T) {
    const c = T.makeCanvas(256, 128);
    const g = c.getContext('2d');
    g.fillStyle = '#f2c230';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#b3261e';
    g.fillRect(0, 0, 256, 14);
    g.fillRect(0, 114, 256, 14);
    drawGaroa(g, 128, 60, 52, '#b3261e', null);
    g.fillStyle = '#5a1510';
    g.font = '700 16px ' + FONT_COND;
    g.textAlign = 'center';
    g.fillText('PILSEN · 600 ML', 128, 100);
    return c;
  }

  function paintCapFace(T) {
    const S = 128;
    const c = T.makeCanvas(S, S);
    const g = c.getContext('2d');
    g.fillStyle = '#d8b56a';
    g.fillRect(0, 0, S, S);
    g.fillStyle = '#b3261e';
    g.beginPath();
    g.arc(S / 2, S / 2, S * 0.42, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f2c230';
    g.beginPath();
    g.arc(S / 2, S / 2, S * 0.34, 0, Math.PI * 2);
    g.fill();
    drawGaroa(g, S / 2, S / 2 + 2, 30, '#b3261e', null);
    return c;
  }

  /** Lateral do engradado: moldura amarela com vãos (alpha) e o logo em relevo. */
  function paintCrate(T) {
    const W = 256;
    const H = 256;
    const c = T.makeCanvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#c99a3a';
    g.fillRect(0, 0, W, H);
    const rnd = T.mulberry32(61);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = 'rgba(60,40,10,' + rnd() * 0.18 + ')';
      g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 6, 1 + rnd() * 4);
    }
    g.globalCompositeOperation = 'destination-out';
    // Sem isto valeria o último fillStyle (a sujeira quase transparente) e os vãos não seriam recortados.
    g.fillStyle = '#000';
    const cols = 5;
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < cols; i++) {
        const x = 16 + i * ((W - 32) / cols);
        const y = r === 0 ? 20 : 160;
        g.fillRect(x + 4, y, (W - 32) / cols - 8, 70);
      }
    }
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#c28a1a';
    g.fillRect(16, 104, W - 32, 44);
    // Os engradados ficam de boca para baixo: o logo é pintado invertido para ler direito na cena.
    g.save();
    g.translate(W / 2, 127);
    g.rotate(Math.PI);
    drawGaroa(g, 0, -2, 34, '#f6d35a', '#9a6a10');
    g.restore();
    g.strokeStyle = 'rgba(80,50,0,0.35)';
    g.lineWidth = 3;
    g.strokeRect(4, 4, W - 8, H - 8);
    return c;
  }

  /** Fundo do engradado (a face de cima do engradado emborcado): grade fina, fechada. */
  function paintCrateTop(T) {
    const S = 256;
    const c = T.makeCanvas(S, S);
    const g = c.getContext('2d');
    g.fillStyle = '#c99a3a';
    g.fillRect(0, 0, S, S);
    const n = 11;
    const cell = (S - 24) / n;
    g.fillStyle = '#8f6a22';
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = 12 + i * cell + 3;
        const y = 12 + j * cell + 3;
        g.fillRect(x, y, cell - 6, cell - 6);
      }
    }
    g.fillStyle = 'rgba(255, 230, 160, 0.25)';
    for (let k = 0; k <= n; k++) {
      g.fillRect(12 + k * cell - 1.5, 12, 3, S - 24);
      g.fillRect(12, 12 + k * cell - 1.5, S - 24, 3);
    }
    const rnd = T.mulberry32(62);
    for (let i = 0; i < 300; i++) {
      g.fillStyle = 'rgba(60,40,10,' + rnd() * 0.2 + ')';
      g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 6, 1 + rnd() * 4);
    }
    g.strokeStyle = 'rgba(80,50,0,0.45)';
    g.lineWidth = 6;
    g.strokeRect(3, 3, S - 6, S - 6);
    return c;
  }

  function paintChairBack(T, small) {
    const W = 512;
    const H = 256;
    const c = T.makeCanvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#b3261e';
    g.fillRect(0, 0, W, H);
    if (small) {
      g.fillStyle = '#f2c230';
      g.beginPath();
      g.ellipse(W / 2, H / 2, 110, 46, 0, 0, Math.PI * 2);
      g.fill();
      drawGaroa(g, W / 2, H / 2 + 3, 58, '#ffffff', '#8f1b15');
    } else {
      g.fillStyle = '#f2c230';
      g.fillRect(0, H / 2 - 30, W, 60);
      drawGaroa(g, W / 2, H / 2 + 4, 120, '#ffffff', '#8f1b15');
    }
    const rnd = T.mulberry32(88);
    for (let i = 0; i < 60; i++) {
      g.strokeStyle = 'rgba(255,215,200,' + rnd() * 0.3 + ')';
      g.lineWidth = 1 + rnd();
      const x = rnd() * W;
      const y = rnd() * H;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 12);
      g.stroke();
    }
    return c;
  }

  function paintFreezer(T) {
    const W = 512;
    const H = 256;
    const c = T.makeCanvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#eef0ee';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#b3261e';
    g.fillRect(0, 40, W, 150);
    g.fillStyle = '#f2c230';
    g.fillRect(0, 170, W, 20);
    drawGaroa(g, W * 0.36, 105, 96, '#ffffff', '#8f1b15');
    g.fillStyle = '#ffffff';
    g.font = '700 44px ' + FONT_COND;
    g.textAlign = 'center';
    g.fillText('GELADA', W * 0.78, 118);
    return c;
  }

  /**
   * Placa de rua padrão da cidade de São Paulo (referência do usuário): campo azul com o nome
   * grande e o logradouro completo embaixo, faixa cinza e o quadro branco com a região e o número.
   */
  function drawStreetSign(g, x, y, W, H) {
    const blueH = H * 0.77;
    g.fillStyle = '#322F91';
    g.fillRect(x, y, W, blueH);
    g.fillStyle = '#ffffff';
    g.fillRect(x, y + blueH, W, H * 0.013);
    g.fillStyle = '#B8B9B4';
    g.fillRect(x, y + blueH + H * 0.013, W * 0.877, H - blueH - H * 0.013);
    g.fillStyle = '#ffffff';
    g.fillRect(x + W * 0.877, y + blueH + H * 0.013, W * 0.123, H - blueH - H * 0.013);
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#ffffff';
    g.font = '600 ' + Math.round(H * 0.42) + 'px ' + FONT_COND;
    g.fillText('Augusta', x + W * 0.028, y + H * 0.41, W * 0.8);
    g.font = '500 ' + Math.round(H * 0.12) + 'px ' + FONT_COND;
    g.fillText('Rua Augusta', x + W * 0.028, y + H * 0.69);
    g.fillStyle = '#1b1b1b';
    g.textAlign = 'center';
    g.font = '600 ' + Math.round(H * 0.075) + 'px ' + FONT_COND;
    g.fillText('Sé', x + W * 0.939, y + H * 0.855);
    g.font = '600 ' + Math.round(H * 0.11) + 'px ' + FONT_COND;
    g.fillText('2', x + W * 0.939, y + H * 0.965);
  }

  function paintStreetSign(T) {
    const W = 512;
    const H = 256;
    const c = T.makeCanvas(W, H);
    drawStreetSign(c.getContext('2d'), 0, 0, W, H);
    return c;
  }

  function paintCoffeeTop(T, kind) {
    const S = 128;
    const c = T.makeCanvas(S, S);
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    if (kind === 'pingado') {
      grd.addColorStop(0, '#caa27a');
      grd.addColorStop(0.75, '#b98a5c');
      grd.addColorStop(0.92, '#e2c9a4');
      grd.addColorStop(1, '#f0dfc2');
    } else {
      grd.addColorStop(0, '#1c0f08');
      grd.addColorStop(0.7, '#2e1a0e');
      grd.addColorStop(0.9, '#8a5a2c');
      grd.addColorStop(1, '#b07a3e');
    }
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    const rnd = T.mulberry32(kind === 'pingado' ? 4 : 5);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = kind === 'pingado' ? 'rgba(250,235,210,0.35)' : 'rgba(190,130,70,0.3)';
      const a = rnd() * Math.PI * 2;
      const r = S * 0.25 * rnd();
      g.beginPath();
      g.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 1 + rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  }

  /** Fachada inteira (45 × 42 un.) com o vão da porta transparente. */
  function paintFacade(T, W, H) {
    const L = LAYOUT;
    const c = T.makeCanvas(W, H);
    const g = c.getContext('2d');
    const rnd = T.mulberry32(1971);
    const width = L.barFarZ - L.barCornerZ;
    const ppu = W / width;
    const X = (z) => (z - L.barCornerZ) * ppu;
    const Y = (h) => H - h * ppu;
    // Pintura amarelo-ocre com manchas de chuva.
    g.fillStyle = '#d7a444';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) {
      const x = rnd() * W;
      const w = 4 + rnd() * 40;
      const grd = g.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, 'rgba(70,45,20,' + (0.1 + rnd() * 0.2) + ')');
      grd.addColorStop(1, 'rgba(70,45,20,0)');
      g.fillStyle = grd;
      g.fillRect(x, 0, w, H * (0.2 + rnd() * 0.5));
    }
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(80,50,20,' + rnd() * 0.12 + ')' : 'rgba(255,240,200,' + rnd() * 0.1 + ')';
      g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 3);
    }
    // Barrado de azulejos brancos 10 × 10 cm até 1,2 m, com faixa vermelha.
    const tileTop = Y(12);
    const tile = ppu;
    for (let y = H; y > tileTop; y -= tile) {
      for (let x = 0; x < W; x += tile) {
        const f = 0.92 + rnd() * 0.08;
        g.fillStyle = shade([236, 234, 226], f);
        g.fillRect(x, y - tile, tile, tile);
      }
    }
    g.fillStyle = '#b3261e';
    g.fillRect(0, tileTop - ppu * 0.5, W, ppu * 0.5);
    g.fillStyle = 'rgba(90,80,70,0.8)';
    for (let x = 0; x < W; x += tile) g.fillRect(x, tileTop, 1.5, H - tileTop);
    for (let y = H; y > tileTop; y -= tile) g.fillRect(0, y, W, 1.5);
    const grd = g.createLinearGradient(0, H, 0, tileTop);
    grd.addColorStop(0, 'rgba(40,30,20,0.45)');
    grd.addColorStop(0.35, 'rgba(40,30,20,0)');
    g.fillStyle = grd;
    g.fillRect(0, tileTop, W, H - tileTop);
    // Letreiro pintado à mão sobre faixa vermelha.
    const signY0 = Y(L.opening.h + 12.5);
    const signY1 = Y(L.opening.h + 3.4);
    g.fillStyle = '#9e1f18';
    g.fillRect(X(L.opening.z0 - 0.6), signY0, X(24) - X(L.opening.z0 - 0.6), signY1 - signY0);
    g.strokeStyle = '#f2c230';
    g.lineWidth = ppu * 0.25;
    g.strokeRect(X(L.opening.z0 - 0.2), signY0 + ppu * 0.4, X(23.6) - X(L.opening.z0 - 0.2), signY1 - signY0 - ppu * 0.8);
    const cx = (X(L.opening.z0 - 0.6) + X(24)) / 2;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '400 ' + Math.round(ppu * 5.6) + 'px ' + FONT_DISPLAY;
    g.lineJoin = 'round';
    g.fillStyle = '#2a0f0a';
    g.fillText('TrucAÍ', cx + ppu * 0.35, signY0 + (signY1 - signY0) * 0.42 + ppu * 0.35);
    g.lineWidth = ppu * 0.5;
    g.strokeStyle = '#f6e7c5';
    g.strokeText('TrucAÍ', cx, signY0 + (signY1 - signY0) * 0.42);
    g.fillStyle = '#f2c230';
    g.fillText('TrucAÍ', cx, signY0 + (signY1 - signY0) * 0.42);
    g.font = '700 ' + Math.round(ppu * 1.9) + 'px ' + FONT_COND;
    if ('letterSpacing' in g) g.letterSpacing = Math.round(ppu * 0.5) + 'px';
    g.fillStyle = '#f6e7c5';
    g.fillText('BAR  E  LANCHES', cx, signY0 + (signY1 - signY0) * 0.82);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.font = '400 ' + Math.round(ppu * 1.4) + 'px ' + FONT_DISPLAY;
    g.fillStyle = '#9e1f18';
    g.fillText('desde 1971', X(L.opening.z0 + 2), Y(L.opening.h + 1.5));
    // Mural "Garoa" pintado na parede à direita.
    const mx = X(19);
    const my = Y(18);
    g.fillStyle = '#b3261e';
    g.beginPath();
    g.ellipse(mx, my, ppu * 7, ppu * 3.6, -0.05, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#f2c230';
    g.lineWidth = ppu * 0.5;
    g.stroke();
    drawGaroa(g, mx, my - ppu * 0.3, ppu * 3.6, '#ffffff', '#8f1b15');
    g.fillStyle = '#f6e7c5';
    g.font = '700 ' + Math.round(ppu * 1.1) + 'px ' + FONT_COND;
    g.textAlign = 'center';
    g.fillText('GELADA DE VERDADE', mx, my + ppu * 2.2);
    // Janela com grade à direita.
    g.fillStyle = '#2a2622';
    g.fillRect(X(27), Y(22), ppu * 5.5, ppu * 8);
    g.fillStyle = 'rgba(255,214,150,0.55)';
    g.fillRect(X(27.3), Y(21.7), ppu * 4.9, ppu * 7.4);
    g.fillStyle = '#1c1a18';
    for (let i = 0; i <= 6; i++) g.fillRect(X(27) + (i * ppu * 5.5) / 6 - 2, Y(22), 4, ppu * 8);
    // Guias da porta de aço e o vão transparente.
    g.fillStyle = '#3d3f42';
    g.fillRect(X(L.opening.z0) - ppu * 0.35, Y(L.opening.h + 0.2), ppu * 0.35, L.opening.h * ppu + ppu * 0.2);
    g.fillRect(X(L.opening.z1), Y(L.opening.h + 0.2), ppu * 0.35, L.opening.h * ppu + ppu * 0.2);
    g.clearRect(X(L.opening.z0), Y(L.opening.h), X(L.opening.z1) - X(L.opening.z0), L.opening.h * ppu + 1);
    return c;
  }

  /** Parede lateral do bar (voltada para a mureta). */
  function paintSideWall(T, W, H) {
    const c = T.makeCanvas(W, H);
    const g = c.getContext('2d');
    const rnd = T.mulberry32(77);
    const ppu = H / LAYOUT.barH;
    g.fillStyle = '#cf9d40';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 60; i++) {
      const x = rnd() * W;
      const grd = g.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, 'rgba(60,40,20,' + (0.1 + rnd() * 0.25) + ')');
      grd.addColorStop(1, 'rgba(60,40,20,0)');
      g.fillStyle = grd;
      g.fillRect(x, 0, 4 + rnd() * 30, H * (0.3 + rnd() * 0.6));
    }
    const tileTop = H - 12 * ppu;
    for (let y = H; y > tileTop; y -= ppu) {
      for (let x = 0; x < W; x += ppu) {
        g.fillStyle = shade([232, 230, 222], 0.9 + rnd() * 0.08);
        g.fillRect(x, y - ppu, ppu - 1.5, ppu - 1.5);
      }
    }
    g.fillStyle = '#b3261e';
    g.fillRect(0, tileTop - ppu * 0.5, W, ppu * 0.5);
    // Placa de rua na quina (lado direito da parede, visto de fora).
    drawStreetSign(g, W - 9 * ppu, H - 26 * ppu, 6 * ppu, 3 * ppu);
    return c;
  }

  /**
   * Frente do balcão: pastilhas (quadradas: o canvas tem a proporção do painel, w × h em unidades),
   * faixa vermelha com o letreiro "TRUCAÍ · BAR E LANCHES" em Shrikhand creme, rodapé e friso.
   */
  function paintCounterFront(T, w, h) {
    const W = 512;
    const H = Math.round((W * h) / w);
    const c = T.makeCanvas(W, H);
    const g = c.getContext('2d');
    const rnd = T.mulberry32(12);
    const ppu = W / w;
    const t = 14;
    g.fillStyle = '#6a5a4c';
    g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += t) {
      for (let x = 0; x < W; x += t) {
        const r = rnd();
        const col = r < 0.08 ? [150, 60, 45] : [214, 202, 178];
        g.fillStyle = shade(col, 0.82 + rnd() * 0.2);
        g.fillRect(x + 1, y + 1, t - 2.5, t - 2.5);
      }
    }
    // Faixa vermelha com o letreiro, no alto da frente (é a parte que a câmera do jogo vê).
    const bandY = Math.round(ppu * 1.1);
    const bandH = Math.round(ppu * 1.9);
    g.fillStyle = '#9e1f18';
    g.fillRect(0, bandY, W, bandH);
    g.fillStyle = '#f2c230';
    g.fillRect(0, bandY + 3, W, 3);
    g.fillRect(0, bandY + bandH - 6, W, 3);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '400 ' + Math.round(bandH * 0.52) + 'px ' + FONT_DISPLAY;
    g.lineJoin = 'round';
    g.lineWidth = Math.max(2, bandH * 0.08);
    g.strokeStyle = '#4a0d08';
    g.strokeText('TRUCAÍ · BAR E LANCHES', W / 2, bandY + bandH * 0.53, W * 0.94);
    g.fillStyle = '#f6e7c5';
    g.fillText('TRUCAÍ · BAR E LANCHES', W / 2, bandY + bandH * 0.53, W * 0.94);
    g.fillStyle = '#6f6a64';
    g.fillRect(0, H - Math.round(ppu * 0.5), W, Math.round(ppu * 0.5));
    g.fillStyle = '#9aa0a6';
    g.fillRect(0, 0, W, Math.round(ppu * 0.25));
    return c;
  }

  function paintClock(T) {
    const S = 128;
    const c = T.makeCanvas(S, S);
    const g = c.getContext('2d');
    g.fillStyle = '#f3efe4';
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#b3261e';
    g.lineWidth = 8;
    g.stroke();
    g.fillStyle = '#1a1a1a';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.fillRect(S / 2 + Math.cos(a) * 46 - 2, S / 2 + Math.sin(a) * 46 - 2, 4, 4);
    }
    drawGaroa(g, S / 2, S * 0.68, 18, '#b3261e', null);
    g.strokeStyle = '#1a1a1a';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(S / 2, S / 2);
    g.lineTo(S / 2 + 24, S / 2 - 18);
    g.moveTo(S / 2, S / 2);
    g.lineTo(S / 2 - 6, S / 2 - 40);
    g.stroke();
    return c;
  }

  function paintAwning(T) {
    const W = 512;
    const H = 64;
    const c = T.makeCanvas(W, H);
    const g = c.getContext('2d');
    const n = 16;
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? '#e9dcc0' : '#a92a20';
      g.fillRect((i * W) / n, 0, W / n, H);
    }
    const rnd = T.mulberry32(9);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = 'rgba(30,20,10,' + rnd() * 0.12 + ')';
      g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 6, 1 + rnd() * 3);
    }
    return c;
  }

  function paintValance(T) {
    const W = 512;
    const H = 64;
    const c = T.makeCanvas(W, H);
    const g = c.getContext('2d');
    const n = 16;
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? '#e9dcc0' : '#a92a20';
      g.beginPath();
      const x0 = (i * W) / n;
      g.moveTo(x0, 0);
      g.lineTo(x0 + W / n, 0);
      g.lineTo(x0 + W / n, H * 0.62);
      g.quadraticCurveTo(x0 + W / n / 2, H * 1.05, x0, H * 0.62);
      g.closePath();
      g.fill();
    }
    return c;
  }

  function paintGlow(T, inner, outer) {
    const S = 64;
    const c = T.makeCanvas(S, S);
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, inner);
    grd.addColorStop(0.25, outer);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    return c;
  }

  function paintSteam(T) {
    const S = 64;
    const c = T.makeCanvas(S, S);
    const g = c.getContext('2d');
    const rnd = T.mulberry32(21);
    for (let i = 0; i < 9; i++) {
      const x = S / 2 + (rnd() - 0.5) * S * 0.35;
      const y = S / 2 + (rnd() - 0.5) * S * 0.45;
      const r = S * (0.14 + rnd() * 0.16);
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.6)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, S, S);
    }
    return c;
  }

  function paintStreak(T) {
    const c = T.makeCanvas(16, 64);
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 64);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(7, 0, 2, 64);
    return c;
  }

  /** Asfalto molhado da rua de baixo com reflexos (de olho fixo, por isso pintados). */
  function paintWetStreet(T, W, H, lamps) {
    const c = T.makeCanvas(W, H);
    const g = c.getContext('2d');
    const rnd = T.mulberry32(55);
    g.fillStyle = '#121214';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = 'rgba(255,255,255,' + rnd() * 0.05 + ')';
      g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1);
    }
    for (const u of lamps) {
      const x = u * W;
      const grd = g.createLinearGradient(0, H, 0, 0);
      grd.addColorStop(0, 'rgba(255,150,60,0.8)');
      grd.addColorStop(1, 'rgba(255,120,40,0.06)');
      g.fillStyle = grd;
      for (let k = 0; k < 14; k++) {
        const w = 3 + rnd() * 10;
        const len = H * (0.55 + rnd() * 0.45);
        g.globalAlpha = 0.25 + rnd() * 0.3;
        g.fillRect(x - w / 2 + (rnd() - 0.5) * 16, H - len, w, len);
      }
      g.globalAlpha = 1;
      const pool = g.createRadialGradient(x, H * 0.85, 0, x, H * 0.85, W * 0.08);
      pool.addColorStop(0, 'rgba(255,160,70,0.35)');
      pool.addColorStop(1, 'rgba(255,160,70,0)');
      g.fillStyle = pool;
      g.fillRect(0, 0, W, H);
    }
    // Faixa central amarela tracejada e guias.
    g.fillStyle = 'rgba(230,190,60,0.55)';
    for (let x = 0; x < W; x += 60) g.fillRect(x, H * 0.5, 34, 3);
    g.fillStyle = '#4a4744';
    g.fillRect(0, 0, W, 4);
    g.fillRect(0, H - 5, W, 5);
    return c;
  }

  // ---------------------------------------------------------------------------
  // Shaders
  // ---------------------------------------------------------------------------

  const GLSL_HASH = `
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }`;

  /** Prédios da cidade: janelas procedurais que acendem e apagam devagar. */
  function buildingMaterial(THREE) {
    return new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uHaze: { value: new THREE.Color(0x2a1f1f) } },
      vertexShader: `
        attribute vec3 aTint;
        attribute vec3 aInfo; // x = estilo, y = névoa, z = semente
        varying vec2 vUv;
        varying vec3 vTint;
        varying vec3 vInfo;
        void main() {
          vUv = uv; vTint = aTint; vInfo = aInfo;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uHaze;
        varying vec2 vUv;
        varying vec3 vTint;
        varying vec3 vInfo;
        ${GLSL_HASH}
        void main() {
          vec2 cell = floor(vUv);
          vec2 f = fract(vUv);
          float seed = vInfo.z;
          float h = hash12(cell + seed * 17.0);
          float slot = floor(uTime / (40.0 + 60.0 * h) + h * 9.0);
          float lit = step(0.66 + 0.18 * step(100.0, seed) + vInfo.y * 0.15, hash12(cell + vec2(slot * 3.1, seed)));
          vec3 warm = mix(vec3(1.0, 0.72, 0.38), vec3(1.0, 0.9, 0.7), hash12(cell + 5.0));
          vec3 cool = vec3(0.72, 0.85, 1.0);
          vec3 glass = mix(warm, cool, step(0.82, hash12(cell + 11.0))) * (0.35 + 0.75 * h * h);
          float win;
          vec3 col = vTint;
          if (vInfo.x < 0.5) {
            win = step(0.2, f.x) * step(f.x, 0.8) * step(0.22, f.y) * step(f.y, 0.78);
            col = mix(vTint, mix(vTint * 1.6, glass, lit), win);
          } else if (vInfo.x < 1.5) {
            // Copan: brises horizontais contínuos (tom pela curva em vTint) com janelas entre eles.
            float brise = smoothstep(0.0, 0.05, f.y) * (1.0 - smoothstep(0.2, 0.26, f.y));
            win = step(0.38, f.y) * step(f.y, 0.9) * step(0.2, fract(vUv.x * 0.5));
            col = mix(vec3(0.035, 0.03, 0.035), glass * 0.75, win * lit);
            col = mix(col, vec3(0.62, 0.58, 0.5) * vTint.r, brise);
          } else if (vInfo.x < 2.5) {
            // Edifício Itália: faixas verticais e coroa iluminada.
            float rib = step(0.72, f.x);
            win = step(0.25, f.y) * step(f.y, 0.85) * (1.0 - rib);
            col = mix(vTint, glass, win * lit);
            col = mix(col, vec3(0.3, 0.28, 0.27), rib);
          } else if (vInfo.x < 3.5) {
            // Torre de antena treliçada.
            float d = abs(fract(vUv.x + vUv.y) - 0.5) + 0.02;
            float d2 = abs(fract(vUv.x - vUv.y) - 0.5) + 0.02;
            col = mix(vTint, vTint * 3.0, step(min(d, d2), 0.07));
          } else if (vInfo.x < 4.5) {
            // Coroa iluminada (restaurante no topo).
            win = step(0.15, f.x) * step(f.x, 0.85) * step(0.2, f.y) * step(f.y, 0.85);
            col = mix(vTint, vec3(1.0, 0.78, 0.45) * 1.3, win);
          }
          col = mix(col, uHaze, clamp(vInfo.y, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      fog: false,
    });
  }

  /** Pontos luminosos (cidade, luzes de aviação): tamanho em px, cintilar e piscar. */
  function glowPointsMaterial(THREE, tex) {
    return new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixel: { value: 1 }, uMap: { value: tex } },
      vertexShader: `
        attribute vec3 aColor;
        attribute vec3 aInfo; // x = tamanho (px), y = fase, z = pisca (0/1)
        uniform float uTime;
        uniform float uPixel;
        varying vec3 vColor;
        void main() {
          float tw = 0.82 + 0.18 * sin(uTime * (1.3 + fract(aInfo.y * 7.0) * 2.0) + aInfo.y * 40.0);
          float blink = mix(1.0, step(0.55, fract(uTime * 0.55 + aInfo.y)), aInfo.z);
          vColor = aColor * tw * blink;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aInfo.x * uPixel * (0.4 + 0.6 * blink);
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).r;
          gl_FragColor = vec4(vColor * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
  }

  /** Faróis correndo ao longo de uma avenida (x de −1 a 1 em unidades do caminho). */
  function trafficMaterial(THREE, tex) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixel: { value: 1 },
        uMap: { value: tex },
        uDist: { value: 88 },
        uY: { value: -3.15 },
        uSpan: { value: 70 * D2R },
      },
      vertexShader: `
        attribute vec3 aInfo; // x = offset, y = velocidade (sinal = sentido), z = pista
        uniform float uTime, uPixel, uDist, uY, uSpan;
        varying vec3 vColor;
        void main() {
          float s = fract(aInfo.x + uTime * aInfo.y);
          float az = (s * 2.0 - 1.0) * uSpan;
          float d = uDist + aInfo.z;
          vec3 p = vec3(sin(az) * d, uY, -cos(az) * d);
          vColor = aInfo.y > 0.0 ? vec3(1.0, 0.95, 0.85) : vec3(1.0, 0.18, 0.12);
          float edge = smoothstep(0.0, 0.08, s) * smoothstep(1.0, 0.92, s);
          vColor *= edge;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = 2.6 * uPixel;
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec3 vColor;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).r;
          gl_FragColor = vec4(vColor * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
  }

  function skyMaterial(THREE) {
    return new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vDir;
        ${GLSL_HASH}
        float vnoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
        }
        void main() {
          vec3 d = normalize(vDir);
          float el = asin(clamp(d.y, -1.0, 1.0)) * 57.2958;
          float az = atan(d.x, -d.z);
          vec3 zenith = vec3(0.035, 0.035, 0.06);
          vec3 mid = vec3(0.09, 0.07, 0.09);
          vec3 glow = vec3(0.42, 0.22, 0.12);
          vec3 col = mix(glow, mid, smoothstep(1.0, 9.0, el));
          col = mix(col, zenith, smoothstep(9.0, 40.0, el));
          float clouds = vnoise(vec2(az * 6.0 + uTime * 0.01, el * 0.35)) * vnoise(vec2(az * 13.0, el * 0.9 + 3.0));
          col += vec3(0.16, 0.08, 0.04) * clouds * smoothstep(30.0, 3.0, el) * smoothstep(-2.0, 3.0, el);
          col = mix(vec3(0.02, 0.018, 0.02), col, smoothstep(-8.0, -1.0, el));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
  }

  /** Garoa: riscos finos caindo, visíveis perto das luzes (posições no espaço do objeto). */
  function rainMaterial(THREE, tex, lights, box) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 400 },
        uMap: { value: tex },
        uLights: { value: lights },
        uBase: { value: 0.12 },
        uBox: { value: box }, // (y0, altura)
        uSize: { value: 1 },
      },
      vertexShader: `
        attribute vec2 aInfo; // x = fase, y = velocidade
        uniform float uTime, uScale, uBase, uSize;
        uniform vec2 uBox;
        uniform vec4 uLights[3];
        varying float vAlpha;
        void main() {
          vec3 p = position;
          p.y = uBox.x + mod(p.y - uBox.x - uTime * aInfo.y, uBox.y);
          p.x += sin(uTime * 0.7 + aInfo.x * 6.0) * 0.15;
          float lit = uBase;
          for (int i = 0; i < 3; i++) {
            float d = distance(p, uLights[i].xyz);
            lit += uLights[i].w * (1.0 - smoothstep(0.0, 1.0, d / max(uLights[i].w * 18.0, 0.001)));
          }
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vAlpha = clamp(lit, 0.0, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * uScale / max(-mv.z, 0.1);
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        varying float vAlpha;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).r * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.85, 0.88, 0.95) * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
  }

  /** Poeira no cone da luminária: some fora do cone. */
  function dustMaterial(THREE, tex, apex) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 400 },
        uMap: { value: tex },
        uApex: { value: apex },
        uTan: { value: Math.tan(0.46) },
      },
      vertexShader: `
        attribute vec3 aInfo;
        uniform float uTime, uScale, uTan;
        uniform vec3 uApex;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          float t = uTime * (0.05 + aInfo.y * 0.05) + aInfo.x * 6.28;
          p += vec3(sin(t) * 0.6, sin(t * 0.7 + 1.3) * 0.45, cos(t * 0.8) * 0.6);
          vec3 wp = (modelMatrix * vec4(p, 1.0)).xyz;
          float h = uApex.y - wp.y;
          float r = length(wp.xz - uApex.xz);
          float cone = 1.0 - smoothstep(0.55, 1.0, r / max(h * uTan, 0.01));
          float twinkle = 0.55 + 0.45 * sin(uTime * (0.8 + aInfo.z) + aInfo.x * 30.0);
          vAlpha = cone * twinkle * smoothstep(0.4, 1.4, wp.y) * smoothstep(0.3, 1.5, h);
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (0.6 + aInfo.z * 0.9) * uScale * 0.018 / max(-mv.z, 0.1);
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        varying float vAlpha;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).r * vAlpha * 0.4;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vec3(1.0, 0.85, 0.62) * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
  }

  /** Vapor do café: fiapos que sobem, abrem e somem. */
  function steamMaterial(THREE, tex) {
    return new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 400 }, uMap: { value: tex }, uCount: { value: 7 } },
      vertexShader: `
        attribute vec2 aInfo; // x = fase (0..1), y = índice
        uniform float uTime, uScale, uCount;
        varying float vAlpha;
        varying float vRot;
        void main() {
          float life = fract(uTime * 0.28 + aInfo.x);
          vec3 p = position;
          p.y += life * 1.9;
          p.x += sin(life * 5.0 + aInfo.x * 12.0) * 0.12 * life;
          p.z += cos(life * 4.0 + aInfo.x * 9.0) * 0.1 * life;
          vAlpha = smoothstep(0.0, 0.18, life) * (1.0 - smoothstep(0.45, 1.0, life)) * step(aInfo.y, uCount - 0.5);
          vRot = aInfo.x * 6.28 + life * 1.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (0.5 + life * 1.2) * uScale * 0.62 / max(-mv.z, 0.1);
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        varying float vAlpha;
        varying float vRot;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float s = sin(vRot), co = cos(vRot);
          vec2 uv = vec2(c.x * co - c.y * s, c.x * s + c.y * co) + 0.5;
          float a = min(0.85, texture2D(uMap, uv).a * vAlpha * 1.1);
          if (a < 0.004) discard;
          gl_FragColor = vec4(vec3(0.92, 0.9, 0.86), a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
  }

  /** TV do bar: futebol "ao vivo" (campo, linhas, jogadores e bola), tudo no shader. */
  function tvMaterial(THREE) {
    return new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv;
          vec3 col = mix(vec3(0.12, 0.45, 0.16), vec3(0.16, 0.52, 0.2), step(0.5, fract(uv.x * 8.0 + uTime * 0.03)));
          float line = step(abs(uv.x - 0.5), 0.004) + step(abs(length((uv - 0.5) * vec2(1.6, 1.0)) - 0.16), 0.005);
          line += step(uv.y, 0.06) * step(0.05, uv.y) + step(0.94, uv.y) * step(uv.y, 0.95);
          col = mix(col, vec3(0.9), clamp(line, 0.0, 1.0));
          for (int i = 0; i < 10; i++) {
            float fi = float(i);
            vec2 p = vec2(0.5 + 0.38 * sin(uTime * (0.3 + fi * 0.07) + fi * 1.7), 0.5 + 0.34 * cos(uTime * (0.25 + fi * 0.05) + fi * 2.3));
            float d = length((uv - p) * vec2(1.6, 1.0));
            vec3 kit = mod(fi, 2.0) < 0.5 ? vec3(0.95, 0.2, 0.15) : vec3(0.95, 0.95, 0.95);
            col = mix(col, kit, 1.0 - smoothstep(0.012, 0.02, d));
          }
          vec2 b = vec2(0.5 + 0.4 * sin(uTime * 0.9), 0.5 + 0.3 * sin(uTime * 1.3 + 1.0));
          col = mix(col, vec3(1.0, 1.0, 0.8), 1.0 - smoothstep(0.006, 0.011, length((uv - b) * vec2(1.6, 1.0))));
          col = mix(col, vec3(0.05, 0.05, 0.08), step(0.86, uv.y) * step(uv.x, 0.3));
          col *= 0.85 + 0.15 * sin(uv.y * 400.0);
          gl_FragColor = vec4(col * 1.4, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      fog: false,
    });
  }

  // ---------------------------------------------------------------------------
  // Construção
  // ---------------------------------------------------------------------------

  function build(ctx) {
    const THREE = ctx.THREE;
    const T = Truco.Table.tex;
    const R = tracker();
    const track = R.track;
    const L = LAYOUT;
    const F = ctx.table.floorY;
    const high = () => ctx.quality !== 'low';
    const lowAtBuild = ctx.quality === 'low';
    const group = new THREE.Group();
    group.name = 'world';
    const updaters = [];
    let disposed = false;

    const canvasTex = (canvas, opts) => track(T.canvasTexture(THREE, canvas, opts));
    const std = (o) => track(new THREE.MeshStandardMaterial(o));
    const basic = (o) => track(new THREE.MeshBasicMaterial(o));
    const mesh = (geo, mat, opts) => {
      const m = new THREE.Mesh(track(geo), mat);
      const o = opts || {};
      m.castShadow = !!o.cast;
      m.receiveShadow = o.receive !== false;
      if (o.name) m.name = o.name;
      return m;
    };
    /**
     * Redesenha texturas com texto quando as fontes (declaradas E carregadas) chegarem, inclusive se
     * o CSS das fontes chegar depois. Falha de fonte: ficam as de reserva; exceção no redesenho vai
     * para o relator (Truco.reportError).
     */
    function withFonts(fonts, draw) {
      const U = Truco.GfxUtil;
      if (U && U.onFonts) {
        U.onFonts(fonts, draw, () => !disposed);
        return;
      }
      if (fontsReady(fonts) || typeof document === 'undefined' || !document.fonts || !document.fonts.load) return;
      Promise.all(fonts.map((f) => document.fonts.load(f))).then(
        () => {
          if (disposed) return;
          try {
            draw();
          } catch (e) {
            if (root.console) root.console.error('redesenho', e);
          }
        },
        () => {}
      );
    }
    // Troca de qualidade ao vivo: quem sabe repintar em outro tamanho se registra aqui.
    const resizers = [];
    let texQuality = lowAtBuild ? 'low' : 'high';
    /** Troca a imagem de uma textura por outra de outro tamanho (r159: texStorage2D é imutável). */
    function swapImage(tex, img) {
      if (!tex.image || tex.image.width !== img.width || tex.image.height !== img.height) tex.dispose();
      tex.image = img;
      tex.needsUpdate = true;
    }
    const FONTS = ['400 40px Shrikhand', '700 40px "Barlow Condensed"', '600 40px "Barlow Condensed"'];

    // ------------------------------------------------------------------ céu, névoa e ambiente
    const nightColor = new THREE.Color(0x0b0a0e);
    ctx.scene.background = nightColor;
    const fog = new THREE.Fog(0x120e10, 20, 70);
    ctx.scene.fog = fog;

    // PMREM próprio (gerado uma vez; refeito se o contexto WebGL for perdido e restaurado).
    function makeEnv() {
      const pmrem = new THREE.PMREMGenerator(ctx.renderer);
      const es = new THREE.Scene();
      const tmp = [];
      const add = (geo, color, k, setup) => {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
        setup(m);
        es.add(m);
        tmp.push(geo, m.material);
      };
      add(new THREE.BoxGeometry(40, 26, 40), 0x3a2a20, 1, (m) => (m.material.side = THREE.BackSide));
      add(new THREE.PlaneGeometry(40, 40), 0x4a2a20, 1, (m) => {
        m.rotation.x = Math.PI / 2;
        m.position.y = 12;
      });
      add(new THREE.PlaneGeometry(26, 20), 0x5a1d16, 0.8, (m) => {
        m.rotation.x = Math.PI / 2;
        m.position.set(2, 10, 0);
      });
      add(new THREE.CircleGeometry(1.6, 24), 0xffc98a, 14, (m) => {
        m.rotation.x = Math.PI / 2;
        m.position.y = 9;
      });
      add(new THREE.PlaneGeometry(10, 8), 0xdde6ff, 2.6, (m) => {
        m.rotation.y = -Math.PI / 2;
        m.position.set(19.5, 0, -6);
      });
      add(new THREE.PlaneGeometry(4, 2), 0xfff0d0, 5, (m) => {
        m.rotation.y = -Math.PI / 2;
        m.position.set(19, 2, -6);
      });
      add(new THREE.PlaneGeometry(40, 5), 0xff9a4a, 0.9, (m) => m.position.set(0, -1, -19.5));
      add(new THREE.CircleGeometry(1.2, 16), 0xff8a2a, 9, (m) => m.position.set(-17, 11, -12));
      add(new THREE.PlaneGeometry(40, 40), 0x4a3c30, 1, (m) => {
        m.rotation.x = -Math.PI / 2;
        m.position.y = -8;
      });
      add(new THREE.PlaneGeometry(40, 3), 0xffd9a8, 1.6, (m) => m.position.set(0, 4, -19.8));
      const rt = pmrem.fromScene(es, 0.035);
      tmp.forEach((d) => d.dispose());
      pmrem.dispose();
      return rt;
    }
    let env = makeEnv();
    ctx.scene.environment = env.texture;
    // Depois de restaurar o contexto, os objetos GL do PMREM antigo já morreram com o contexto
    // perdido: só troca a referência (dispose() tentaria apagá-los no contexto novo).
    function rebuildEnv() {
      const old = env;
      env = makeEnv();
      if (ctx.scene.environment === old.texture) ctx.scene.environment = env.texture;
    }

    // ------------------------------------------------------------------ chão (calçada com garoa)
    const texS = lowAtBuild ? 512 : 1024;
    const walk = paintSidewalk(T, texS);
    const walkMap = canvasTex(walk.color);
    const walkData = canvasTex(walk.data, { srgb: false }); // R = altura (bumpMap), G = aspereza (roughnessMap)
    const puddles = canvasTex(paintNoise(T, 128, 7), { srgb: false });
    const dryRect = new THREE.Vector4(L.awning.x0, L.awning.z0, L.awning.x1, L.awning.z1);

    /** Molhado fora do toldo: mais escuro e liso, com poças (roughness quase 0). */
    function wetShader(mat, strength, damp) {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uDry = { value: dryRect };
        shader.uniforms.uPuddles = { value: puddles };
        shader.uniforms.uWet = { value: strength };
        shader.uniforms.uDamp = { value: damp || 0 };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vWetPos;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWetPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            '#include <common>\nvarying vec3 vWetPos;\nuniform vec4 uDry;\nuniform sampler2D uPuddles;\nuniform float uWet;\nuniform float uDamp;'
          )
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
            float wdx = max(uDry.x - vWetPos.x, vWetPos.x - uDry.z);
            float wdz = max(uDry.y - vWetPos.z, vWetPos.z - uDry.w);
            float puddle = texture2D(uPuddles, vWetPos.xz * 0.03).r;
            float wetMask = uWet * smoothstep(-1.0, 3.0, max(wdx, wdz)) * (0.5 + 0.5 * smoothstep(0.42, 0.62, puddle));
            wetMask = max(wetMask, uDamp * smoothstep(0.38, 0.66, puddle));
            diffuseColor.rgb *= 1.0 - 0.25 * wetMask;`
          )
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
            roughnessFactor = mix(roughnessFactor, 0.06 + 0.16 * (1.0 - smoothstep(0.45, 0.7, puddle)), wetMask);`
          );
      };
      mat.customProgramCacheKey = () => 'truco-wet-' + strength + '-' + (damp || 0);
    }

    // Quadradinhos em relevo (bumpMap) com o topo gasto mais liso (roughnessMap) e um brilho leve de
    // garoa respingada mesmo sob o toldo (umidade nas poças); fora do toldo, molhado de vez.
    const walkMat = std({ map: walkMap, bumpMap: walkData, bumpScale: 1.0, roughnessMap: walkData, roughness: 1, metalness: 0, envMapIntensity: 0.55 });
    resizers.push((q) => {
      const w2 = paintSidewalk(T, q === 'low' ? 512 : 1024);
      swapImage(walkMap, w2.color);
      swapImage(walkData, w2.data);
    });
    wetShader(walkMat, 1, 0.28);
    {
      const s = new THREE.Shape();
      s.moveTo(-90, -L.murZ);
      s.lineTo(40, -L.murZ);
      s.lineTo(40, -L.barCornerZ);
      s.lineTo(L.facadeX, -L.barCornerZ);
      s.lineTo(L.facadeX, -80);
      s.lineTo(-90, -80);
      s.closePath();
      const geo = new THREE.ShapeGeometry(s);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const uv = geo.attributes.uv;
      // Um ciclo da textura = SIDEWALK.period placas (1 m); as faixas em zigue-zague correm ao longo de X.
      const P = SIDEWALK.period * SIDEWALK.tile;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / P, pos.getZ(i) / P);
      const floor = mesh(geo, walkMat, { name: 'sidewalk' });
      floor.position.y = F;
      group.add(floor);
    }

    // ------------------------------------------------------------------ mureta baixa e guarda-corpo do mirante
    {
      const conc = canvasTex(paintConcrete(T, 256, 31, '#8d8a84'), { repeat: [22, 1] });
      const mat = std({ map: conc, roughness: 0.9, metalness: 0 });
      wetShader(mat, 0.7);
      const len = 130;
      const cx = -25;
      const wall = mesh(new THREE.BoxGeometry(len, L.murH, L.murT), mat, { name: 'mureta' });
      wall.position.set(cx, F + L.murH / 2, L.murZ - L.murT / 2);
      const capMat = std({ map: conc, color: 0xb9b5ad, roughness: 0.75 });
      wetShader(capMat, 1);
      const cap = mesh(new THREE.BoxGeometry(len + 0.4, 0.3, L.murT + 0.3), capMat);
      cap.position.set(cx, F + L.murH + 0.15, L.murZ - L.murT / 2);
      group.add(wall, cap);
      const rail = [];
      const zr = L.murZ - L.murT / 2;
      const y0 = F + L.murH + 0.3;
      // Postes do guarda-corpo a cada 2,6 m, alinhados para cair atrás das cabeças ou fora do quadro.
      // Postes só longe do centro (|x| ≥ 26): perto da mesa eles cruzavam a skyline na diagonal.
      for (let x = -69; x < cx + len / 2; x += 26) {
        if (Math.abs(x) >= 26) rail.push({ geo: rod(THREE, [x, y0, zr], [x, F + L.railH, zr], 0.085, 8) });
      }
      rail.push({ geo: rod(THREE, [cx - len / 2, F + L.railH, zr], [cx + len / 2, F + L.railH, zr], 0.06, 8) });
      rail.push({ geo: rod(THREE, [cx - len / 2, F + 5.6, zr], [cx + len / 2, F + 5.6, zr], 0.05, 6) });
      group.add(mesh(merge(THREE, rail), std({ color: 0x2f3b35, roughness: 0.45, metalness: 0.6 }), { name: 'guarda-corpo' }));
    }

    // ------------------------------------------------------------------ fachada e bar
    const bar = buildBar();
    function buildBar() {
      const g = new THREE.Group();
      g.name = 'bar';
      const hi = !lowAtBuild;
      const fw = L.barFarZ - L.barCornerZ;
      const facadeCanvas = paintFacade(T, hi ? 2048 : 1024, Math.round(((hi ? 2048 : 1024) * L.barH) / fw));
      const facadeTex = canvasTex(facadeCanvas, { wrap: false });
      const facadeSize = (q) => {
        const w = q === 'low' ? 1024 : 2048;
        return [w, Math.round((w * L.barH) / fw)];
      };
      withFonts(FONTS, () => {
        const [w, h] = facadeSize(texQuality);
        swapImage(facadeTex, paintFacade(T, w, h));
      });
      resizers.push((q) => {
        const [w, h] = facadeSize(q);
        swapImage(facadeTex, paintFacade(T, w, h));
      });
      const facade = mesh(new THREE.PlaneGeometry(fw, L.barH), std({ map: facadeTex, alphaTest: 0.5, roughness: 0.85 }), { name: 'facade' });
      facade.rotation.y = -Math.PI / 2;
      facade.position.set(L.facadeX, F + L.barH / 2, (L.barCornerZ + L.barFarZ) / 2);
      g.add(facade);

      const sideW = 40 - L.facadeX;
      const sideCanvas = paintSideWall(T, hi ? 1024 : 512, Math.round(((hi ? 1024 : 512) * L.barH) / sideW));
      const sideTex = canvasTex(sideCanvas, { wrap: false });
      const sideSize = (q) => {
        const w = q === 'low' ? 512 : 1024;
        return [w, Math.round((w * L.barH) / sideW)];
      };
      withFonts(FONTS, () => {
        const [w, h] = sideSize(texQuality);
        swapImage(sideTex, paintSideWall(T, w, h));
      });
      resizers.push((q) => {
        const [w, h] = sideSize(q);
        swapImage(sideTex, paintSideWall(T, w, h));
      });
      const side = mesh(new THREE.PlaneGeometry(sideW, L.barH), std({ map: sideTex, roughness: 0.85 }), { name: 'bar-side' });
      side.rotation.y = Math.PI;
      side.position.set((L.facadeX + 40) / 2, F + L.barH / 2, L.barCornerZ);
      g.add(side);

      const plain = std({ color: 0xa87a36, roughness: 0.9 });
      const thick = 0.5;
      const op = L.opening;
      const jamb = merge(THREE, [
        { geo: new THREE.PlaneGeometry(thick, op.h), m: xf(THREE, L.facadeX + thick / 2, F + op.h / 2, op.z0, 0, 0, 0) },
        { geo: new THREE.PlaneGeometry(thick, op.h), m: xf(THREE, L.facadeX + thick / 2, F + op.h / 2, op.z1, 0, Math.PI, 0) },
        { geo: new THREE.PlaneGeometry(thick, op.z1 - op.z0), m: xf(THREE, L.facadeX + thick / 2, F + op.h, (op.z0 + op.z1) / 2, Math.PI / 2, 0, 0) },
        { geo: new THREE.BoxGeometry(31, 1, 46), m: xf(THREE, (L.facadeX + 40) / 2 + 0.3, F + L.barH + 0.5, (L.barCornerZ + L.barFarZ) / 2) },
      ]);
      g.add(mesh(jamb, plain));

      // Interior: piso vermelho encerado, azulejos até 1,5 m, parede pintada, forro.
      const X0 = L.facadeX + thick;
      const X1 = 30;
      const Z0 = L.barCornerZ + 0.5;
      const Z1 = 12;
      const CH = 32;
      const redFloor = canvasTex(paintTiles(T, lowAtBuild ? 256 : 512, 8, [150, 52, 36], '#4a2016', 41), {});
      const floorMat = std({ map: redFloor, roughness: 0.28, metalness: 0, envMapIntensity: 1.1 });
      const fl = mesh(worldPlane(THREE, X1 - X0, Z1 - Z0, 1 / 16, 1 / 16), floorMat);
      fl.rotation.x = -Math.PI / 2;
      fl.position.set((X0 + X1) / 2, F + 0.01, (Z0 + Z1) / 2);
      g.add(fl);
      const tileTex = canvasTex(paintTiles(T, lowAtBuild ? 256 : 512, 8, [236, 236, 230], '#9a968e', 42, { row: 0, color: [40, 90, 150] }), {});
      const tileMat = std({ map: tileTex, roughness: 0.22, envMapIntensity: 1 });
      const TH = 15;
      const tiles = merge(THREE, [
        { geo: worldPlane(THREE, Z1 - Z0, TH, 1 / 12, 1 / 12), m: xf(THREE, X1, F + TH / 2, (Z0 + Z1) / 2, 0, -Math.PI / 2, 0) },
        { geo: worldPlane(THREE, X1 - X0, TH, 1 / 12, 1 / 12), m: xf(THREE, (X0 + X1) / 2, F + TH / 2, Z0, 0, 0, 0) },
        { geo: worldPlane(THREE, X1 - X0, TH, 1 / 12, 1 / 12), m: xf(THREE, (X0 + X1) / 2, F + TH / 2, Z1, 0, Math.PI, 0) },
      ]);
      g.add(mesh(tiles, tileMat));
      const paintMat = std({ color: 0xa9bca5, roughness: 0.9 });
      const upper = merge(THREE, [
        { geo: new THREE.PlaneGeometry(Z1 - Z0, CH - TH), m: xf(THREE, X1, F + (TH + CH) / 2, (Z0 + Z1) / 2, 0, -Math.PI / 2, 0) },
        { geo: new THREE.PlaneGeometry(X1 - X0, CH - TH), m: xf(THREE, (X0 + X1) / 2, F + (TH + CH) / 2, Z0, 0, 0, 0) },
        { geo: new THREE.PlaneGeometry(X1 - X0, CH - TH), m: xf(THREE, (X0 + X1) / 2, F + (TH + CH) / 2, Z1, 0, Math.PI, 0) },
        { geo: new THREE.PlaneGeometry(X1 - X0, Z1 - Z0), m: xf(THREE, (X0 + X1) / 2, F + CH, (Z0 + Z1) / 2, Math.PI / 2, 0, 0) },
      ]);
      g.add(mesh(upper, paintMat));

      // Balcão virado para a calçada, com tampo de inox e plaquinha.
      const C = L.counter;
      const frontW = op.z1 - op.z0 - 0.2;
      const counterTex = canvasTex(paintCounterFront(T, frontW, C.h), { wrap: false });
      withFonts(FONTS, () => {
        counterTex.image = paintCounterFront(T, frontW, C.h);
        counterTex.needsUpdate = true;
      });
      const inox = std({ color: 0xc9ccd0, roughness: 0.32, metalness: 0.9, envMapIntensity: 1.2 });
      const counterBody = mesh(new THREE.BoxGeometry(C.x1 - C.x0 - 0.02, C.h, op.z1 - op.z0 - 0.2), std({ color: 0x6e5a48, roughness: 0.8 }));
      counterBody.position.set((C.x0 + C.x1) / 2 + 0.01, F + C.h / 2, (op.z0 + op.z1) / 2);
      const counterFront = mesh(new THREE.PlaneGeometry(frontW, C.h), std({ map: counterTex, roughness: 0.4 }));
      counterFront.rotation.y = -Math.PI / 2;
      counterFront.position.set(C.x0, F + C.h / 2, (op.z0 + op.z1) / 2);
      g.add(counterBody, counterFront);
      const top = mesh(new THREE.BoxGeometry(C.x1 - C.x0 + 0.5, 0.3, op.z1 - op.z0 + 0.3), inox);
      top.position.set((C.x0 + C.x1) / 2 - 0.15, F + C.h + 0.15, (op.z0 + op.z1) / 2);
      g.add(top);
      const plaqueTex = canvasTex(paintPlaque(T), { wrap: false });
      withFonts(FONTS, () => {
        plaqueTex.image = paintPlaque(T);
        plaqueTex.needsUpdate = true;
      });
      const plaque = mesh(new THREE.PlaneGeometry(2.6, 1.3), std({ map: plaqueTex, roughness: 0.5 }));
      plaque.rotation.y = -Math.PI / 2;
      plaque.position.set(C.x0 - 0.03, F + 7.1, -6.4);
      plaque.rotation.z = 0.04;
      g.add(plaque);

      // Estufa de salgados sobre o balcão (luz fria por dentro).
      const topY = F + C.h + 0.3;
      const ez0 = -8.4;
      const ez1 = -3.9;
      const ex0 = 9.55;
      const ex1 = 11.35;
      const eh = 4.3;
      const frameMat = std({ color: 0xb8bcc2, roughness: 0.35, metalness: 0.85 });
      const estufaFrame = merge(THREE, [
        { geo: new THREE.BoxGeometry(ex1 - ex0, 0.6, ez1 - ez0), m: xf(THREE, (ex0 + ex1) / 2, topY + 0.3, (ez0 + ez1) / 2) },
        { geo: new THREE.BoxGeometry(ex1 - ex0, 0.2, ez1 - ez0), m: xf(THREE, (ex0 + ex1) / 2, topY + eh, (ez0 + ez1) / 2) },
        ...[ez0, ez1].map((z) => ({ geo: new THREE.BoxGeometry(0.12, eh - 0.6, 0.12), m: xf(THREE, ex0 + 0.06, topY + 0.6 + (eh - 0.6) / 2, z) })),
        ...[ez0, ez1].map((z) => ({ geo: new THREE.BoxGeometry(0.12, eh - 0.6, 0.12), m: xf(THREE, ex1 - 0.06, topY + 0.6 + (eh - 0.6) / 2, z) })),
      ]);
      g.add(mesh(estufaFrame, frameMat, { cast: false }));
      const glassMat = track(
        new THREE.MeshPhysicalMaterial({
          color: 0xe8f2ff,
          roughness: 0.05,
          metalness: 0,
          transparent: true,
          opacity: 0.16,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
          envMapIntensity: 1.6,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      const estufaGlass = merge(THREE, [
        { geo: new THREE.PlaneGeometry(ez1 - ez0, eh - 0.8), m: xf(THREE, ex0 + 0.02, topY + 0.6 + (eh - 0.8) / 2, (ez0 + ez1) / 2, 0, -Math.PI / 2, 0) },
        { geo: new THREE.PlaneGeometry(ex1 - ex0, eh - 0.8), m: xf(THREE, (ex0 + ex1) / 2, topY + 0.6 + (eh - 0.8) / 2, ez0, 0, 0, 0) },
        { geo: new THREE.PlaneGeometry(ex1 - ex0, eh - 0.8), m: xf(THREE, (ex0 + ex1) / 2, topY + 0.6 + (eh - 0.8) / 2, ez1, 0, 0, 0) },
        { geo: new THREE.PlaneGeometry(ex1 - ex0, ez1 - ez0), m: xf(THREE, (ex0 + ex1) / 2, topY + 0.6 + 1.6, (ez0 + ez1) / 2, -Math.PI / 2, 0, 0) },
      ]);
      const glass = mesh(estufaGlass, glassMat, { receive: false });
      glass.renderOrder = 3;
      g.add(glass);
      const lightStrip = mesh(new THREE.BoxGeometry(1.2, 0.08, ez1 - ez0 - 0.4), basic({ color: new THREE.Color(0xeaf4ff).multiplyScalar(3), toneMapped: true }));
      lightStrip.position.set((ex0 + ex1) / 2, topY + eh - 0.15, (ez0 + ez1) / 2);
      g.add(lightStrip);
      // Salgados: coxinhas, pastéis, quibes e esfihas em duas prateleiras.
      const rnd = T.mulberry32(404);
      const snacks = [];
      const coxinha = [[0, 0], [0.2, 0.02], [0.23, 0.1], [0.2, 0.26], [0.13, 0.42], [0.05, 0.55], [0, 0.58]];
      const quibe = [[0, 0], [0.06, 0.02], [0.13, 0.15], [0.15, 0.3], [0.13, 0.45], [0.06, 0.58], [0, 0.6]];
      for (const [shelfY, row] of [
        [topY + 0.62, 0],
        [topY + 0.62 + 1.62, 1],
      ]) {
        for (let i = 0; i < 7; i++) {
          const z = ez0 + 0.45 + i * ((ez1 - ez0 - 0.9) / 6) + (rnd() - 0.5) * 0.1;
          const x = ex0 + 0.55 + rnd() * 0.5;
          const kind = (i + row * 2) % 4;
          if (kind === 0) snacks.push({ geo: lathe(THREE, coxinha, 10), m: xf(THREE, x, shelfY, z, 0, rnd() * 3, 0.1), c: '#c07a2c' });
          else if (kind === 1) snacks.push({ geo: new THREE.CylinderGeometry(0.34, 0.34, 0.1, 14, 1, false, 0, Math.PI), m: xf(THREE, x, shelfY + 0.06, z, 0, rnd() * 0.6 - 0.3 + Math.PI / 2, 0, 1, 1, 0.9), c: '#dca653' });
          else if (kind === 2) snacks.push({ geo: lathe(THREE, quibe, 10), m: xf(THREE, x, shelfY + 0.14, z, 0, 0, Math.PI / 2 - 0.1), c: '#7b4722' });
          else snacks.push({ geo: new THREE.CylinderGeometry(0.28, 0.3, 0.1, 14), m: xf(THREE, x, shelfY + 0.05, z), c: '#b95a2c' });
        }
      }
      snacks.push({ geo: new THREE.BoxGeometry(ex1 - ex0 - 0.2, 0.04, ez1 - ez0 - 0.2), m: xf(THREE, (ex0 + ex1) / 2, topY + 0.6 + 1.6, (ez0 + ez1) / 2), c: '#dfe8f0' });
      g.add(mesh(merge(THREE, snacks, true), std({ vertexColors: true, roughness: 0.55, emissive: 0x6a4420, emissiveIntensity: 1.1 }), { cast: false }));

      // Pote de ovos coloridos (clássico de boteco) no balcão.
      {
        const eggs = [];
        for (let i = 0; i < 6; i++) {
          eggs.push({ geo: new THREE.SphereGeometry(0.2, 10, 8), m: xf(THREE, 10.5 + (rnd() - 0.5) * 0.35, topY + 0.3 + (i % 3) * 0.32, -2.7 + (rnd() - 0.5) * 0.35, 0, 0, rnd(), 1, 1.3, 1), c: i % 2 ? '#d85a8c' : '#b0408a' });
        }
        eggs.push({ geo: new THREE.CylinderGeometry(0.62, 0.62, 0.22, 20), m: xf(THREE, 10.5, topY + 1.45, -2.7), c: '#b3261e' });
        g.add(mesh(merge(THREE, eggs, true), std({ vertexColors: true, roughness: 0.4 })));
        const jar = mesh(new THREE.CylinderGeometry(0.58, 0.58, 1.3, 20, 1, true), glassMat, { receive: false });
        jar.position.set(10.5, topY + 0.68, -2.7);
        jar.renderOrder = 3;
        g.add(jar);
      }

      // Porta de aço enrolada no alto do vão e guias laterais.
      const steel = std({ color: 0x7c8086, roughness: 0.55, metalness: 0.7 });
      const doorParts = merge(THREE, [
        { geo: new THREE.BoxGeometry(1.4, 2.8, op.z1 - op.z0 + 0.6), m: xf(THREE, L.facadeX + 0.7, F + op.h + 1.2, (op.z0 + op.z1) / 2) },
        { geo: new THREE.BoxGeometry(0.12, 0.7, op.z1 - op.z0), m: xf(THREE, L.facadeX + 0.2, F + op.h - 0.25, (op.z0 + op.z1) / 2) },
        { geo: new THREE.BoxGeometry(0.35, op.h, 0.3), m: xf(THREE, L.facadeX + 0.18, F + op.h / 2, op.z0 - 0.05) },
        { geo: new THREE.BoxGeometry(0.35, op.h, 0.3), m: xf(THREE, L.facadeX + 0.18, F + op.h / 2, op.z1 + 0.05) },
      ]);
      g.add(mesh(doorParts, steel));

      // Prateleiras com garrafas e espelho no fundo.
      const wood = std({ color: 0x5b3a22, roughness: 0.7 });
      const shelfZ0 = -6;
      const shelfZ1 = 6;
      const shelves = [];
      for (const h of [17, 20.5, 24]) shelves.push({ geo: new THREE.BoxGeometry(1.3, 0.25, shelfZ1 - shelfZ0), m: xf(THREE, X1 - 0.65, F + h, 0) });
      g.add(mesh(merge(THREE, shelves), wood));
      const mirror = mesh(new THREE.PlaneGeometry(shelfZ1 - shelfZ0 + 0.6, 10), std({ color: 0x9aa4ac, roughness: 0.06, metalness: 1, envMapIntensity: 1.3 }));
      mirror.rotation.y = -Math.PI / 2;
      mirror.position.set(X1 - 0.03, F + 21.5, 0);
      g.add(mirror);
      const bottleShapes = [
        [[0, 0], [0.34, 0], [0.36, 0.1], [0.36, 1.5], [0.3, 1.8], [0.13, 2.1], [0.12, 2.6], [0.14, 2.65], [0, 2.7]],
        [[0, 0], [0.42, 0], [0.44, 0.1], [0.44, 1.1], [0.2, 1.5], [0.14, 1.9], [0.16, 1.95], [0, 2.0]],
        [[0, 0], [0.3, 0], [0.32, 0.1], [0.32, 1.9], [0.12, 2.3], [0.1, 3.0], [0.12, 3.05], [0, 3.1]],
      ];
      const glassColors = ['#6b3a12', '#c9d6c2', '#2f5a2a', '#8a5a1a', '#d8e0d8', '#7a2a1a'];
      const bottles = [];
      const labels = [];
      for (const [hi2, level] of [
        [17.13, 0],
        [20.63, 1],
        [24.13, 2],
      ]) {
        for (let i = 0; i < 10; i++) {
          const s = (i + level) % 3;
          const z = shelfZ0 + 0.6 + i * 1.18 + (rnd() - 0.5) * 0.2;
          const x = X1 - 0.7 + (rnd() - 0.5) * 0.25;
          const sc = 0.95 + rnd() * 0.15;
          bottles.push({ geo: lathe(THREE, bottleShapes[s], s === 1 ? 4 : 12), m: xf(THREE, x, F + hi2, z, 0, s === 1 ? Math.PI / 4 : 0, 0, sc), c: glassColors[(i * 5 + level) % glassColors.length] });
          labels.push({ geo: new THREE.CylinderGeometry(0.37 * sc, 0.37 * sc, 0.6, 12, 1, true, -Math.PI / 2 - 1, 2), m: xf(THREE, x, F + hi2 + 0.8 * sc, z, 0, 0, 0), c: ['#efe3c2', '#f2c230', '#e8e8e8', '#c8a060'][(i + level) % 4] });
        }
      }
      g.add(mesh(merge(THREE, bottles, true), std({ vertexColors: true, roughness: 0.12, metalness: 0.1, envMapIntensity: 1.5 })));
      g.add(mesh(merge(THREE, labels, true), std({ vertexColors: true, roughness: 0.8 })));

      // TV passando futebol: dia de jogo, o bar pôs a TV num rack de rodinhas na calçada, encostado
      // na quina do prédio e virado para as mesas. Com a câmera do jogo (alta, olhando a mesa), uma
      // TV de parede ficaria fora do quadro; aqui ela aparece entre a parceira e o painel da vira.
      const tvMat = track(tvMaterial(THREE));
      const tv = new THREE.Group();
      tv.position.set(TV_SPOT.x, F, TV_SPOT.z);
      tv.rotation.y = Math.atan2(-TV_SPOT.x, 7.6 - TV_SPOT.z);
      const tvW = 3.9;
      const tvH = 2.4;
      const tvY = TV_SPOT.h;
      const tvBody = mesh(new THREE.BoxGeometry(tvW + 0.3, tvH + 0.3, 0.35), std({ color: 0x151515, roughness: 0.5 }), { cast: true });
      tvBody.position.y = tvY;
      const screen = mesh(new THREE.PlaneGeometry(tvW, tvH), tvMat, { receive: false });
      screen.position.set(0, tvY, 0.18);
      const rackParts = [
        { geo: new THREE.BoxGeometry(2.6, 0.12, 1.2), m: xf(THREE, 0, tvY - tvH / 2 - 0.2, 0) },
        { geo: new THREE.BoxGeometry(2.6, 0.12, 1.2), m: xf(THREE, 0, 1.6, 0) },
        { geo: new THREE.BoxGeometry(0.4, 0.5, 0.35), m: xf(THREE, 0, tvY - tvH / 2 - 0.4, 0) },
      ];
      for (const sx of [-1.2, 1.2]) {
        for (const sz of [-0.5, 0.5]) {
          rackParts.push({ geo: new THREE.BoxGeometry(0.1, tvY - tvH / 2 - 0.2, 0.1), m: xf(THREE, sx, (tvY - tvH / 2 - 0.2) / 2, sz) });
          rackParts.push({ geo: new THREE.SphereGeometry(0.16, 8, 6), m: xf(THREE, sx, 0.16, sz) });
        }
      }
      const rack = mesh(merge(THREE, rackParts), std({ color: 0x2b2b2e, roughness: 0.45, metalness: 0.6 }), { cast: true });
      tv.add(tvBody, screen, rack);
      g.add(tv);
      updaters.push((dt, t) => {
        tvMat.uniforms.uTime.value = t;
      });

      // Ventilador de teto.
      const fan = new THREE.Group();
      fan.position.set(20, F + CH - 1.6, 0);
      const fanMat = std({ color: 0xe9e6de, roughness: 0.6 });
      fan.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6), fanMat));
      const hub = mesh(new THREE.CylinderGeometry(0.5, 0.4, 0.5, 14), fanMat);
      hub.position.y = -0.7;
      const blades = new THREE.Group();
      blades.position.y = -0.85;
      const bladeGeo = merge(THREE, [0, 1, 2].map((i) => ({ geo: new THREE.BoxGeometry(4.2, 0.05, 0.9), m: xf(THREE, Math.cos((i * Math.PI * 2) / 3) * 2.4, 0, Math.sin((i * Math.PI * 2) / 3) * 2.4, 0, -(i * Math.PI * 2) / 3, 0.06) })));
      blades.add(mesh(bladeGeo, std({ color: 0x8a6a45, roughness: 0.6 })));
      fan.add(hub, blades);
      g.add(fan);
      updaters.push((dt) => {
        blades.rotation.y += dt * 3.4;
      });

      // Luminária fluorescente, relógio e freezer "Garoa".
      const tube = mesh(new THREE.BoxGeometry(0.5, 0.25, 12), basic({ color: new THREE.Color(0xf2f7ff).multiplyScalar(1.8) }), { receive: false });
      tube.position.set(15, F + CH - 0.2, 0);
      g.add(tube);
      const clockTex = canvasTex(paintClock(T), { wrap: false });
      const clock = mesh(new THREE.CircleGeometry(1.2, 24), std({ map: clockTex, roughness: 0.4 }));
      clock.position.set(22, F + 25, Z0 + 0.05);
      g.add(clock);
      const freezerTex = canvasTex(paintFreezer(T), { wrap: false });
      withFonts(FONTS, () => {
        freezerTex.image = paintFreezer(T);
        freezerTex.needsUpdate = true;
      });
      const freezer = mesh(
        merge(
          THREE,
          [
            { geo: new THREE.BoxGeometry(13, 8.3, 6.6), m: xf(THREE, 0, 4.15, 0), c: '#eef0ee' },
            { geo: new THREE.BoxGeometry(12.6, 0.2, 6.2), m: xf(THREE, 0, 8.35, 0), c: '#9fb2bd' },
          ],
          true
        ),
        std({ vertexColors: true, roughness: 0.4 })
      );
      freezer.position.set(21, F, Z1 - 3.4);
      const freezerFront = mesh(new THREE.PlaneGeometry(13, 8.3), std({ map: freezerTex, roughness: 0.45 }));
      freezerFront.position.set(0, 4.15, -3.31);
      freezerFront.rotation.y = Math.PI;
      freezer.add(freezerFront);
      g.add(freezer);

      // Luz do interior (sem sombra) e o "vazamento" frio da estufa na calçada.
      const inLight = new THREE.PointLight(0xe3ecff, 90, 26, 2);
      inLight.position.set(19, F + 28, 0);
      g.add(inLight);
      // Luz fria (fluorescente da estufa) saindo pelo vão para a calçada e as costas do Tião; sem sombra.
      const coolLight = new THREE.PointLight(0xa9c4ff, 48, 34, 2);
      coolLight.position.set(11, F + 10.9, (op.z0 + op.z1) / 2);
      g.add(coolLight);
      const spillTex = canvasTex(paintGlow(T, 'rgba(255,255,255,0.9)', 'rgba(255,255,255,0.35)'), { wrap: false });
      const spill = mesh(new THREE.PlaneGeometry(9, 16), basic({ map: spillTex, color: 0x9fb8e0, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }), { receive: false });
      spill.rotation.x = -Math.PI / 2;
      spill.position.set(L.facadeX - 3.2, F + 0.03, (op.z0 + op.z1) / 2);
      g.add(spill);

      // Cavalete com a lousa de preços na calçada, virado para a mesa.
      const board = new THREE.Group();
      board.position.set(BOARD_SPOT.x, F, BOARD_SPOT.z);
      board.rotation.y = Math.atan2(-BOARD_SPOT.x, 7.6 - BOARD_SPOT.z);
      const boardTex = canvasTex(paintChalkboard(T, lowAtBuild ? 384 : 512, lowAtBuild ? 480 : 640), { wrap: false });
      withFonts(FONTS, () => {
        boardTex.image = paintChalkboard(T, boardTex.image.width, boardTex.image.height);
        boardTex.needsUpdate = true;
      });
      const bw = BOARD_SPOT.w;
      const bh = BOARD_SPOT.h;
      const lean = 0.2;
      const legH = bh + 3.1;
      const legZ = 0.95 * (bh / 6.5);
      const face = mesh(new THREE.PlaneGeometry(bw, bh), std({ map: boardTex, roughness: 0.95 }));
      face.position.set(0, 1.5 + (bh / 2) * Math.cos(lean), Math.sin(lean) * (bh / 2) + 0.04);
      face.rotation.x = -lean;
      const frame = merge(THREE, [
        { geo: new THREE.BoxGeometry(0.3, legH, 0.26), m: xf(THREE, -bw / 2 - 0.1, legH / 2 - 0.1, legZ, -lean) },
        { geo: new THREE.BoxGeometry(0.3, legH, 0.26), m: xf(THREE, bw / 2 + 0.1, legH / 2 - 0.1, legZ, -lean) },
        { geo: new THREE.BoxGeometry(0.3, legH, 0.26), m: xf(THREE, -bw / 2 - 0.1, legH / 2 - 0.1, -legZ, lean) },
        { geo: new THREE.BoxGeometry(0.3, legH, 0.26), m: xf(THREE, bw / 2 + 0.1, legH / 2 - 0.1, -legZ, lean) },
        { geo: new THREE.BoxGeometry(bw + 0.5, 0.3, 0.26), m: xf(THREE, 0, 1.4, 1.2 * (bh / 6.5), -lean) },
        { geo: new THREE.BoxGeometry(bw + 0.5, 0.3, 0.26), m: xf(THREE, 0, 1.5 + bh * Math.cos(lean) + 0.1, 0.05, -lean) },
        { geo: new THREE.BoxGeometry(bw + 0.2, bh, 0.12), m: xf(THREE, 0, 1.5 + (bh / 2) * Math.cos(lean), -Math.sin(lean) * (bh / 2) - 0.05, lean) },
      ]);
      board.add(face, mesh(frame, wood));
      g.add(board);

      // Toldo listrado sobre a mesa, com bambinela recortada e braços de ferro.
      const A = L.awning;
      const awnTex = canvasTex(paintAwning(T), { repeat: [1, 1] });
      const slopeLen = Math.hypot(A.x1 - A.x0, A.yWall - A.yEdge);
      const slope = Math.atan2(A.yWall - A.yEdge, A.x1 - A.x0);
      const awnGeo = new THREE.PlaneGeometry(A.z1 - A.z0, slopeLen);
      const awnMat = std({ map: awnTex, roughness: 0.9, side: THREE.DoubleSide });
      const awning = mesh(awnGeo, awnMat, { receive: false });
      {
        // Listras descendo o caimento: X local = +Z do mundo, Y local = subida até a parede.
        const ax = new THREE.Vector3(0, 0, 1);
        const ay = new THREE.Vector3(Math.cos(slope), Math.sin(slope), 0);
        const az = new THREE.Vector3().crossVectors(ax, ay);
        awning.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, ay, az));
      }
      awning.position.set((A.x0 + A.x1) / 2, F + (A.yWall + A.yEdge) / 2, (A.z0 + A.z1) / 2);
      g.add(awning);
      const valTex = canvasTex(paintValance(T), { repeat: [3, 1] });
      const valance = mesh(new THREE.PlaneGeometry(A.z1 - A.z0, 1.6), std({ map: valTex, alphaTest: 0.5, roughness: 0.9, side: THREE.DoubleSide }), { receive: false });
      valance.rotation.y = -Math.PI / 2;
      valance.position.set(A.x0, F + A.yEdge - 0.8, (A.z0 + A.z1) / 2);
      g.add(valance);
      const irons = [];
      for (const z of [A.z0 + 0.3, 0.3, A.z1 - 0.3]) irons.push({ geo: rod(THREE, [A.x1, F + A.yWall - 0.2, z], [A.x0, F + A.yEdge - 0.1, z], 0.08, 6) });
      irons.push({ geo: rod(THREE, [A.x0, F + A.yEdge - 0.1, A.z0], [A.x0, F + A.yEdge - 0.1, A.z1], 0.1, 6) });
      g.add(mesh(merge(THREE, irons), std({ color: 0x2a2a2c, roughness: 0.5, metalness: 0.6 }), { receive: false }));

      return { group: g, inLight, coolLight };
    }
    group.add(bar.group);

    // ------------------------------------------------------------------ calçada à esquerda: poste, lixeira, árvore
    const street = (() => {
      const g = new THREE.Group();
      const concrete = std({ color: 0x8e8b86, roughness: 0.85 });
      const px = -40;
      const pz = -14.4;
      const headY = F + 56;
      const parts = [
        { geo: new THREE.CylinderGeometry(0.3, 0.5, 58, 10), m: xf(THREE, px, F + 29, pz) },
        { geo: rod(THREE, [px, F + 55, pz], [px + 4.5, F + 57, pz + 1.5], 0.14, 6) },
      ];
      g.add(mesh(merge(THREE, parts), concrete, { receive: false }));
      const head = mesh(new THREE.BoxGeometry(2.2, 0.5, 0.9), std({ color: 0x3a3a3a, roughness: 0.5, metalness: 0.5 }));
      head.position.set(px + 4.8, headY, pz + 1.6);
      g.add(head);
      const bulb = mesh(new THREE.BoxGeometry(1.7, 0.1, 0.6), basic({ color: new THREE.Color(0xffa24a).multiplyScalar(3) }), { receive: false });
      bulb.position.set(px + 4.8, headY - 0.3, pz + 1.6);
      g.add(bulb);
      const glow = new THREE.Sprite(basicSprite(paintGlow(T, 'rgba(255,190,110,1)', 'rgba(255,140,50,0.4)'), 0xffffff, 0.9));
      glow.position.set(px + 4.8, headY - 0.6, pz + 1.6);
      glow.scale.setScalar(6);
      g.add(glow);
      // Lixeira laranja da prefeitura, num poste baixo.
      const bin = [];
      bin.push({ geo: new THREE.CylinderGeometry(0.12, 0.12, 9.5, 8), m: xf(THREE, -36, F + 4.75, -13.6), c: '#5a5a5a' });
      bin.push({ geo: lathe(THREE, [[0, 0], [1.05, 0], [1.2, 0.3], [1.3, 3.4], [1.15, 3.55], [1.05, 3.5], [0.95, 0.4], [0, 0.35]], 16), m: xf(THREE, -36, F + 5.6, -13.6 + 0.9), c: '#e8741c' });
      g.add(mesh(merge(THREE, bin, true), std({ vertexColors: true, roughness: 0.55 })));
      // Árvore da calçada: tronco e canteiro.
      const tree = [];
      tree.push({ geo: new THREE.CylinderGeometry(0.55, 0.8, 34, 9), m: xf(THREE, -44, F + 17, -11.5, 0.03, 0, -0.04), c: '#3b2c22' });
      tree.push({ geo: new THREE.BoxGeometry(5, 0.5, 5), m: xf(THREE, -44, F + 0.25, -11.5), c: '#6a655e' });
      tree.push({ geo: new THREE.BoxGeometry(4.2, 0.3, 4.2), m: xf(THREE, -44, F + 0.3, -11.5), c: '#2a2118' });
      for (const [dx, dy, dz, r] of [[0, 38, 0, 7], [4, 36, 2, 5], [-4, 37, -2, 5.5], [1, 42, -3, 5]]) {
        tree.push({ geo: new THREE.IcosahedronGeometry(r, 1), m: xf(THREE, -44 + dx, F + dy, -11.5 + dz, 0, dx, 0, 1, 0.75, 1), c: '#2d3d22' });
      }
      g.add(mesh(merge(THREE, tree, true), std({ vertexColors: true, roughness: 0.9, flatShading: true })));
      return { group: g };
    })();
    group.add(street.group);

    // ------------------------------------------------------------------ luminária pendente
    const lamp = (() => {
      const key = ctx.lights.key;
      const pivot = new THREE.Group();
      const anchorY = F + L.awning.yEdge + ((L.awning.yWall - L.awning.yEdge) * (0 - L.awning.x0)) / (L.awning.x1 - L.awning.x0) - 0.2;
      pivot.position.set(key.position.x, anchorY, key.position.z);
      const hang = anchorY - key.position.y;
      const body = new THREE.Group();
      body.position.y = -hang;
      const alu = std({ color: 0xcfd3d8, roughness: 0.28, metalness: 0.9, envMapIntensity: 1.3, side: THREE.DoubleSide });
      const shadeGeo = lathe(THREE, [[0.1, 0.72], [0.18, 0.7], [0.24, 0.52], [0.5, 0.26], [0.86, 0.04], [0.9, 0]], 36);
      const shadeMesh = mesh(shadeGeo, alu, { cast: false, receive: false });
      shadeMesh.position.y = -0.02;
      const socket = mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.38, 12), std({ color: 0x1a1612, roughness: 0.5 }), { receive: false });
      socket.position.y = 0.72;
      const bulb = mesh(new THREE.SphereGeometry(0.19, 16, 12), basic({ color: new THREE.Color(0xffe0b0).multiplyScalar(4), toneMapped: false }), { receive: false });
      bulb.position.y = 0.2;
      const cable = mesh(new THREE.CylinderGeometry(0.025, 0.025, hang, 6), std({ color: 0x111111, roughness: 0.6 }), { receive: false });
      cable.position.y = hang / 2 + 0.3;
      body.add(shadeMesh, socket, bulb, cable);
      const glow = new THREE.Sprite(basicSprite(paintGlow(T, 'rgba(255,230,190,1)', 'rgba(255,190,110,0.35)'), 0xffffff, 0.9));
      glow.scale.setScalar(2.4);
      glow.position.y = 0.15;
      body.add(glow);
      pivot.add(body);
      const tmp = new THREE.Vector3();
      const home0 = key.position.clone();
      const home = key.position.clone();
      const fillHome = ctx.lights.fill.position.clone();
      const baseIntensity = key.intensity;
      const baseAngle = key.angle;
      const fillBase = ctx.lights.fill.intensity;
      const swing = { amp: 0, t: 0, flick: 0 };
      // Em retrato a câmera fica alta e a luminária encostava na cabeça da parceira: a lâmpada
      // (corpo, SpotLight e luz de preenchimento) sobe LAMP_LIFT, com o cone e a intensidade
      // compensados para a poça de luz na mesa continuar igual.
      const LAMP_LIFT = 2;
      const lift = { v: -1 };
      const cableH = hang;
      function applyLift(v) {
        lift.v = v;
        const dy = LAMP_LIFT * v;
        body.position.y = -hang + dy;
        cable.scale.y = Math.max(0.05, (cableH - dy) / cableH);
        cable.position.y = (cableH - dy) / 2 + 0.3;
        home.set(home0.x, home0.y + dy, home0.z);
        ctx.lights.fill.position.set(fillHome.x, fillHome.y + dy, fillHome.z);
        const h0 = Math.max(1, home0.y);
        const h1 = h0 + dy;
        key.angle = Math.atan((Math.tan(baseAngle) * h0) / h1);
        lift.gain = (h1 * h1) / (h0 * h0);
        if (swing.amp <= 0.0005) key.position.copy(home);
      }
      function update(dt, t) {
        const portrait = ctx.camera.aspect > 0 && ctx.camera.aspect < 0.8 ? 1 : 0;
        if (lift.v < 0) applyLift(portrait);
        else if (Math.abs(portrait - lift.v) > 0.001) {
          const k = Math.min(1, dt * 4);
          applyLift(Math.abs(portrait - lift.v) < 0.01 ? portrait : lift.v + (portrait - lift.v) * k);
        }
        if (swing.amp > 0.0005) {
          swing.t += dt;
          swing.amp *= Math.exp(-dt * 0.9);
          pivot.rotation.z = Math.sin(swing.t * 2.6) * swing.amp;
          pivot.rotation.x = Math.sin(swing.t * 2.6 + 1.1) * swing.amp * 0.35;
          body.localToWorld(tmp.set(0, 0.2, 0));
          key.position.copy(tmp);
        } else if (swing.amp !== 0) {
          swing.amp = 0;
          pivot.rotation.set(0, 0, 0);
          key.position.copy(home);
        }
        let k = 1;
        if (swing.flick > 0) {
          swing.flick = Math.max(0, swing.flick - dt);
          k = 0.75 + 0.25 * Math.sin(t * 90) * Math.sin(t * 37);
        }
        key.intensity = baseIntensity * k * (lift.gain || 1);
        ctx.lights.fill.intensity = fillBase * k * (lift.gain || 1);
      }
      return {
        group: pivot,
        update,
        kick(strength) {
          if (ctx.reducedMotion) return;
          swing.amp = Math.min(0.14, swing.amp + 0.09 * (strength || 1));
          swing.t = 0;
          swing.flick = 0.45;
        },
        reset() {
          pivot.rotation.set(0, 0, 0);
          key.position.copy(home0);
          key.angle = baseAngle;
          key.intensity = baseIntensity;
          ctx.lights.fill.position.copy(fillHome);
          ctx.lights.fill.intensity = fillBase;
        },
      };
    })();
    group.add(lamp.group);
    updaters.push(lamp.update);

    function basicSprite(canvas, color, opacity) {
      return track(
        new THREE.SpriteMaterial({
          map: canvasTex(canvas, { wrap: false }),
          color,
          transparent: true,
          opacity: opacity == null ? 1 : opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        })
      );
    }

    // ------------------------------------------------------------------ adereços da mesa
    const glassMat = track(
      new THREE.MeshPhysicalMaterial({
        color: 0xf3f7f4,
        roughness: 0.04,
        metalness: 0,
        transparent: true,
        opacity: 0.32,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        envMapIntensity: 2.2,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    const aluMat = std({ color: 0xdfe3e8, roughness: 0.3, metalness: 0.82, envMapIntensity: 1.6 });
    // Friso liso do copo americano, um pouco mais claro que o vidro facetado.
    const rimMat = track(
      new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.55, envMapIntensity: 2.4, depthWrite: false })
    );
    const propPos = {};
    TABLE_PROPS.forEach((p) => (propPos[p.id] = p));

    /** Copo americano: 18 facetas na parte de baixo, faixa lisa em cima, fundo grosso. Desenhos: vidro, friso, líquido e topo. */
    function copoAmericano(kind) {
      const g = new THREE.Group();
      const H = 0.95;
      const FACETS = 18;
      const glass = mesh(
        merge(THREE, [
          { geo: faceted(new THREE.CylinderGeometry(0.335, 0.292, 0.62, FACETS, 1, true)), m: xf(THREE, 0, 0.39, 0) },
          { geo: new THREE.CylinderGeometry(0.365, 0.338, 0.25, 32, 1, true), m: xf(THREE, 0, 0.825, 0) },
          { geo: faceted(new THREE.CylinderGeometry(0.292, 0.286, 0.08, FACETS)), m: xf(THREE, 0, 0.04, 0) },
        ]),
        glassMat,
        { receive: false }
      );
      glass.renderOrder = 4;
      const rims = mesh(
        merge(THREE, [
          { geo: new THREE.TorusGeometry(0.338, 0.014, 6, 32), m: xf(THREE, 0, 0.7, 0, Math.PI / 2) },
          { geo: new THREE.TorusGeometry(0.363, 0.015, 6, 32), m: xf(THREE, 0, H, 0, Math.PI / 2) },
        ]),
        rimMat,
        { receive: false }
      );
      rims.renderOrder = 4;
      g.add(rims);
      // Líquido (segue as facetas) com menisco ou espuma no topo.
      const beer = kind === 'cerveja';
      const level = beer ? 0.8 : 0.74;
      const liquidMat = std({
        color: beer ? 0xe19a26 : 0xa87248,
        roughness: 0.15,
        metalness: 0,
        transparent: beer,
        opacity: beer ? 0.88 : 1,
        emissive: beer ? 0x5a2c04 : 0x1a0c04,
        emissiveIntensity: 0.6,
      });
      const lowerH = Math.min(level, 0.7) - 0.08;
      const liquidParts = [{ geo: faceted(new THREE.CylinderGeometry(0.318 - (0.7 - (lowerH + 0.08)) * 0.07, 0.276, lowerH, FACETS)), m: xf(THREE, 0, 0.08 + lowerH / 2, 0) }];
      if (level > 0.7) liquidParts.push({ geo: new THREE.CylinderGeometry(0.345, 0.325, level - 0.7, 24, 1, true), m: xf(THREE, 0, 0.7 + (level - 0.7) / 2, 0) });
      g.add(mesh(merge(THREE, liquidParts), liquidMat, { cast: true }));
      const topR = level > 0.7 ? 0.345 : 0.318;
      if (beer) {
        const foam = mesh(lathe(THREE, [[topR, 0], [topR, 0.03], [0.33, 0.09], [0.2, 0.115], [0, 0.12]], 24), std({ color: 0xfbf5e6, roughness: 0.9, emissive: 0x2a2418, emissiveIntensity: 0.4 }));
        foam.position.y = level;
        g.add(foam);
      } else {
        const topTex = canvasTex(paintCoffeeTop(T, 'pingado'), { wrap: false });
        const top = mesh(
          merge(THREE, [
            { geo: new THREE.CircleGeometry(topR - 0.01, 24), m: xf(THREE, 0, level, 0, -Math.PI / 2) },
            { geo: new THREE.TorusGeometry(topR - 0.012, 0.014, 6, 24), m: xf(THREE, 0, level + 0.005, 0, Math.PI / 2) },
          ]),
          std({ map: topTex, roughness: 0.3 })
        );
        g.add(top);
      }
      g.add(glass);
      return g;
    }

    const props = new THREE.Group();
    props.name = 'table-props';
    {
      const p1 = copoAmericano('pingado');
      p1.position.set(propPos.pingado.x, 0, propPos.pingado.z);
      props.add(p1);
      const p2 = copoAmericano('cerveja');
      p2.position.set(propPos.cerveja.x, 0, propPos.cerveja.z);
      props.add(p2);

      // Garrafa de 600 ml no porta-garrafa térmico.
      const gb = new THREE.Group();
      gb.position.set(propPos.garrafa.x, 0, propPos.garrafa.z);
      gb.rotation.y = 1.0;
      const amber = track(
        new THREE.MeshPhysicalMaterial({ color: 0x4a1f06, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.6, transparent: true, opacity: 0.92 })
      );
      const bottle = mesh(lathe(THREE, [[0, 0], [0.34, 0], [0.37, 0.05], [0.37, 1.85], [0.33, 2.05], [0.2, 2.3], [0.135, 2.45], [0.13, 2.82], [0.15, 2.84], [0.15, 2.9], [0.12, 2.92], [0, 2.9]], 24), amber, { cast: true });
      const koozieTex = canvasTex(paintKoozie(T), { wrap: false });
      withFonts(FONTS, () => {
        koozieTex.image = paintKoozie(T);
        koozieTex.needsUpdate = true;
      });
      const koozie = new THREE.Group();
      const kOuter = mesh(new THREE.CylinderGeometry(0.47, 0.46, 1.5, 32, 1, true), std({ map: koozieTex, roughness: 0.85 }), { cast: true });
      kOuter.position.y = 0.76;
      const kRim = mesh(
        merge(
          THREE,
          [
            { geo: new THREE.TorusGeometry(0.435, 0.036, 8, 32), m: xf(THREE, 0, 1.5, 0, Math.PI / 2), c: '#8f1b15' },
            { geo: new THREE.CylinderGeometry(0.4, 0.4, 1.4, 24, 1, true).scale(-1, 1, 1), m: xf(THREE, 0, 0.8, 0), c: '#2a0c08' },
          ],
          true
        ),
        std({ vertexColors: true, roughness: 0.85 })
      );
      koozie.add(kOuter, kRim);
      const labelTex = canvasTex(paintBottleLabel(T), { wrap: false });
      withFonts(FONTS, () => {
        labelTex.image = paintBottleLabel(T);
        labelTex.needsUpdate = true;
      });
      const neckLabel = mesh(new THREE.CylinderGeometry(0.138, 0.2, 0.28, 20, 1, true), std({ map: labelTex, roughness: 0.6 }));
      neckLabel.position.y = 2.33;
      gb.add(bottle, koozie, neckLabel);
      props.add(gb);

      // Porta-guardanapo de alumínio (cromado): duas chapas trapezoidais inclinadas em V, com a borda
      // de cima dobrada e um recorte oval no meio; guardanapos de papel abertos em leque entre elas.
      const pg = new THREE.Group();
      pg.position.set(propPos.guardanapos.x, 0, propPos.guardanapos.z);
      pg.rotation.y = 0.12;
      const chrome = std({ color: 0xeef2f8, roughness: 0.15, metalness: 1, envMapIntensity: 2.2 });
      const plateShape = new THREE.Shape();
      plateShape.moveTo(-0.56, 0);
      plateShape.lineTo(0.56, 0);
      plateShape.lineTo(0.4, 0.64);
      plateShape.lineTo(-0.4, 0.64);
      plateShape.closePath();
      const hole = new THREE.Path();
      hole.absellipse(0, 0.34, 0.22, 0.13, 0, Math.PI * 2, false, 0);
      plateShape.holes.push(hole);
      const holderParts = [{ geo: new THREE.BoxGeometry(1.16, 0.03, 0.5), m: xf(THREE, 0, 0.015, 0) }];
      for (const sz of [-1, 1]) {
        const plate = new THREE.ExtrudeGeometry(plateShape, { depth: 0.018, bevelEnabled: false, curveSegments: lowAtBuild ? 8 : 16 });
        plate.translate(0, 0, -0.009);
        const m = xf(THREE, 0, 0.02, sz * 0.24, sz * -0.2, 0, 0);
        holderParts.push({ geo: plate, m });
        // Borda de cima dobrada (tubo) acompanhando a inclinação da chapa.
        const topZ = sz * 0.24 - sz * Math.sin(0.2) * 0.64;
        holderParts.push({ geo: new THREE.CylinderGeometry(0.028, 0.028, 0.8, 10), m: xf(THREE, 0, 0.02 + Math.cos(0.2) * 0.64, topZ, 0, 0, Math.PI / 2) });
      }
      pg.add(mesh(merge(THREE, holderParts), chrome, { cast: true }));
      const napkinParts = [];
      const nNap = 7;
      for (let i = 0; i < nNap; i++) {
        const k = i / (nNap - 1) - 0.5;
        napkinParts.push({ geo: new THREE.BoxGeometry(0.9, 0.7, 0.006), m: xf(THREE, (i % 2 ? 0.015 : -0.015), 0.38, k * 0.14, k * 0.2, 0, (i % 3 - 1) * 0.02) });
      }
      // Papel branco: um pouco de brilho próprio, senão as folhas em pé (luz de cima) ficam cinza.
      pg.add(mesh(merge(THREE, napkinParts), std({ color: 0xfbf8f1, roughness: 0.95, emissive: 0xfff6e8, emissiveIntensity: 0.14 }), { cast: true }));
      props.add(pg);

      // Pratinho de alumínio com amendoim.
      const plate = mesh(lathe(THREE, [[0, 0.01], [0.38, 0.01], [0.46, 0.07], [0.5, 0.09], [0.49, 0.1], [0.44, 0.08], [0.36, 0.035], [0, 0.035]], 28), aluMat);
      plate.position.set(propPos.amendoim.x, 0, propPos.amendoim.z);
      props.add(plate);
      const nutGeo = track(new THREE.CapsuleGeometry(0.045, 0.06, 3, 6));
      const nutCount = lowAtBuild ? 22 : 40;
      const nuts = new THREE.InstancedMesh(nutGeo, std({ color: 0xffffff, roughness: 0.7 }), nutCount);
      const rnd = T.mulberry32(8);
      const m4 = new THREE.Matrix4();
      const col = new THREE.Color();
      for (let i = 0; i < nutCount; i++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * 0.32;
        const y = 0.07 + (1 - r / 0.34) * 0.1 * rnd() + (i > nutCount * 0.6 ? 0.05 : 0);
        m4.compose(
          new THREE.Vector3(propPos.amendoim.x + Math.cos(a) * r, y, propPos.amendoim.z + Math.sin(a) * r),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 + (rnd() - 0.5), rnd() * 6, rnd())),
          new THREE.Vector3(1, 1, 0.9)
        );
        nuts.setMatrixAt(i, m4);
        nuts.setColorAt(i, col.set(rnd() < 0.5 ? '#b0703a' : '#c98a4c'));
      }
      nuts.receiveShadow = true;
      props.add(nuts);

      // Paliteiro.
      const pal = [];
      pal.push({ geo: new THREE.CylinderGeometry(0.15, 0.16, 0.42, 14), m: xf(THREE, 0, 0.21, 0), c: '#c6cad0' });
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        pal.push({ geo: new THREE.CylinderGeometry(0.008, 0.008, 0.6, 4), m: xf(THREE, Math.cos(a) * 0.07, 0.5, Math.sin(a) * 0.07, Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12), c: '#d9b98a' });
      }
      const paliteiro = mesh(merge(THREE, pal, true), std({ vertexColors: true, roughness: 0.4, metalness: 0.5 }), { cast: true });
      paliteiro.position.set(propPos.paliteiro.x, 0, propPos.paliteiro.z);
      props.add(paliteiro);

      // Tampinhas soltas (uma de cabeça para baixo).
      const capProfile = [[0.13, 0], [0.137, 0.004], [0.131, 0.04], [0.127, 0.051], [0.116, 0.061], [0.098, 0.066], [0, 0.066]];
      const capGeo = lathe(THREE, capProfile, 42);
      const cp = capGeo.attributes.position;
      for (let i = 0; i < cp.count; i++) {
        const y = cp.getY(i);
        if (y > 0.045) continue;
        const a = Math.atan2(cp.getZ(i), cp.getX(i));
        const k = 1 + 0.07 * Math.max(0, Math.cos(a * 21)) * (1 - y / 0.045);
        cp.setX(i, cp.getX(i) * k);
        cp.setZ(i, cp.getZ(i) * k);
      }
      capGeo.computeVertexNormals();
      const capMetal = std({ color: 0xd8b56a, roughness: 0.28, metalness: 0.9 });
      const capFace = std({ map: canvasTex(paintCapFace(T), { wrap: false }), roughness: 0.35, metalness: 0.3 });
      withFonts(FONTS, () => {
        capFace.map.image = paintCapFace(T);
        capFace.map.needsUpdate = true;
      });
      const faceGeo = new THREE.CircleGeometry(0.1, 24);
      faceGeo.rotateX(-Math.PI / 2);
      faceGeo.translate(0, 0.0665, 0);
      const skirts = [];
      const faces = [];
      const liners = [];
      [['tampinha-a', false, 0.6], ['tampinha-b', true, 2.1], ['tampinha-c', false, 4.0]].forEach(([id, flipped, yaw]) => {
        const m = xf(THREE, propPos[id].x, flipped ? 0.067 : 0.0005, propPos[id].z, flipped ? Math.PI : 0, yaw, 0);
        skirts.push({ geo: capGeo.clone(), m });
        faces.push({ geo: faceGeo.clone(), m });
        if (flipped) liners.push({ geo: new THREE.CircleGeometry(0.1, 20), m: m.clone().multiply(xf(THREE, 0, 0.063, 0, Math.PI / 2)) });
      });
      props.add(mesh(merge(THREE, skirts), capMetal), mesh(merge(THREE, faces), capFace), mesh(merge(THREE, liners), std({ color: 0xe8e2d6, roughness: 0.8 })));
    }
    group.add(props);

    // ------------------------------------------------------------------ engradados com a xicrinha e o açucareiro
    const side = (() => {
      const g = new THREE.Group();
      const C = L.crate;
      g.position.set(C.x, F, C.z);
      g.rotation.y = C.yaw;
      const crateTex = canvasTex(paintCrate(T), { wrap: false });
      withFonts(FONTS, () => {
        crateTex.image = paintCrate(T);
        crateTex.needsUpdate = true;
      });
      const plastic = std({ map: crateTex, roughness: 0.55, alphaTest: 0.5, side: THREE.DoubleSide });
      const W = C.w;
      const H = C.h;
      const D = C.d;
      // Engradados vazados (os vãos da lateral são transparentes): o de baixo, de boca para cima,
      // com as garrafas vazias; o de cima, emborcado, serve de mesinha: a face de cima (o fundo dele)
      // é uma grade fina fechada, para o pires e o açucareiro ficarem sobre superfície sólida.
      const sideParts = [];
      const plane = (w, h, x, y, z, ry, yaw) => {
        const geo = new THREE.PlaneGeometry(w, h);
        // O logo do canvas está pintado de cabeça para baixo: gira a UV 180° para ler direito.
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, 1 - uv.getX(i), 1 - uv.getY(i));
        const m = new THREE.Matrix4().makeRotationY(yaw).multiply(xf(THREE, x, y, z, 0, ry, 0));
        return { geo, m };
      };
      for (let k = 0; k < 2; k++) {
        const y = H / 2 + k * (H + 0.02);
        const yaw = k * 0.08;
        sideParts.push(plane(W, H, 0, y, D / 2, 0, yaw));
        sideParts.push(plane(W, H, 0, y, -D / 2, Math.PI, yaw));
        sideParts.push(plane(D, H, W / 2, y, 0, Math.PI / 2, yaw));
        sideParts.push(plane(D, H, -W / 2, y, 0, -Math.PI / 2, yaw));
      }
      g.add(mesh(merge(THREE, sideParts), plastic, { cast: true }));
      const crateTopTex = canvasTex(paintCrateTop(T), { wrap: false });
      const crateLid = new THREE.PlaneGeometry(W, D);
      crateLid.rotateX(-Math.PI / 2);
      crateLid.rotateY(0.08);
      crateLid.translate(0, 2 * H + 0.02, 0);
      g.add(mesh(crateLid, std({ map: crateTopTex, roughness: 0.6, side: THREE.DoubleSide }), { cast: true }));
      // Garrafas vazias no engradado de baixo (vistas pelos vãos).
      {
        const profile = [[0, 0], [0.27, 0], [0.3, 0.05], [0.3, 1.62], [0.26, 1.8], [0.16, 2.02], [0.11, 2.15], [0.105, 2.5], [0.12, 2.52], [0.12, 2.58], [0.09, 2.6], [0, 2.58]];
        const bottles = [];
        for (let i = 0; i < 4; i++) {
          for (let j = 0; j < 3; j++) {
            bottles.push({ geo: lathe(THREE, profile, lowAtBuild ? 8 : 12), m: xf(THREE, (i - 1.5) * 0.84, 0.03, (j - 1) * 0.92) });
          }
        }
        g.add(mesh(merge(THREE, bottles), std({ color: 0x5a2608, roughness: 0.18, metalness: 0.05, envMapIntensity: 1.3 })));
      }
      const topY = 2 * H + 0.02;
      // Xicrinha branca grossa com friso, no pires, com colherzinha.
      const cup = new THREE.Group();
      cup.position.set(0.75, topY, -0.2);
      const cupProfile = [[0, 0.07], [0.15, 0.07], [0.2, 0.1], [0.24, 0.2], [0.285, 0.42], [0.3, 0.55], [0.275, 0.56], [0.26, 0.45], [0.22, 0.24], [0.14, 0.14], [0, 0.13]];
      const porcelain = mesh(
        merge(
          THREE,
          [
            { geo: lathe(THREE, [[0, 0], [0.26, 0], [0.3, 0.03], [0.46, 0.06], [0.6, 0.1], [0.62, 0.12], [0.58, 0.12], [0.44, 0.09], [0.3, 0.07], [0.24, 0.065], [0, 0.065]], 32), c: '#f6f3ec' },
            { geo: lathe(THREE, cupProfile, 32), c: '#f6f3ec' },
            { geo: new THREE.TorusGeometry(0.11, 0.035, 8, 16, Math.PI * 1.3), m: xf(THREE, 0.33, 0.33, 0, 0, 0, -Math.PI * 0.65), c: '#f6f3ec' },
            { geo: new THREE.TorusGeometry(0.292, 0.009, 6, 32), m: xf(THREE, 0, 0.49, 0, Math.PI / 2), c: '#2f6b4a' },
          ],
          true
        ),
        std({ vertexColors: true, roughness: 0.22, metalness: 0, envMapIntensity: 1.1 }),
        { cast: true }
      );
      const coffeeTex = canvasTex(paintCoffeeTop(T, 'cafe'), { wrap: false });
      const coffee = mesh(new THREE.CircleGeometry(0.262, 24), std({ map: coffeeTex, roughness: 0.15 }), { cast: false });
      coffee.rotation.x = -Math.PI / 2;
      coffee.position.y = 0.47;
      const spoon = merge(THREE, [
        { geo: new THREE.BoxGeometry(0.5, 0.012, 0.045), m: xf(THREE, 0.22, 0.15, 0.36, 0, 0.5, -0.05) },
        { geo: new THREE.SphereGeometry(0.07, 10, 6), m: xf(THREE, -0.06, 0.13, 0.52, 0, 0.5, 0, 1, 0.25, 0.7) },
      ]);
      cup.add(porcelain, coffee, mesh(spoon, aluMat));
      g.add(cup);
      // Açucareiro de vidro com tampa de metal e bico dosador.
      const sugar = new THREE.Group();
      sugar.position.set(-0.6, topY, -0.6);
      const jar = mesh(
        merge(THREE, [
          { geo: lathe(THREE, [[0.3, 0], [0.34, 0.03], [0.35, 0.95], [0.33, 1.0]], 24) },
          { geo: new THREE.CylinderGeometry(0.31, 0.3, 0.06, 24), m: xf(THREE, 0, 0.03, 0) },
        ]),
        glassMat,
        { receive: false }
      );
      jar.renderOrder = 4;
      const sugarFill = mesh(new THREE.CylinderGeometry(0.325, 0.3, 0.6, 20), std({ color: 0xf7f5ef, roughness: 0.95 }), { cast: true });
      sugarFill.position.y = 0.33;
      const lid = merge(THREE, [
        { geo: lathe(THREE, [[0.33, 0], [0.37, 0], [0.36, 0.06], [0.28, 0.17], [0.12, 0.29], [0, 0.3]], 24), m: xf(THREE, 0, 1.0, 0) },
        { geo: new THREE.CylinderGeometry(0.05, 0.085, 0.4, 12), m: xf(THREE, 0.19, 1.36, 0, 0, 0, -0.6) },
        { geo: new THREE.BoxGeometry(0.14, 0.025, 0.1), m: xf(THREE, 0.33, 1.52, 0, 0, 0, -0.6) },
      ]);
      sugar.add(jar, sugarFill, mesh(lid, std({ color: 0xd9dde2, roughness: 0.18, metalness: 1, envMapIntensity: 1.5 })));
      g.add(sugar);
      return { group: g, cupTop: new THREE.Vector3(0.75, topY + 0.5, -0.2) };
    })();
    group.add(side.group);

    // ------------------------------------------------------------------ cadeiras de ferro "Garoa"
    const chairs = (() => {
      const paint = std({ color: 0xb3261e, roughness: 0.45, metalness: 0.35, envMapIntensity: 0.8 });
      const backTex = canvasTex(paintChairBack(T, false), { wrap: false });
      const badgeTex = canvasTex(paintChairBack(T, true), { wrap: false });
      withFonts(FONTS, () => {
        backTex.image = paintChairBack(T, false);
        badgeTex.image = paintChairBack(T, true);
        backTex.needsUpdate = badgeTex.needsUpdate = true;
      });
      const backMat = std({ map: backTex, roughness: 0.45, metalness: 0.3 });
      const badgeMat = std({ map: badgeTex, roughness: 0.45, metalness: 0.3 });
      const seatTop = 4.5;
      const frameParts = [
        { geo: new THREE.BoxGeometry(3.9, 0.14, 3.6), m: xf(THREE, 0, seatTop - 0.07, 0) },
        { geo: new THREE.BoxGeometry(3.9, 0.3, 0.08), m: xf(THREE, 0, seatTop - 0.2, 1.78) },
      ];
      for (const sx of [-1.85, 1.85]) {
        frameParts.push({ geo: rod(THREE, [sx, 0, -2.3], [sx, 9.6, -2.05], 0.1, 8) });
        frameParts.push({ geo: rod(THREE, [sx * 0.97, 0, 1.7], [sx * 0.97, seatTop - 0.1, -1.7], 0.09, 8) });
        frameParts.push({ geo: rod(THREE, [sx, seatTop - 0.12, -1.8], [sx, seatTop - 0.12, 1.75], 0.07, 6) });
      }
      frameParts.push({ geo: rod(THREE, [-1.8, 0.6, 1.62], [1.8, 0.6, 1.62], 0.07, 6) });
      frameParts.push({ geo: rod(THREE, [-1.85, 1.2, -2.27], [1.85, 1.2, -2.27], 0.07, 6) });
      const frameGeo = track(merge(THREE, frameParts));
      const backGeo = track(new THREE.BoxGeometry(3.6, 1.55, 0.08));
      const list = {};
      function place(seat, players) {
        let c = list[seat];
        if (!c) {
          c = new THREE.Group();
          const frame = new THREE.Mesh(frameGeo, paint);
          frame.castShadow = frame.receiveShadow = true;
          // Logo grande do lado de fora; do lado da mesa só um selo pequeno (menos ruído na tela).
          const back = new THREE.Mesh(backGeo, [paint, paint, paint, paint, badgeMat, backMat]);
          back.position.set(0, 8.35, -2.12);
          back.rotation.x = -0.08;
          back.receiveShadow = true;
          c.add(frame, back);
          group.add(c);
          list[seat] = c;
        }
        const p = ctx.seatPosition(seat, players);
        const yaw = ctx.seatFacing(seat, players);
        c.position.set(p.x - Math.sin(yaw) * L.chairBack, F, p.z - Math.cos(yaw) * L.chairBack);
        c.rotation.y = yaw;
        c.visible = true;
      }
      function setPlayers(n) {
        const players = n === 2 ? 2 : 4;
        Object.keys(list).forEach((s) => (list[s].visible = false));
        for (let s = 1; s < players; s++) place(s, players);
      }
      return { setPlayers };
    })();
    chairs.setPlayers(ctx.players || 4);

    // ------------------------------------------------------------------ fundo distante (preso ao olho)
    const backdrop = buildBackdrop();
    group.add(backdrop.group);
    updaters.push(backdrop.update);

    /**
     * Camada distante, desenhada num referencial "de olho": origem no olho da câmera, −Z para a
     * frente, elevação 0 no centro da faixa visível entre a borda de cima da tela e a mureta.
     * Tudo é posicionado por azimute/elevação (graus); a faixa de projeto vai de −4,5° a +4,5°.
     * Janelas livres entre as cabeças (paisagem e retrato): azimutes de ±5° a ±12°.
     */
    function buildBackdrop() {
      const g = new THREE.Group();
      g.name = 'backdrop';
      const rnd = T.mulberry32(2026);
      const HOR = 1.3; // horizonte (morros) em graus acima do centro da faixa
      const STREET_Y = -3.15;
      const at = (az, dist) => [Math.sin(az * D2R) * dist, -Math.cos(az * D2R) * dist];
      const yAt = (el, dist) => Math.tan(el * D2R) * dist;

      const sky = new THREE.Mesh(track(new THREE.SphereGeometry(150, 40, 20)), track(skyMaterial(THREE)));
      sky.renderOrder = -10;
      sky.frustumCulled = false;
      g.add(sky);

      // Morros no horizonte (silhueta com borda levemente iluminada).
      {
        const seg = 120;
        const dist = 144;
        const pos = [];
        const colors = [];
        const idx = [];
        const top = new THREE.Color(0x2c2226);
        const bottom = new THREE.Color(0x0d0b0e);
        for (let i = 0; i <= seg; i++) {
          const az = -110 + (220 * i) / seg;
          const [x, z] = at(az, dist);
          const el = HOR + Math.sin(i * 0.37) * 0.3 + Math.sin(i * 0.11 + 1.3) * 0.45 + (rnd() - 0.5) * 0.12;
          pos.push(x, yAt(-7, dist), z, x, yAt(el, dist), z);
          colors.push(bottom.r, bottom.g, bottom.b, top.r, top.g, top.b);
          if (i < seg) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geo.setIndex(idx);
        const hills = new THREE.Mesh(track(geo), basic({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
        hills.renderOrder = -9;
        g.add(hills);
      }

      // Prédios: caixas com janelas procedurais (um único desenho para todos).
      const bmat = track(buildingMaterial(THREE));
      const bParts = { pos: [], uv: [], tint: [], info: [], idx: [] };
      function pushQuad(p0, p1, p2, p3, u0, v0, u1, v1, tint, info) {
        const base = bParts.pos.length / 3;
        [p0, p1, p2, p3].forEach((p) => bParts.pos.push(p[0], p[1], p[2]));
        bParts.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
        for (let i = 0; i < 4; i++) {
          bParts.tint.push(tint.r, tint.g, tint.b);
          bParts.info.push(info[0], info[1], info[2]);
        }
        bParts.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      /** Prédio com base em (az, dist): largura, altura e profundidade em unidades; janelas por andar e coluna. */
      function building(az, dist, w, h, d, opts) {
        const o = opts || {};
        const y0 = o.y0 == null ? STREET_Y : o.y0;
        const a = az * D2R;
        const c = at(az, dist);
        const fx = Math.cos(a);
        const fz = Math.sin(a);
        const bx = Math.sin(a);
        const bz = -Math.cos(a);
        const corner = (sx, sz, y) => [c[0] + fx * sx * (w / 2) + bx * sz * (d / 2), y, c[1] + fz * sx * (w / 2) + bz * sz * (d / 2)];
        const floors = o.floors || Math.max(2, Math.round(h / (o.floorH || 0.55)));
        const cols = o.cols || Math.max(2, Math.round(w / (o.colW || 0.6)));
        const haze = clamp((dist - 50) / 95, 0, 0.72) * (o.hazeK == null ? 1 : o.hazeK);
        const tint = new THREE.Color(o.tint || 0x171417).multiplyScalar(0.75 + rnd() * 0.5);
        const info = [o.crown ? 4 : o.style || 0, haze, rnd() * 50 + (o.dim || 0) * 100];
        const y1 = y0 + h;
        pushQuad(corner(-1, -1, y0), corner(1, -1, y0), corner(1, -1, y1), corner(-1, -1, y1), 0, 0, cols, floors, tint, info);
        const sideCols = Math.max(1, Math.round((cols * d) / w));
        const turn = rnd() < 0.5 ? 1 : -1;
        pushQuad(corner(turn, -1, y0), corner(turn, 1, y0), corner(turn, 1, y1), corner(turn, -1, y1), 0, 0, sideCols, floors, tint.clone().multiplyScalar(0.6), info);
        pushQuad(corner(-1, -1, y1), corner(1, -1, y1), corner(1, 1, y1), corner(-1, 1, y1), 0, 0, 0.1, 0.1, tint.clone().multiplyScalar(0.5), [5, haze, 0]);
        return { top: y1, c };
      }
      const redLights = [];
      const skip = (az) => Math.abs(az + 9) < 7 || Math.abs(az - 10) < 2;
      // Horizonte: prédios altos e distantes, com topo entre 1,4° e 3,5°.
      for (let i = 0; i < (lowAtBuild ? 70 : 130); i++) {
        const az = -95 + rnd() * 190;
        if (skip(az)) continue;
        const dist = 118 + rnd() * 20;
        const tall = rnd();
        const topEl = 1.4 + tall * tall * 1.9 + (Math.abs(az) < 40 ? 0.25 : 0);
        const y0 = STREET_Y - 3.5;
        const h = yAt(topEl, dist) - y0;
        const w = 1.4 + rnd() * 2.6;
        const b = building(az, dist, w, h, w * (0.6 + rnd() * 0.6), { y0, floorH: 0.36, colW: 0.4 });
        if (topEl > 2.3 && rnd() < 0.6) redLights.push([b.c[0], b.top + 0.15, b.c[1]]);
      }
      // Meio: bairro no vale.
      for (let i = 0; i < (lowAtBuild ? 55 : 100); i++) {
        const az = -80 + rnd() * 160;
        const dist = 70 + rnd() * 42;
        const topEl = -2.6 + rnd() * rnd() * 3.6;
        const y0 = STREET_Y - 1.4;
        const h = Math.max(0.8, yAt(topEl, dist) - y0);
        const w = 1.5 + rnd() * 3.5;
        const b = building(az, dist, w, h, w * (0.5 + rnd() * 0.6), { y0, floorH: 0.45, colW: 0.5, tint: 0x1a1614 });
        if (topEl > 0.3 && rnd() < 0.5) redLights.push([b.c[0], b.top + 0.12, b.c[1]]);
      }
      // Copan: lâmina ondulada com brises horizontais claros (sombreados pela curva).
      {
        const az0 = -9;
        const dist = 106;
        const w = 17;
        const y0 = STREET_Y - 1.8;
        const h = yAt(3.0, dist) - y0;
        // A lâmina fica girada em relação ao olho (a curva em S aparece de lado).
        const a = (az0 + 17) * D2R;
        const c = at(az0, dist);
        const fx = Math.cos(a);
        const fz = Math.sin(a);
        const bx = Math.sin(a);
        const bz = -Math.cos(a);
        const N = 40;
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const s = i / N;
          const off = Math.sin((s - 0.5) * Math.PI * 1.7) * 7;
          pts.push([c[0] + fx * (s - 0.5) * w + bx * off, c[1] + fz * (s - 0.5) * w + bz * off, s]);
        }
        const floors = 18;
        for (let i = 0; i < N; i++) {
          const p = pts[i];
          const q = pts[i + 1];
          // Sombreamento pela orientação de cada trecho em relação ao olho (a curva aparece nas faixas).
          const tx = q[0] - p[0];
          const tz = q[1] - p[1];
          const len = Math.hypot(tx, tz) || 1;
          const nx = tz / len;
          const nz = -tx / len;
          const mx = (p[0] + q[0]) / 2;
          const mz = (p[1] + q[1]) / 2;
          const ml = Math.hypot(mx, mz) || 1;
          const facing = Math.abs(nx * (-mx / ml) + nz * (-mz / ml));
          const shadeK = 0.18 + 0.82 * Math.pow(facing, 5);
          const tint = new THREE.Color(shadeK, shadeK, shadeK);
          pushQuad([p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y0 + h, q[1]], [p[0], y0 + h, p[1]], p[2] * 70, 0, q[2] * 70, floors, tint, [1, 0.08, 7]);
          const back = 1.3;
          pushQuad([p[0], y0 + h, p[1]], [q[0], y0 + h, q[1]], [q[0] + bx * back, y0 + h, q[1] + bz * back], [p[0] + bx * back, y0 + h, p[1] + bz * back], 0, 0, 0.1, 0.1, new THREE.Color(0x121012), [5, 0.1, 0]);
        }
        redLights.push([pts[5][0], y0 + h + 0.2, pts[5][1]], [pts[N - 5][0], y0 + h + 0.2, pts[N - 5][1]]);
      }
      // Edifício Itália: torre alta, faixas verticais e coroa iluminada.
      {
        const iy0 = STREET_Y - 1.8;
        const b = building(10, 114, 2.8, yAt(4.0, 114) - iy0, 2.4, { y0: iy0, floors: 46, cols: 6, style: 2, tint: 0x2a2624, hazeK: 0.5 });
        building(10, 113.9, 2.84, 1.1, 2.44, { y0: b.top - 1.2, floors: 3, cols: 8, crown: true, tint: 0x2a2624, hazeK: 0.3 });
        redLights.push([b.c[0], b.top + 0.25, b.c[1]]);
      }
      // Antenas da Paulista (treliça escura contra o céu) no espigão, com luzes vermelhas.
      const antennaTops = [];
      [
        [-20.5, 132, 3.7],
        [-23.5, 134, 3.1],
        [-26.5, 131, 4.0],
        [24, 133, 3.4],
      ].forEach(([az, dist, topEl], i) => {
        building(az + 1.1, dist - 1.5, 3.4, yAt(1.5 + (i % 3) * 0.3, dist) - (STREET_Y - 1.5), 2.6, { y0: STREET_Y - 1.5, floorH: 0.36, colW: 0.4 });
        const a = az * D2R;
        const c = at(az, dist);
        const y0 = STREET_Y - 1.5;
        const h = yAt(topEl, dist) - y0;
        const fx = Math.cos(a);
        const fz = Math.sin(a);
        const tint = new THREE.Color(0x100e12);
        const r0 = 0.75;
        const r1 = 0.07;
        const segs = 5;
        for (let k = 0; k < segs; k++) {
          const k0 = k / segs;
          const k1 = (k + 1) / segs;
          const ra = r0 + (r1 - r0) * k0;
          const rb = r0 + (r1 - r0) * k1;
          const ya = y0 + h * k0;
          const yb = y0 + h * k1;
          pushQuad(
            [c[0] - fx * ra, ya, c[1] - fz * ra],
            [c[0] + fx * ra, ya, c[1] + fz * ra],
            [c[0] + fx * rb, yb, c[1] + fz * rb],
            [c[0] - fx * rb, yb, c[1] - fz * rb],
            0, k * 5, 1.6, k * 5 + 5, tint, [3, 0.04, 0]
          );
        }
        antennaTops.push([c[0], y0 + h + 0.12, c[1]], [c[0], y0 + h * 0.66, c[1]], [c[0], y0 + h * 0.36, c[1]]);
      });
      {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(bParts.pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(bParts.uv, 2));
        geo.setAttribute('aTint', new THREE.Float32BufferAttribute(bParts.tint, 3));
        geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(bParts.info, 3));
        geo.setIndex(bParts.idx);
        const city = new THREE.Mesh(track(geo), bmat);
        city.renderOrder = -8;
        city.frustumCulled = false;
        g.add(city);
      }

      // Tapete de luzes da cidade + luzes vermelhas piscando.
      const dotTex = canvasTex(paintGlow(T, 'rgba(255,255,255,1)', 'rgba(255,255,255,0.5)'), { wrap: false });
      const pmat = track(glowPointsMaterial(THREE, dotTex));
      {
        const pos = [];
        const colr = [];
        const info = [];
        const palette = [
          [1.0, 0.6, 0.26, 0.58],
          [1.0, 0.84, 0.6, 0.22],
          [0.78, 0.88, 1.0, 0.14],
          [0.5, 1.0, 0.6, 0.03],
          [1.0, 0.3, 0.2, 0.03],
        ];
        const pick = () => {
          let r = rnd();
          for (const p of palette) {
            if ((r -= p[3]) <= 0) return p;
          }
          return palette[0];
        };
        const count = lowAtBuild ? 800 : 1800;
        for (let i = 0; i < count; i++) {
          const az = -85 + rnd() * 170;
          const t = Math.pow(rnd(), 0.6);
          const dist = 58 + t * 82;
          const [x, z] = at(az, dist);
          const y = STREET_Y - 1.4 + rnd() * 0.3 + (dist > 124 ? (dist - 124) * 0.22 : 0);
          pos.push(x, y, z);
          const p = pick();
          const b = 0.55 + rnd() * 0.6;
          colr.push(p[0] * b, p[1] * b, p[2] * b);
          info.push(1.2 + rnd() * 1.6 * (1 - t * 0.5), rnd(), 0);
        }
        redLights.forEach((p) => {
          pos.push(p[0], p[1], p[2]);
          colr.push(1.6, 0.12, 0.08);
          info.push(3.0, rnd(), 1);
        });
        antennaTops.forEach((p) => {
          pos.push(p[0], p[1], p[2]);
          colr.push(2.4, 0.15, 0.1);
          info.push(4.4, rnd() * 0.3, 1);
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colr, 3));
        geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 3));
        const pts = new THREE.Points(track(geo), pmat);
        pts.frustumCulled = false;
        pts.renderOrder = -7;
        g.add(pts);
      }
      // Avenida no vale com faróis (brancos para um lado, vermelhos para o outro).
      const tmat = track(trafficMaterial(THREE, dotTex));
      {
        const n = lowAtBuild ? 50 : 110;
        const pos = new Float32Array(n * 3);
        const info = [];
        for (let i = 0; i < n; i++) {
          const dir = i % 2 ? 1 : -1;
          info.push(rnd(), dir * (0.01 + rnd() * 0.012), dir > 0 ? 0 : 0.6);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 3));
        const pts = new THREE.Points(track(geo), tmat);
        pts.frustumCulled = false;
        g.add(pts);
      }

      // Rua de baixo: asfalto molhado com reflexos, calçada, postes de sódio, orelhão e placa azul.
      const lampAz = [-11.5, 6.5, 23];
      const streetNear = 36;
      const streetFar = 54;
      {
        const texW = lowAtBuild ? 512 : 1024;
        const span = 140;
        const toU = (az) => (az + span / 2) / span;
        const asphalt = canvasTex(paintWetStreet(T, texW, 64, lampAz.map(toU)), { wrap: false });
        const seg = 48;
        const pos = [];
        const uv = [];
        const idx = [];
        for (let i = 0; i <= seg; i++) {
          const az = -span / 2 + (span * i) / seg;
          const [xn, zn] = at(az, streetNear);
          const [xf2, zf] = at(az, streetFar);
          pos.push(xn, STREET_Y, zn, xf2, STREET_Y, zf);
          uv.push(i / seg, 1, i / seg, 0);
          if (i < seg) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(idx);
        const road = new THREE.Mesh(track(geo), basic({ map: asphalt, fog: false }));
        road.renderOrder = -6;
        g.add(road);
        // Calçada do outro lado, iluminada perto dos postes.
        const walk2 = [];
        const walkCol = [];
        const idx2 = [];
        for (let i = 0; i <= seg; i++) {
          const az = -span / 2 + (span * i) / seg;
          const [x0, z0] = at(az, streetFar);
          const [x1, z1] = at(az, streetFar + 3);
          walk2.push(x0, STREET_Y + 0.15, z0, x1, STREET_Y + 0.15, z1);
          const lit = Math.max(0, ...lampAz.map((la) => 1 - Math.abs(az - la) / 8));
          const c = 0.05 + lit * 0.32;
          walkCol.push(c * 1.2, c * 0.85, c * 0.6, c, c * 0.72, c * 0.5);
          if (i < seg) idx2.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
        }
        const g2 = new THREE.BufferGeometry();
        g2.setAttribute('position', new THREE.Float32BufferAttribute(walk2, 3));
        g2.setAttribute('color', new THREE.Float32BufferAttribute(walkCol, 3));
        g2.setIndex(idx2);
        g.add(new THREE.Mesh(track(g2), basic({ vertexColors: true, fog: false })));
        // Casinhas baixas do outro lado da rua, com fachada acesa pelos postes.
        for (let az = -64; az < 64; az += 6 + rnd() * 8) {
          if (Math.abs(az - lampAz[0]) < 3 || Math.abs(az + 7) < 4 || Math.abs(az - 10) < 3) continue;
          const lit = Math.max(0, ...lampAz.map((la) => 1 - Math.abs(az - la) / 10));
          building(az, streetFar + 5, 3 + rnd() * 2, 1.0 + rnd() * 1.1, 3, {
            y0: STREET_Y,
            floorH: 1.1,
            colW: 1.2,
            tint: new THREE.Color(0x2a1d16).lerp(new THREE.Color(0x8a5530), lit * 0.7).getHex(),
            hazeK: 0,
          });
        }
      }
      // Postes, orelhão e placa (cores por vértice, sem luz).
      const glowTex = paintGlow(T, 'rgba(255,200,130,1)', 'rgba(255,140,50,0.45)');
      const furniture = [];
      const glows = [];
      // Postes de sódio da rua de baixo: haste clara e grossa, luminária abaixo dos telhados do fundo
      // (o halo não vira "sol" no meio dos prédios).
      lampAz.forEach((az, i) => {
        const d = streetFar + 1 + i * 0.4;
        const [x, z] = at(az, d);
        const [xa, za] = at(az + 1.1, d - 2.2);
        const topY = STREET_Y + 4.2;
        furniture.push({ geo: new THREE.CylinderGeometry(0.16, 0.24, 4.2, 6), m: xf(THREE, x, STREET_Y + 2.1, z), c: '#77706a' });
        furniture.push({ geo: rod(THREE, [x, topY - 0.2, z], [xa, topY, za], 0.09, 5), c: '#77706a' });
        furniture.push({ geo: new THREE.BoxGeometry(0.8, 0.2, 0.34), m: xf(THREE, xa, topY - 0.05, za, 0, -az * D2R, 0), c: '#4a4541' });
        glows.push([xa, topY - 0.25, za]);
      });
      // Poste de sódio mais perto, à esquerda: a haste entra na faixa e o halo laranja ilumina a garoa.
      const nearLamp = (() => {
        const az = -19;
        const d = streetNear - 1.5;
        const [x, z] = at(az, d);
        const [xa, za] = at(az + 3.2, d - 1.2);
        const topY = STREET_Y + 4.6;
        furniture.push({ geo: new THREE.CylinderGeometry(0.2, 0.3, topY - STREET_Y, 7), m: xf(THREE, x, (topY + STREET_Y) / 2, z), c: '#7d766e' });
        furniture.push({ geo: rod(THREE, [x, topY - 0.3, z], [xa, topY, za], 0.11, 6), c: '#7d766e' });
        furniture.push({ geo: new THREE.BoxGeometry(1.0, 0.24, 0.42), m: xf(THREE, xa, topY - 0.05, za, 0, -(az + 3.2) * D2R, 0), c: '#4a4541' });
        furniture.push({ geo: new THREE.BoxGeometry(0.8, 0.06, 0.34), m: xf(THREE, xa, topY - 0.19, za, 0, -(az + 3.2) * D2R, 0), c: '#ffb45c' });
        return [xa, topY - 0.3, za];
      })();
      // Orelhão (concha laranja num poste), em escala maior para ser reconhecível.
      {
        const az = -7.2;
        const d = streetFar + 1.2;
        const [x, z] = at(az, d);
        const s = 2.3;
        furniture.push({ geo: new THREE.CylinderGeometry(0.07, 0.07, 1.7 * s, 6), m: xf(THREE, x, STREET_Y + 0.85 * s, z), c: '#3b3b3b' });
        furniture.push({ geo: lathe(THREE, [[0.0, 1.15], [0.35, 1.08], [0.52, 0.8], [0.55, 0.45], [0.5, 0.12], [0.42, 0.0]], 14, Math.PI * 0.35 - az * D2R, Math.PI * 1.3), m: xf(THREE, x, STREET_Y + 1.35 * s, z, 0, 0, 0, s), c: '#f07f1a' });
        furniture.push({ geo: new THREE.BoxGeometry(0.28 * s, 0.4 * s, 0.14 * s), m: xf(THREE, x, STREET_Y + 2.0 * s, z, 0, -az * D2R, 0), c: '#6c7c8a' });
      }
      g.add(mesh(merge(THREE, furniture, true), basic({ vertexColors: true, fog: false, side: THREE.DoubleSide }), { receive: false }));
      // Placa azul de rua no primeiro poste.
      {
        const az = lampAz[0];
        const d = streetFar + 0.6;
        const [x, z] = at(az, d);
        const signTex = canvasTex(paintStreetSign(T), { wrap: false });
        withFonts(FONTS, () => {
          signTex.image = paintStreetSign(T);
          signTex.needsUpdate = true;
        });
        const sign = new THREE.Mesh(track(new THREE.PlaneGeometry(3.3, 1.65)), basic({ map: signTex, fog: false, side: THREE.DoubleSide }));
        sign.position.set(x + 1.8 * Math.cos(az * D2R), STREET_Y + 3.0, z + 1.8 * Math.sin(az * D2R));
        sign.rotation.y = -az * D2R;
        g.add(sign);
      }
      const glowMat = basicSprite(glowTex, 0xffffff, 1);
      glows.forEach((p) => {
        const sp = new THREE.Sprite(glowMat);
        sp.position.set(p[0], p[1], p[2]);
        sp.scale.setScalar(1.9);
        g.add(sp);
      });
      {
        const sp = new THREE.Sprite(glowMat);
        sp.position.set(nearLamp[0], nearLamp[1], nearLamp[2]);
        sp.scale.setScalar(3.4);
        g.add(sp);
        glows.push(nearLamp);
      }
      // Carro passando de tempos em tempos (faróis, lanternas e o facho no asfalto).
      const car = (() => {
        const cg = new THREE.Group();
        const head = basicSprite(paintGlow(T, 'rgba(255,255,245,1)', 'rgba(255,250,230,0.5)'), 0xffffff, 1);
        const tail = basicSprite(paintGlow(T, 'rgba(255,80,60,1)', 'rgba(255,40,30,0.4)'), 0xffffff, 1);
        const h1 = new THREE.Sprite(head);
        const t1 = new THREE.Sprite(tail);
        h1.scale.setScalar(1.4);
        t1.scale.setScalar(0.9);
        const body = new THREE.Mesh(track(new THREE.BoxGeometry(1.2, 0.45, 4.2)), basic({ color: 0x0c0b0d, fog: false }));
        body.position.y = 0.35;
        const beamTex = canvasTex(paintGlow(T, 'rgba(255,245,220,0.8)', 'rgba(255,240,210,0.25)'), { wrap: false });
        const beam = new THREE.Mesh(track(new THREE.PlaneGeometry(2.4, 7)), basic({ map: beamTex, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
        beam.rotation.x = -Math.PI / 2;
        beam.position.set(0, 0.02, 4.4);
        h1.position.set(0, 0.35, 2.15);
        t1.position.set(0, 0.4, -2.15);
        cg.add(body, h1, t1, beam);
        cg.visible = false;
        g.add(cg);
        const st = { t: 0, next: 3 + rnd() * 4, dir: 1, dur: 5 };
        return {
          update(dt) {
            if (!cg.visible) {
              st.next -= dt;
              if (st.next <= 0) {
                cg.visible = true;
                st.t = 0;
                st.dir = rnd() < 0.5 ? 1 : -1;
                st.dur = 4.5 + rnd() * 2.5;
              }
              return;
            }
            st.t += dt / st.dur;
            if (st.t >= 1) {
              cg.visible = false;
              st.next = 7 + rnd() * 14;
              return;
            }
            const az = (st.dir > 0 ? -45 + st.t * 90 : 45 - st.t * 90) * D2R;
            const d = (streetNear + streetFar) / 2 + (st.dir > 0 ? 3 : -3);
            cg.position.set(Math.sin(az) * d, STREET_Y, -Math.cos(az) * d);
            cg.rotation.y = (st.dir > 0 ? Math.PI / 2 : -Math.PI / 2) - az;
          },
        };
      })();

      // Garoa contra a luz dos postes do fundo.
      const streakTex = canvasTex(paintStreak(T), { wrap: false });
      // O shader da garoa aceita 3 luzes: o poste perto e os dois primeiros da rua de baixo.
      const farLights = [nearLamp, glows[0], glows[1]].map((p, i) => new THREE.Vector4(p[0], p[1], p[2], i === 0 ? 0.6 : 0.35));
      const farRain = track(rainMaterial(THREE, streakTex, farLights, new THREE.Vector2(STREET_Y, 12)));
      farRain.uniforms.uBase.value = 0.08;
      farRain.uniforms.uSize.value = 0.35;
      {
        const n = lowAtBuild ? 500 : 1400;
        const pos = [];
        const info = [];
        for (let i = 0; i < n; i++) {
          const gl = glows[i % glows.length];
          pos.push(gl[0] + (rnd() - 0.5) * 12, STREET_Y + rnd() * 12, gl[2] + (rnd() - 0.5) * 10);
          info.push(rnd(), 5 + rnd() * 3);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 2));
        const pts = new THREE.Points(track(geo), farRain);
        pts.frustumCulled = false;
        g.add(pts);
      }

      const cam = ctx.camera;
      const fwd = new THREE.Vector3();
      const eye = new THREE.Vector3();
      const cur = { center: 22 * D2R, k: 0.9, ready: false };
      const band = {};
      let frozen = false;
      const murTop = F + L.murH + 0.3;
      const drawSize = new THREE.Vector2();
      return {
        group: g,
        /**
         * Congela o fundo numa pose física plausível para inspecionar com câmera livre: nivelado,
         * em escala 1 e rebaixado, com a rua de baixo uns 3 m abaixo da calçada do mirante.
         */
        freeze(on) {
          frozen = !!on;
          if (frozen) {
            g.position.set(0, F - 30, 0);
            g.rotation.set(0, 0, 0);
            g.scale.set(1, 1, 1);
          } else cur.ready = false;
        },
        update(dt, t) {
          bmat.uniforms.uTime.value = t;
          pmat.uniforms.uTime.value = t;
          tmat.uniforms.uTime.value = t;
          farRain.uniforms.uTime.value = t;
          sky.material.uniforms.uTime.value = t;
          ctx.renderer.getDrawingBufferSize(drawSize);
          const px = Math.max(1, drawSize.y / 800);
          pmat.uniforms.uPixel.value = px;
          tmat.uniforms.uPixel.value = px;
          farRain.uniforms.uScale.value = drawSize.y * 0.5;
          car.update(dt);
          if (frozen) return;
          cam.updateMatrixWorld();
          eye.setFromMatrixPosition(cam.matrixWorld);
          cam.getWorldDirection(fwd);
          backdropBand(eye.y, eye.z, Math.asin(clamp(fwd.y, -1, 1)), cam.fov, murTop, L.murZ, band);
          const kk = cur.ready ? 1 - Math.exp(-dt * 3) : 1;
          cur.center += (band.center - cur.center) * kk;
          cur.k += (band.k - cur.k) * kk;
          cur.ready = true;
          g.position.copy(eye);
          g.rotation.set(-cur.center, 0, 0);
          g.scale.set(cur.k, cur.k, 1);
        },
      };
    }

    // ------------------------------------------------------------------ partículas: poeira e vapor
    // Sem garoa perto da mesa (o usuário via a chuva caindo dentro do bar/sob o toldo): a garoa fica
    // só no fundo (buildBackdrop), na rua de baixo, do outro lado da mureta.
    const dust = (() => {
      const rnd = T.mulberry32(5);
      const n = 260;
      const pos = [];
      const info = [];
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * 4.2;
        pos.push(Math.cos(a) * r, 0.8 + rnd() * 8, Math.sin(a) * r + 0.3);
        info.push(rnd(), rnd(), rnd());
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 3));
      const mat = track(dustMaterial(THREE, canvasTex(paintGlow(T, 'rgba(255,255,255,1)', 'rgba(255,255,255,0.4)'), { wrap: false }), ctx.lights.key.position));
      const pts = new THREE.Points(track(geo), mat);
      pts.frustumCulled = false;
      return { pts, mat };
    })();
    group.add(dust.pts);

    const steam = (() => {
      const n = 7;
      const pos = [];
      const info = [];
      side.group.updateMatrixWorld(true);
      const wp = side.cupTop.clone().applyMatrix4(side.group.matrixWorld);
      for (let i = 0; i < n; i++) {
        pos.push(wp.x, wp.y, wp.z);
        info.push(i / n, i);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 2));
      const mat = track(steamMaterial(THREE, canvasTex(paintSteam(T), { wrap: false })));
      const pts = new THREE.Points(track(geo), mat);
      pts.frustumCulled = false;
      pts.renderOrder = 5;
      return { pts, mat, n };
    })();
    group.add(steam.pts);

    const drawSize = new THREE.Vector2();
    updaters.push((dt, t) => {
      ctx.renderer.getDrawingBufferSize(drawSize);
      const scale = drawSize.y * 0.5;
      dust.mat.uniforms.uTime.value = t;
      dust.mat.uniforms.uScale.value = scale;
      steam.mat.uniforms.uTime.value = t;
      steam.mat.uniforms.uScale.value = scale;
      // A névoa acompanha a distância da câmera (em retrato ela fica mais longe da mesa).
      const d = ctx.camera.position.length();
      fog.near = d + 10;
      fog.far = d + 70;
    });

    function applyQuality() {
      const hq = high();
      dust.pts.visible = hq;
      steam.mat.uniforms.uCount.value = hq ? steam.n : 3;
      bar.inLight.visible = hq;
      bar.coolLight.visible = hq;
    }
    applyQuality();

    ctx.scene.add(group);

    return {
      group,
      update(dt, t) {
        for (let i = 0; i < updaters.length; i++) updaters[i](dt, t);
      },
      /**
       * 'low'/'high' ao vivo: partículas, luz interna e fria, e as texturas grandes (calçada, fachada
       * e parede lateral) repintadas no tamanho da qualidade. Quantidade de prédios e luzes do fundo
       * só muda recarregando (é decidida na construção).
       */
      setQuality(q) {
        applyQuality();
        const next = q === 'low' ? 'low' : q === 'high' ? 'high' : high() ? 'high' : 'low';
        if (next !== texQuality && !disposed) {
          texQuality = next;
          for (const r of resizers) {
            try {
              r(next);
            } catch (e) {
              if (Truco.GfxUtil) Truco.GfxUtil.report(e, 'qualidade do cenário');
            }
          }
        }
      },
      setPlayers(n) {
        chairs.setPlayers(n);
      },
      onEvent(name, data) {
        if (name === 'truco') lamp.kick(data && data.strength);
        else if (name === 'debugBackdrop') backdrop.freeze(!!(data && data.freeze));
        else if (name === 'contextRestored' && !disposed) rebuildEnv();
      },
      dispose() {
        disposed = true;
        lamp.reset();
        ctx.scene.remove(group);
        if (ctx.scene.environment === env.texture) ctx.scene.environment = ctx.envMap || null;
        if (ctx.scene.fog === fog) ctx.scene.fog = null;
        group.traverse((o) => {
          if (o.isInstancedMesh) o.dispose();
        });
        env.dispose();
        R.dispose();
      },
    };
  }

  const World = { build, LAYOUT, TABLE_PROPS, SIDEWALK, sidewalkField, sidewalkTile, paintSidewalk, PRICES, checkProps, backdropBand };
  Truco.World = World;
  if (typeof module === 'object' && module.exports) module.exports = World;
})(typeof window !== 'undefined' ? window : globalThis);
