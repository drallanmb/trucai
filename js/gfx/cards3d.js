/*
 * TrucAÍ — Truco.Cards3D: cartas 3D, mãos, monte, vira, slots da mesa, feijões do placar
 * e todas as animações de carta. Quem orquestra é Truco.Scene (scene.js); o contrato interno
 * está em docs/SCENE-INTERNALS.md §5.
 *
 *   Cards3D.CARD                       // medidas da carta (0.63 × 0.88 × 0.006)
 *   Cards3D.create(ctx) -> table       // ver a lista de métodos no fim do arquivo
 *   Cards3D.layout(players, scale?)    // posições da mesa (puro, sem THREE); scale = escala de mesa
 *
 * Convenções: a carta tem a FACE em +Z local e o VERSO em −Z; o "para cima" da carta é +Y.
 * Na mesa, face para cima = rotação −90° em X (o topo da carta aponta para longe do humano).
 */
(function (root) {
  'use strict';
  const Truco = (root.Truco = root.Truco || {});

  const CARD = Object.freeze({ W: 0.63, H: 0.88, T: 0.006, R: 0.038 });
  const BASE_Y = 0.0006; // folga entre o tampo e a face de baixo da carta
  // Cartas sobre a mesa (jogadas, monte e vira) aparecem 35% maiores que o tamanho real, para leitura.
  // Em retrato (proporção < PORTRAIT_ASPECT) a câmera fica longe (os avatares laterais limitam a
  // largura), então a escala de mesa sobe para TS_PORTRAIT e o mapa do tampo se reorganiza.
  const TS = 1.35;
  const TS_PORTRAIT = 1.85;
  const PORTRAIT_ASPECT = 0.8;
  /** Escala das cartas sobre a mesa para a proporção da tela. */
  function tableScaleFor(aspect) {
    return aspect > 0 && aspect < PORTRAIT_ASPECT ? TS_PORTRAIT : TS;
  }
  const LIGHT = Object.freeze({ table: 0.12, hand: 0.4, fan: 0.04, deck: 0.05 });
  // frac: faixa inferior da tela ocupada pela mão; card: altura da carta dentro dessa faixa.
  const HAND = Object.freeze({ frac: 0.28, card: 0.9, dist: 2.2, spread: 0.76, angle: 0.11, drop: 0.035, tilt: -0.04 });
  // Vez do humano: fora da vez a mão fica REST_DROP (fração da altura do quadro) mais baixa e com
  // brilho REST_DIM; na vez ela sobe até a faixa da mão e ganha o contorno dourado pulsando.
  // Mão de onze: o leque da parceira ao lado da cabeça dela (unidades do mundo), virado para a câmera.
  const PARTNER_SHOW = Object.freeze({ scale: 1.7, side: 1.75, up: -0.55, front: 0.45 });
  const TURN = Object.freeze({ restDrop: 0.04, restDim: 0.85, lockedDim: 0.55, glow: 0.42, pulse: 0.16 });
  const SUIT_BY_LETTER = { c: 'clubs', h: 'hearts', s: 'spades', d: 'diamonds' };
  const LETTER_BY_SUIT = { clubs: 'c', hearts: 'h', spades: 's', diamonds: 'd' };
  const SUIT_SYMBOL = { clubs: '♣', hearts: '♥', spades: '♠', diamonds: '♦' };
  const RED = { hearts: true, diamonds: true };
  const UI_FONT = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';

  // ---------------------------------------------------------------------------
  // Utilidades puras
  // ---------------------------------------------------------------------------

  function parseCard(c) {
    if (!c || c.hidden) return null;
    if (typeof c === 'string') {
      const suit = SUIT_BY_LETTER[c.slice(-1)];
      return suit ? { id: c, rank: c.slice(0, -1), suit } : null;
    }
    if (c.rank && c.suit) return { id: c.id || c.rank + LETTER_BY_SUIT[c.suit], rank: c.rank, suit: c.suit };
    if (c.id) return parseCard(c.id);
    return null;
  }

  function hash01(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  function seatDirs(players) {
    return players === 2
      ? [
          [0, 1],
          [0, -1],
        ]
      : [
          [0, 1],
          [1, 0],
          [0, -1],
          [-1, 0],
        ];
  }

  /**
   * Posições na mesa (x, z em unidades; y = altura). Não depende de THREE.
   * `tableScale` (padrão TS): com a escala de retrato (TS_PORTRAIT) os slots se afastam do centro,
   * as rodadas dos laterais se empilham em z (não em x) e monte + vira ficam centralizados, para as
   * cartas maiores não invadirem o monte, a vira, as fileiras de tampinhas nem os adereços.
   */
  function layout(players, tableScale) {
    const n = players === 2 ? 2 : 4;
    const dirs = seatDirs(n);
    const s = tableScale > 0 ? tableScale : TS;
    const port = s > TS + 1e-6;
    const seatYaw = n === 2 ? [0, 0.05] : [0, -0.1, 0.05, 0.1];
    const radius = (d) => (port ? (d[0] !== 0 ? 1.86 : 1.83) : d[0] !== 0 ? 1.78 : 1.58);
    // Monte e vira: a vira sai por baixo do monte para a direita (em retrato o par fica centrado).
    const deckX = port ? -0.2625 * s : -0.12 * s;
    const viraX = port ? 0.1375 * s : 0.28 * s;
    return {
      players: n,
      dirs,
      scale: s,
      portrait: port,
      slot(seat, round) {
        const d = dirs[seat] || dirs[0];
        const r = radius(d);
        const k = round - 1;
        const jitter = (hash01('slot' + seat + ':' + round) - 0.5) * 0.2;
        let ox = k * 0.2 * s;
        let oz = k * 0.12 * s;
        if (port) {
          ox = d[0] !== 0 ? 0 : k * 0.13 * s;
          oz = d[0] !== 0 ? k * 0.16 * s : k * 0.04 * s * (d[1] < 0 ? -1 : 1);
        }
        return {
          x: d[0] * r + ox,
          z: d[1] * r + oz,
          y: BASE_Y + (s * CARD.T) / 2 + round * (s * CARD.T + 0.0012),
          yaw: seatYaw[seat] + jitter,
        };
      },
      turnSpot(seat) {
        const d = dirs[seat] || dirs[0];
        const r = radius(d);
        return { x: d[0] * r, z: d[1] * r };
      },
      // O monte do carteador lateral fica aquém das fileiras de tampinhas (x = ±2,8).
      dealerSpot(seat) {
        const d = dirs[seat] || dirs[0];
        const r = d[0] !== 0 ? 2.58 - (CARD.H * s) / 2 : 2.35;
        return { x: d[0] * r, z: d[1] * r, yaw: Math.atan2(d[0], d[1]) };
      },
      deckHome: { x: deckX, z: 0, yaw: 0 },
      viraHome: { x: viraX, z: 0, yaw: Math.PI / 2 },
      // Copo com tampinhas nos cantos do fundo; a fileira vem do copo em direção ao humano.
      holder(team) {
        return { x: team === 0 ? -2.95 : 2.95, z: -2.95 };
      },
      napkin(team) {
        return { x: team === 0 ? -2.45 : 2.45, z: -2.72, yaw: team === 0 ? -0.14 : 0.12 };
      },
      capRow(team, i) {
        const side = team === 0 ? -1 : 1;
        return {
          x: side * (2.8 + (hash01('bx' + team + i) - 0.5) * 0.04),
          z: -2.25 + i * 0.3 + Math.floor(i / 3) * 0.14,
          yaw: hash01('by' + team + i) * Math.PI * 2,
        };
      },
      /** Retângulo (alinhado aos eixos) que cobre as três rodadas de um assento, com o giro das cartas. */
      slotBounds(seat) {
        let x0 = Infinity;
        let x1 = -Infinity;
        let z0 = Infinity;
        let z1 = -Infinity;
        const hw = (CARD.W * s) / 2;
        const hh = (CARD.H * s) / 2;
        for (let round = 0; round < 3; round++) {
          const p = this.slot(seat, round);
          const a = Math.abs(p.yaw);
          const ex = Math.cos(a) * hw + Math.sin(a) * hh;
          const ez = Math.sin(a) * hw + Math.cos(a) * hh;
          x0 = Math.min(x0, p.x - ex);
          x1 = Math.max(x1, p.x + ex);
          z0 = Math.min(z0, p.z - ez);
          z1 = Math.max(z1, p.z + ez);
        }
        return { x0, x1, z0, z1 };
      },
      /**
       * Zonas do tampo reservadas para cartas e placar (adereços do World devem evitá-las). Valem
       * para as duas escalas de mesa (paisagem e retrato): os adereços não mudam com a proporção.
       */
      keepOut() {
        const zones = [{ kind: 'circle', x: 0, z: 0, r: 2.7 }];
        for (const L of [layout(n, TS), layout(n, TS_PORTRAIT)]) {
          for (let seat = 0; seat < n; seat++) {
            const b = L.slotBounds(seat);
            zones.push({ kind: 'rect', x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, w: b.x1 - b.x0, d: b.z1 - b.z0 });
          }
        }
        for (let seat = 0; seat < n; seat++) {
          const d = this.dealerSpot(seat);
          zones.push({ kind: 'circle', x: d.x, z: d.z, r: 0.75 });
        }
        for (const t of [0, 1]) {
          const side = t === 0 ? -1 : 1;
          zones.push({ kind: 'rect', x: side * 2.8, z: -0.45, w: 0.7, d: 3.9 });
          zones.push({ kind: 'circle', x: side * 2.75, z: -2.8, r: 0.75 });
        }
        return zones;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Canvas
  // ---------------------------------------------------------------------------

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.arcTo(x + w, y, x + w, y + r, r);
    g.lineTo(x + w, y + h - r);
    g.arcTo(x + w, y + h, x + w - r, y + h, r);
    g.lineTo(x + r, y + h);
    g.arcTo(x, y + h, x, y + h - r, r);
    g.lineTo(x, y + r);
    g.arcTo(x, y, x + r, y, r);
    g.closePath();
  }

  /** Erros internos (redesenho, textura) vão para Truco.reportError quando existe (lido na hora). */
  function report(err, where) {
    const U = Truco.GfxUtil;
    if (U && U.report) U.report(err, where);
    else if (root.console) root.console.error(where, err);
  }

  /**
   * Redesenha a textura quando a fonte (declarada E carregada) chegar; `alive()` diz se o dono ainda
   * existe. A falha da fonte é ignorada (fica a de reserva); exceção no redesenho vai para o relator.
   */
  function whenFonts(font, redraw, alive) {
    const U = Truco.GfxUtil;
    if (U && U.onFonts) {
      U.onFonts([font], redraw, alive);
      return;
    }
    if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return;
    document.fonts.load(font).then(
      () => {
        if (alive && !alive()) return;
        try {
          redraw();
        } catch (e) {
          report(e, 'redesenho');
        }
      },
      () => {}
    );
  }

  // ---------------------------------------------------------------------------
  // Geometria da carta: face (+Z), verso (−Z) e borda, num só BufferGeometry com 3 grupos.
  // ---------------------------------------------------------------------------

  function outline(W, H, R, seg) {
    const pts = [];
    const corners = [
      [W / 2 - R, -H / 2 + R, -Math.PI / 2],
      [W / 2 - R, H / 2 - R, 0],
      [-W / 2 + R, H / 2 - R, Math.PI / 2],
      [-W / 2 + R, -H / 2 + R, Math.PI],
    ];
    for (const [cx, cy, a0] of corners) {
      for (let i = 0; i <= seg; i++) {
        const a = a0 + (i / seg) * (Math.PI / 2);
        pts.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]);
      }
    }
    return pts;
  }

  function buildCardGeometry(THREE) {
    const { W, H, T, R } = CARD;
    const pts = outline(W, H, R, 6);
    const n = pts.length;
    const pos = [];
    const nor = [];
    const uv = [];
    const idx = [];
    // Face
    pos.push(0, 0, T / 2);
    nor.push(0, 0, 1);
    uv.push(0.5, 0.5);
    for (const [x, y] of pts) {
      pos.push(x, y, T / 2);
      nor.push(0, 0, 1);
      uv.push(x / W + 0.5, y / H + 0.5);
    }
    for (let i = 0; i < n; i++) idx.push(0, 1 + i, 1 + ((i + 1) % n));
    const faceCount = idx.length;
    // Verso (UV espelhado em x para o desenho não sair invertido)
    const b0 = pos.length / 3;
    pos.push(0, 0, -T / 2);
    nor.push(0, 0, -1);
    uv.push(0.5, 0.5);
    for (const [x, y] of pts) {
      pos.push(x, y, -T / 2);
      nor.push(0, 0, -1);
      uv.push(1 - (x / W + 0.5), y / H + 0.5);
    }
    for (let i = 0; i < n; i++) idx.push(b0, b0 + 1 + ((i + 1) % n), b0 + 1 + i);
    const backCount = idx.length - faceCount;
    // Borda
    const e0 = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const [x, y] = pts[i];
      let nx = x - Math.max(-W / 2 + R, Math.min(W / 2 - R, x));
      let ny = y - Math.max(-H / 2 + R, Math.min(H / 2 - R, y));
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
      pos.push(x, y, T / 2, x, y, -T / 2);
      nor.push(nx, ny, 0, nx, ny, 0);
      uv.push(i / n, 1, i / n, 0);
    }
    for (let i = 0; i < n; i++) {
      const a = e0 + i * 2;
      const b = a + 1;
      const c = e0 + ((i + 1) % n) * 2;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const edgeCount = idx.length - faceCount - backCount;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.addGroup(0, faceCount, 0);
    g.addGroup(faceCount, backCount, 1);
    g.addGroup(faceCount + backCount, edgeCount, 2);
    g.computeBoundingSphere();
    return g;
  }

  // ---------------------------------------------------------------------------
  // Texturas de apoio
  // ---------------------------------------------------------------------------

  function srgbTexture(THREE, canvas) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  /** Baralho mínimo usado só se Truco.CardTex não estiver carregado. */
  function createFallbackTex(THREE) {
    const cache = new Map();
    const W = 256;
    const H = 358;
    function face(card) {
      const c = parseCard(card);
      if (!c) return back();
      if (cache.has(c.id)) return cache.get(c.id);
      const cv = makeCanvas(W, H);
      const g = cv.getContext('2d');
      const draw = () => {
        g.clearRect(0, 0, W, H);
        g.fillStyle = '#F7F1E3';
        g.fillRect(0, 0, W, H);
        roundRect(g, 3, 3, W - 6, H - 6, 14);
        g.strokeStyle = 'rgba(96,72,40,0.4)';
        g.lineWidth = 3;
        g.stroke();
        const color = RED[c.suit] ? '#C0272D' : '#1B1B1F';
        g.fillStyle = color;
        g.textAlign = 'center';
        const corner = (rot) => {
          g.save();
          if (rot) {
            g.translate(W, H);
            g.rotate(Math.PI);
          }
          g.font = '700 58px ' + UI_FONT;
          g.fillText(c.rank, 30, 62);
          g.font = '40px serif';
          g.fillText(SUIT_SYMBOL[c.suit], 30, 102);
          g.restore();
        };
        corner(false);
        corner(true);
        g.font = '130px serif';
        g.textBaseline = 'middle';
        g.fillText(SUIT_SYMBOL[c.suit], W / 2, H / 2 + 6);
        g.textBaseline = 'alphabetic';
      };
      draw();
      const tex = srgbTexture(THREE, cv);
      whenFonts(
        '700 58px ' + UI_FONT,
        () => {
          draw();
          tex.needsUpdate = true;
        },
        () => cache.has(c.id)
      );
      cache.set(c.id, tex);
      return tex;
    }
    function back() {
      if (cache.has('back')) return cache.get('back');
      const cv = makeCanvas(W, H);
      const g = cv.getContext('2d');
      g.fillStyle = '#F7F1E3';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#7e1c1c';
      roundRect(g, 14, 14, W - 28, H - 28, 10);
      g.fill();
      g.strokeStyle = 'rgba(247,241,227,0.25)';
      g.lineWidth = 2;
      for (let i = -H; i < W + H; i += 16) {
        g.beginPath();
        g.moveTo(i, 14);
        g.lineTo(i + H, H);
        g.stroke();
      }
      g.fillStyle = '#C9A15B';
      g.beginPath();
      g.arc(W / 2, H / 2, 46, 0, Math.PI * 2);
      g.fill();
      const tex = srgbTexture(THREE, cv);
      cache.set('back', tex);
      return tex;
    }
    return {
      face,
      back,
      dispose() {
        cache.forEach((t) => t.dispose());
        cache.clear();
      },
    };
  }

  /** Contorno dourado (#C9A15B) em volta da carta, para a vez do humano. */
  function edgeGlowCanvas() {
    const m = 0.07;
    const w = 256;
    const h = Math.round((w * (CARD.H + 2 * m)) / (CARD.W + 2 * m));
    const inset = Math.round((m / (CARD.W + 2 * m)) * w);
    const cv = makeCanvas(w, h);
    const g = cv.getContext('2d');
    g.shadowColor = 'rgba(201, 161, 91, 1)';
    g.shadowBlur = 16;
    g.strokeStyle = 'rgba(232, 196, 120, 1)';
    g.lineWidth = 7;
    roundRect(g, inset - 2, inset - 2, w - inset * 2 + 4, h - inset * 2 + 4, 14);
    g.stroke();
    g.stroke();
    return { canvas: cv, margin: m };
  }

  function glowCanvas() {
    const m = 0.18;
    const w = 256;
    const h = Math.round((w * (CARD.H + 2 * m)) / (CARD.W + 2 * m));
    const inset = Math.round((m / (CARD.W + 2 * m)) * w);
    const cv = makeCanvas(w, h);
    const g = cv.getContext('2d');
    g.shadowColor = 'rgba(255, 196, 92, 1)';
    g.shadowBlur = 34;
    g.fillStyle = 'rgba(255, 214, 130, 1)';
    for (let i = 0; i < 2; i++) {
      roundRect(g, inset, inset, w - inset * 2, h - inset * 2, 12);
      g.fill();
    }
    return { canvas: cv, margin: m };
  }

  /** Moldura dourada fina para a face das manilhas na mão. */
  function rimCanvas() {
    const W = 256;
    const H = 358;
    const cv = makeCanvas(W, H);
    const g = cv.getContext('2d');
    g.shadowColor = 'rgba(255, 190, 70, 0.9)';
    g.shadowBlur = 14;
    g.strokeStyle = '#D9A92E';
    g.lineWidth = 7;
    roundRect(g, 7, 7, W - 14, H - 14, 12);
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(255, 236, 170, 0.9)';
    g.lineWidth = 2;
    roundRect(g, 7, 7, W - 14, H - 14, 12);
    g.stroke();
    return cv;
  }

  function radialCanvas(inner, outer) {
    const S = 256;
    const cv = makeCanvas(S, S);
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, inner);
    grd.addColorStop(0.45, outer);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    return cv;
  }

  /**
   * Véu "encoberta" da mão do humano. As cartas do leque se sobrepõem (a de cima cobre a direita da
   * de baixo), então o rótulo fica na faixa esquerda de cada carta, em pé, abaixo do índice.
   */
  function veilCanvas() {
    const W = 256;
    const H = 358;
    const cv = makeCanvas(W, H);
    const g = cv.getContext('2d');
    const draw = () => {
      g.clearRect(0, 0, W, H);
      g.save();
      roundRect(g, 0, 0, W, H, 16);
      g.clip();
      g.fillStyle = 'rgba(23, 17, 13, 0.6)';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(201, 161, 91, 0.16)';
      g.lineWidth = 10;
      for (let i = -H; i < W + H; i += 30) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i + H, H);
        g.stroke();
      }
      g.restore();
      roundRect(g, 5, 5, W - 10, H - 10, 13);
      g.strokeStyle = 'rgba(201, 161, 91, 0.95)';
      g.lineWidth = 6;
      g.setLineDash([16, 10]);
      g.stroke();
      g.setLineDash([]);
      const top = 104;
      const bottom = H - 16;
      roundRect(g, 14, top, 78, bottom - top, 12);
      g.fillStyle = 'rgba(23, 17, 13, 0.9)';
      g.fill();
      g.save();
      g.translate(0, (top + bottom) / 2);
      g.rotate(-Math.PI / 2);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#EBDDBF';
      g.font = '700 38px ' + UI_FONT;
      g.fillText('ENCOBERTA', 0, 38, bottom - top - 16);
      g.fillStyle = '#C9A15B';
      g.font = '600 22px ' + UI_FONT;
      g.fillText('NÃO VALE NADA', 0, 72, bottom - top - 16);
      g.restore();
    };
    draw();
    return { canvas: cv, draw };
  }

  const KEY_FONT = '700 40px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';

  /** Selo com o número da tecla (1/2/3) que joga a carta, no estilo das dicas "T" e "E" do HUD. */
  function keyBadgeCanvas(n) {
    const S = 64;
    const cv = makeCanvas(S, S);
    const g = cv.getContext('2d');
    const draw = () => {
      g.clearRect(0, 0, S, S);
      roundRect(g, 5, 5, S - 10, S - 10, 11);
      g.fillStyle = 'rgba(23, 17, 13, 0.9)';
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(201, 161, 91, 0.95)';
      g.stroke();
      g.fillStyle = '#EBDDBF';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = KEY_FONT;
      g.fillText(String(n), S / 2, S / 2 + 2);
    };
    draw();
    return { canvas: cv, draw };
  }

  /** O aparelho tem mouse (hover de verdade)? Só então as cartas mostram as teclas 1/2/3. */
  function hoverCapable() {
    try {
      return !!(root.matchMedia && root.matchMedia('(hover: hover)').matches && root.matchMedia('(pointer: fine)').matches);
    } catch (e) {
      return false;
    }
  }

  const NAPKIN_FONT = 'italic 700 92px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';

  /** Guardanapo de papel com o nome do time escrito a caneta. */
  function napkinCanvas(text, seed) {
    const S = 256;
    const cv = makeCanvas(S, S);
    const g = cv.getContext('2d');
    const draw = () => {
      g.clearRect(0, 0, S, S);
      g.fillStyle = '#f3efe6';
      g.fillRect(4, 4, S - 8, S - 8);
      g.strokeStyle = 'rgba(160, 150, 130, 0.35)';
      g.lineWidth = 2;
      g.setLineDash([3, 5]);
      g.strokeRect(16, 16, S - 32, S - 32);
      g.setLineDash([]);
      g.strokeStyle = 'rgba(120, 110, 95, 0.18)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(S / 2 + (seed ? 6 : -4), 6);
      g.lineTo(S / 2 + (seed ? -3 : 5), S - 6);
      g.stroke();
      g.save();
      g.translate(seed ? S * 0.36 : S * 0.64, S - 62);
      g.rotate(seed ? 0.05 : -0.06);
      g.fillStyle = 'rgba(35, 64, 142, 0.9)';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = NAPKIN_FONT;
      g.fillText(text, 0, 0, S * 0.7);
      g.restore();
    };
    draw();
    return { canvas: cv, draw };
  }

  /** Miolo pintado da tampinha (marca fictícia "Garoa"). */
  function capLogoCanvas(bg, ring, ink) {
    const S = 128;
    const cv = makeCanvas(S, S);
    const g = cv.getContext('2d');
    const draw = () => {
      g.clearRect(0, 0, S, S);
      g.fillStyle = bg;
      g.fillRect(0, 0, S, S);
      g.strokeStyle = ring;
      g.lineWidth = 10;
      g.beginPath();
      g.arc(S / 2, S / 2, S / 2 - 12, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = ring;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.beginPath();
        g.arc(S / 2 + Math.cos(a) * (S / 2 - 26), S / 2 + Math.sin(a) * (S / 2 - 26), 2.5, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = ink;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '400 70px Shrikhand, Georgia, serif';
      g.fillText('G', S / 2, S / 2 + 4);
    };
    draw();
    return { canvas: cv, draw };
  }

  // ---------------------------------------------------------------------------
  // Kit: geometria e materiais compartilhados
  // ---------------------------------------------------------------------------

  function createKit(ctx) {
    const THREE = ctx.THREE;
    const geometry = buildCardGeometry(THREE);
    const fallback = createFallbackTex(THREE);
    const texSource = () => {
      const CT = Truco.CardTex;
      return CT && typeof CT.face === 'function' && typeof CT.back === 'function' ? CT : fallback;
    };
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe6dcc4, roughness: 0.8, metalness: 0 });
    const stackEdgeMat = new THREE.MeshStandardMaterial({ color: 0xd9ccb0, roughness: 0.9, metalness: 0 });
    const faceMats = new Map();
    let backTex = null;
    let kitDisposed = false;

    function backTexture() {
      if (!backTex) backTex = texSource().back();
      return backTex;
    }

    function cardMaterial(map, light) {
      return new THREE.MeshStandardMaterial({
        map,
        emissive: 0xffffff,
        emissiveMap: map,
        emissiveIntensity: light,
        roughness: 0.52,
        metalness: 0,
        envMapIntensity: 0.45,
      });
    }

    // Verso (preto liso com os três quadrados): menos difuso e menos reflexo que a face, para o preto
    // não virar marrom sob a lâmpada quente; um pouco mais de brilho próprio (só os quadrados brancos
    // do mapa brilham) para eles continuarem nítidos. base multiplica o `dim` e glow a luz em setLight.
    const BACK_BASE = new THREE.Color(0x8a8a8a).r;
    const BACK_GLOW = 4;
    function backMaterial(map, light) {
      const m = new THREE.MeshStandardMaterial({
        map,
        color: new THREE.Color().setScalar(BACK_BASE),
        emissive: 0xffffff,
        emissiveMap: map,
        emissiveIntensity: light * BACK_GLOW,
        roughness: 0.35,
        metalness: 0,
        envMapIntensity: 0.25,
      });
      m.userData.base = BACK_BASE;
      m.userData.glow = BACK_GLOW;
      return m;
    }

    function faceMat(card) {
      const c = parseCard(card);
      if (!c) return null;
      let m = faceMats.get(c.id);
      if (!m) {
        let tex;
        try {
          tex = texSource().face(c);
        } catch (e) {
          // Registra (uma vez por carta: o material fica em cache) antes de usar o desenho reserva.
          report(e, 'textura da carta ' + c.id);
          tex = fallback.face(c);
        }
        m = cardMaterial(tex, LIGHT.table);
        faceMats.set(c.id, m);
      }
      return m;
    }

    const stackTopMat = backMaterial(backTexture(), LIGHT.deck);

    const glow = glowCanvas();
    const glowTex = srgbTexture(THREE, glow.canvas);
    const glowGeo = new THREE.PlaneGeometry(CARD.W + glow.margin * 2, CARD.H + glow.margin * 2);
    const edge = edgeGlowCanvas();
    const edgeTex = srgbTexture(THREE, edge.canvas);
    const edgeGeo = new THREE.PlaneGeometry(CARD.W + edge.margin * 2, CARD.H + edge.margin * 2);
    let veil = null;
    let veilTex = null;
    const rimTex = srgbTexture(THREE, rimCanvas());
    const veilGeo = new THREE.PlaneGeometry(CARD.W, CARD.H);

    function veilTexture() {
      if (!veilTex) {
        veil = veilCanvas();
        veilTex = srgbTexture(THREE, veil.canvas);
        whenFonts(
          '700 38px ' + UI_FONT,
          () => {
            veil.draw();
            veilTex.needsUpdate = true;
          },
          () => !kitDisposed
        );
      }
      return veilTex;
    }

    function makeCard(card) {
      const back = backMaterial(backTexture(), LIGHT.table);
      const mesh = new THREE.Mesh(geometry, [back, back, edgeMat]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { card: parseCard(card), back, revealed: false, glow: null, veil: null, rim: null, light: LIGHT.table, dim: 1 };
      return mesh;
    }

    function reveal(mesh, card) {
      const c = parseCard(card) || mesh.userData.card;
      if (!c) return;
      mesh.userData.card = c;
      const m = faceMat(c);
      m.emissiveIntensity = mesh.userData.light * (m.userData.glow || 1);
      m.color.setScalar(mesh.userData.dim * (m.userData.base || 1));
      mesh.material[0] = m;
      mesh.userData.revealed = true;
    }

    function conceal(mesh) {
      mesh.material[0] = mesh.userData.back;
      mesh.userData.revealed = false;
    }

    function setLight(mesh, light, dim) {
      const u = mesh.userData;
      if (light != null) u.light = light;
      if (dim != null) u.dim = dim;
      for (const m of [mesh.material[0], u.back]) {
        m.emissiveIntensity = u.light * (m.userData.glow || 1);
        m.color.setScalar(u.dim * (m.userData.base || 1));
      }
    }

    function glowOf(mesh) {
      if (!mesh.userData.glow) {
        const m = new THREE.MeshBasicMaterial({
          map: glowTex,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        });
        const g = new THREE.Mesh(glowGeo, m);
        g.position.z = -CARD.T / 2 - 0.004;
        g.renderOrder = 2;
        mesh.add(g);
        mesh.userData.glow = g;
      }
      return mesh.userData.glow;
    }

    function veilOf(mesh) {
      if (!mesh.userData.veil) {
        const m = new THREE.MeshBasicMaterial({ map: veilTexture(), transparent: true, opacity: 0, depthWrite: false });
        const v = new THREE.Mesh(veilGeo, m);
        v.position.z = CARD.T / 2 + 0.0015;
        v.renderOrder = 3;
        mesh.add(v);
        mesh.userData.veil = v;
      }
      return mesh.userData.veil;
    }

    const keyTex = {};
    const keyGeo = new THREE.PlaneGeometry(0.17, 0.17);
    function keyTexture(n) {
      if (!keyTex[n]) {
        const kc = keyBadgeCanvas(n);
        const tex = srgbTexture(THREE, kc.canvas);
        whenFonts(
          KEY_FONT,
          () => {
            kc.draw();
            tex.needsUpdate = true;
          },
          () => !kitDisposed
        );
        keyTex[n] = tex;
      }
      return keyTex[n];
    }

    /** Selo da tecla (1/2/3) na parte de baixo da carta; `back` = carta mostrada pelo verso. */
    function keyOf(mesh, n, back) {
      let b = mesh.userData.key;
      if (!b) {
        const m = new THREE.MeshBasicMaterial({ map: keyTexture(n), transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
        b = new THREE.Mesh(keyGeo, m);
        b.renderOrder = 3;
        mesh.add(b);
        mesh.userData.key = b;
      }
      if (b.material.map !== keyTexture(n)) b.material.map = keyTexture(n);
      b.position.set(0, -CARD.H / 2 + 0.11, back ? -CARD.T / 2 - 0.0025 : CARD.T / 2 + 0.0025);
      b.rotation.set(0, back ? Math.PI : 0, 0);
      return b;
    }

    /** Contorno dourado da vez (atrás da carta: só a borda aparece). */
    function edgeOf(mesh) {
      if (!mesh.userData.edge) {
        const m = new THREE.MeshBasicMaterial({
          map: edgeTex,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        });
        const g = new THREE.Mesh(edgeGeo, m);
        g.position.z = -CARD.T / 2 - 0.003;
        g.renderOrder = 2;
        mesh.add(g);
        mesh.userData.edge = g;
      }
      return mesh.userData.edge;
    }

    function rimOf(mesh) {
      if (!mesh.userData.rim) {
        const m = new THREE.MeshBasicMaterial({ map: rimTex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
        const r = new THREE.Mesh(veilGeo, m);
        r.position.z = CARD.T / 2 + 0.001;
        r.renderOrder = 3;
        mesh.add(r);
        mesh.userData.rim = r;
      }
      return mesh.userData.rim;
    }

    function tableGlow() {
      const m = new THREE.MeshBasicMaterial({
        map: glowTex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const g = new THREE.Mesh(glowGeo, m);
      g.rotation.x = -Math.PI / 2;
      g.renderOrder = 1;
      return g;
    }

    function disposeCard(mesh) {
      if (!mesh) return;
      Truco.Tween.kill(mesh);
      if (mesh.parent) mesh.parent.remove(mesh);
      mesh.userData.back.dispose();
      for (const k of ['glow', 'veil', 'rim', 'edge', 'key']) {
        const fx = mesh.userData[k];
        if (fx) {
          Truco.Tween.kill(fx.material);
          fx.material.dispose();
        }
      }
    }

    return {
      geometry,
      edgeMat,
      stackEdgeMat,
      stackTopMat,
      makeCard,
      reveal,
      conceal,
      setLight,
      glowOf,
      veilOf,
      rimOf,
      edgeOf,
      keyOf,
      tableGlow,
      faceMat,
      disposeCard,
      dispose() {
        kitDisposed = true;
        geometry.dispose();
        glowGeo.dispose();
        veilGeo.dispose();
        edgeGeo.dispose();
        edgeTex.dispose();
        keyGeo.dispose();
        Object.keys(keyTex).forEach((k) => keyTex[k].dispose());
        glowTex.dispose();
        rimTex.dispose();
        if (veilTex) veilTex.dispose();
        edgeMat.dispose();
        stackEdgeMat.dispose();
        stackTopMat.dispose();
        faceMats.forEach((m) => m.dispose());
        faceMats.clear();
        fallback.dispose();
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Controlador das cartas na cena
  // ---------------------------------------------------------------------------

  function create(ctx) {
    const THREE = ctx.THREE;
    const Tween = Truco.Tween;
    const kit = createKit(ctx);
    const camera = ctx.camera;
    const sfx = (name) => {
      if (ctx.sfx) ctx.sfx(name);
    };
    const avatarOf = (seat) => (ctx.avatar ? ctx.avatar(seat) : null);

    const world = new THREE.Group();
    world.name = 'cards';
    ctx.scene.add(world);

    const Y = new THREE.Vector3(0, 1, 0);
    const X = new THREE.Vector3(1, 0, 0);
    const qFlat = new THREE.Quaternion().setFromAxisAngle(X, -Math.PI / 2);
    const qFlip = new THREE.Quaternion().setFromAxisAngle(Y, Math.PI);
    const tmpM = new THREE.Matrix4();
    const tmpV = new THREE.Vector3();
    const tmpS = new THREE.Vector3();
    const tmpE = new THREE.Euler(0, 0, 0, 'ZYX');
    const tmpQ = new THREE.Quaternion();

    let lay = layout(ctx.players || 4, tableScaleFor(camera && camera.aspect));
    /** Escala atual das cartas sobre a mesa (muda com a proporção da tela; ver setTableScale). */
    const ts = () => lay.scale;
    const state = {
      players: lay.players,
      deckSize: 24,
      table: [], // { mesh, seat, round, faceDown, card, glow, yaw }
      vira: null,
      fans: {}, // seat -> { group, cards: [{ mesh, card }], shown }
      dealing: false,
      pendingHand: null,
      disposed: false,
      gen: 0, // muda a cada reset: continuações de animações antigas desistem
    };
    const alive = (gen) => !state.disposed && gen === state.gen;
    const human = {
      entries: [], // { card, mesh, showBack }
      interactive: false,
      playable: null,
      highlight: false,
      manilhaRank: null,
      faceDown: false,
      hover: -1,
      touch: false, // o último ponteiro foi um toque (esconde as teclas 1/2/3)
      frame: { fov: 40, aspect: 1.6, halfH: 0.8, halfW: 1.28, scale: 0.5 },
    };

    function tableQuat(yaw, faceUp, out) {
      const q = out || new THREE.Quaternion();
      q.setFromAxisAngle(Y, yaw).multiply(qFlat);
      if (!faceUp) q.multiply(qFlip);
      return q;
    }

    function worldPose(parent, pos, quat, scale, out) {
      const o = out || { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1 };
      tmpS.setScalar(scale);
      tmpM.compose(pos, quat, tmpS);
      parent.updateWorldMatrix(true, false);
      tmpM.premultiply(parent.matrixWorld);
      tmpM.decompose(o.pos, o.quat, tmpS);
      o.scale = tmpS.x;
      return o;
    }

    // ------------------------------------------------------------------ monte

    function makeStack(count) {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(kit.geometry, [kit.stackTopMat, kit.stackTopMat, kit.stackEdgeMat]);
      mesh.rotation.x = -Math.PI / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      const st = {
        group,
        mesh,
        count: 0,
        base: BASE_Y,
        setCount(n) {
          st.count = Math.max(0, n);
          mesh.visible = st.count > 0.01;
          mesh.scale.z = Math.max(0.001, st.count);
          mesh.position.y = st.base + (st.count * CARD.T) / 2;
        },
        topLocalY() {
          return st.base + st.count * CARD.T;
        },
        dispose() {
          if (group.parent) group.parent.remove(group);
        },
      };
      st.setCount(count);
      return st;
    }

    const deck = makeStack(24);
    deck.group.scale.setScalar(ts());
    deck.group.position.set(lay.deckHome.x, 0, lay.deckHome.z);
    deck.group.rotation.y = lay.deckHome.yaw;
    world.add(deck.group);

    function deckTopPose(out) {
      const o = out || { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1 };
      const k = deck.group.scale.x;
      o.pos.set(deck.group.position.x, deck.group.position.y + k * (deck.topLocalY() + CARD.T / 2), deck.group.position.z);
      tableQuat(deck.group.rotation.y, false, o.quat);
      o.scale = k;
      return o;
    }

    function moveDeck(spot, duration) {
      const p0 = deck.group.position.clone();
      const yaw0 = deck.group.rotation.y;
      let dyaw = spot.yaw - yaw0;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const dist = Math.hypot(spot.x - p0.x, spot.z - p0.z);
      if (dist < 0.01 && Math.abs(dyaw) < 0.01) return Promise.resolve();
      sfx('slide');
      return Tween.run(
        duration,
        (e) => {
          deck.group.position.set(p0.x + (spot.x - p0.x) * e, Math.sin(Math.PI * e) * 0.12, p0.z + (spot.z - p0.z) * e);
          deck.group.rotation.y = yaw0 + dyaw * e;
        },
        { ease: 'inOutCubic', target: deck.group }
      );
    }

    /** Embaralhada curta: o monte se divide em dois e as metades se intercalam (riffle). */
    async function shuffle() {
      const gen = state.gen;
      const n = deck.count;
      if (n < 2) return;
      const pivot = new THREE.Group();
      pivot.position.copy(deck.group.position);
      pivot.rotation.y = deck.group.rotation.y;
      pivot.scale.copy(deck.group.scale);
      world.add(pivot);
      const A = makeStack(Math.ceil(n / 2));
      const B = makeStack(Math.floor(n / 2));
      const C = makeStack(0);
      pivot.add(A.group, B.group, C.group);
      deck.setCount(0);
      sfx('shuffle');
      await Promise.all([
        Tween.to(A.group.position, { x: -0.4, z: 0.05 }, { duration: 0.16 }),
        Tween.to(B.group.position, { x: 0.4, z: -0.05 }, { duration: 0.16 }),
        Tween.to(A.group.rotation, { z: 0.14 }, { duration: 0.16 }),
        Tween.to(B.group.rotation, { z: -0.14 }, { duration: 0.16 }),
      ]);
      const abort = () => {
        world.remove(pivot);
        if (alive(gen)) deck.setCount(n);
      };
      if (!alive(gen)) return abort();
      const K = 10;
      const chunk = n / K;
      const flicks = [];
      for (let k = 0; k < K; k++) {
        const src = k % 2 === 0 ? A : B;
        flicks.push(
          Tween.delay(k * 0.045).then(() => {
            if (!alive(gen)) return null;
            src.setCount(Math.max(0, src.count - chunk));
            const card = kit.makeCard(null);
            kit.setLight(card, LIGHT.deck);
            card.castShadow = false;
            pivot.add(card);
            const from = new THREE.Vector3(src.group.position.x, src.topLocalY() + 0.02, src.group.position.z);
            const qa = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, src === A ? 0.14 : -0.14));
            const qb = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
            return Tween.run(
              0.13,
              (e) => {
                const to = C.topLocalY() + CARD.T / 2;
                card.position.set(from.x * (1 - e), from.y + (to - from.y) * e + Math.sin(Math.PI * e) * 0.06, from.z * (1 - e));
                card.quaternion.slerpQuaternions(qa, qb, e);
              },
              { ease: 'inQuad', target: card }
            ).then(() => {
              C.setCount(C.count + chunk);
              kit.disposeCard(card);
            });
          })
        );
      }
      await Promise.all(flicks);
      if (!alive(gen)) return abort();
      await Promise.all([
        Tween.to(A.group.position, { x: 0, z: 0 }, { duration: 0.1 }),
        Tween.to(B.group.position, { x: 0, z: 0 }, { duration: 0.1 }),
      ]);
      A.dispose();
      B.dispose();
      C.setCount(n);
      await Tween.run(0.14, (e) => {
        C.group.scale.set(1 + Math.sin(Math.PI * e) * 0.04, 1, 1 - Math.sin(Math.PI * e) * 0.03);
      });
      C.dispose();
      abort();
    }

    /**
     * Corte rápido (~0,3 s), usado no lugar do riffle quando dealHand recebe quickShuffle: a metade
     * de cima sai para o lado, a de baixo sobe e a de cima entra por baixo.
     */
    async function cut() {
      const gen = state.gen;
      const n = deck.count;
      if (n < 2) return;
      const pivot = new THREE.Group();
      pivot.position.copy(deck.group.position);
      pivot.rotation.y = deck.group.rotation.y;
      pivot.scale.copy(deck.group.scale);
      world.add(pivot);
      const bottom = makeStack(Math.ceil(n / 2));
      const top = makeStack(Math.floor(n / 2));
      bottom.base = deck.base;
      bottom.setCount(bottom.count);
      top.base = deck.base;
      top.setCount(top.count);
      top.group.position.y = bottom.count * CARD.T;
      pivot.add(bottom.group, top.group);
      deck.setCount(0);
      sfx('shuffle');
      const done = () => {
        world.remove(pivot);
        if (alive(gen)) deck.setCount(n);
      };
      await Tween.to(top.group.position, { x: 0.5, y: top.group.position.y + 0.04, z: 0.03 }, { duration: 0.1, ease: 'outQuad' });
      if (!alive(gen)) return done();
      const lift = top.count * CARD.T;
      await Promise.all([
        Tween.to(bottom.group.position, { y: lift }, { duration: 0.08, ease: 'outQuad' }),
        Tween.to(top.group.position, { y: 0 }, { duration: 0.08, ease: 'inQuad' }),
      ]);
      if (!alive(gen)) return done();
      await Tween.to(top.group.position, { x: 0, z: 0 }, { duration: 0.1, ease: 'inOutCubic' });
      if (!alive(gen)) return done();
      await Tween.run(0.05, (e) => {
        pivot.scale.set(deck.group.scale.x * (1 + Math.sin(Math.PI * e) * 0.03), deck.group.scale.y, deck.group.scale.z);
      });
      done();
    }

    // ------------------------------------------------------------------ voo genérico

    /**
     * Leva `mesh` (filho de `world`) até a pose devolvida por getTarget() (recalculada a cada
     * quadro, porque a câmera e os avatares se mexem), com arco, giro extra e troca de brilho.
     */
    function flight(mesh, getTarget, o) {
      const opts = o || {};
      if (mesh.parent !== world) world.attach(mesh);
      const p0 = mesh.position.clone();
      const q0 = mesh.quaternion.clone();
      const s0 = mesh.scale.x;
      const arc = opts.arc == null ? 0.5 : opts.arc;
      const spin = opts.spin || 0;
      const l0 = mesh.userData.light;
      const l1 = opts.light == null ? l0 : opts.light;
      const spinQ = new THREE.Quaternion();
      const rotEase = Tween.ease.inOutSine;
      return Tween.run(
        opts.duration || 0.4,
        (e, t) => {
          const tg = getTarget();
          mesh.position.lerpVectors(p0, tg.pos, e);
          mesh.position.y += arc * Math.sin(Math.PI * Math.pow(t, 0.85));
          mesh.quaternion.slerpQuaternions(q0, tg.quat, rotEase(t));
          if (spin) {
            spinQ.setFromAxisAngle(Y, spin * (1 - rotEase(t)));
            mesh.quaternion.premultiply(spinQ);
          }
          mesh.scale.setScalar(s0 + (tg.scale - s0) * e);
          if (l1 !== l0) kit.setLight(mesh, l0 + (l1 - l0) * t);
        },
        { ease: opts.ease || 'outCubic', target: mesh }
      );
    }

    // ------------------------------------------------------------------ mão do humano (presa à câmera)

    function handPose(i, n, entry, hovered) {
      const f = human.frame;
      const s = f.scale;
      const cw = CARD.W * s;
      const ch = CARD.H * s;
      const c = i - (n - 1) / 2;
      const top = -f.halfH + 2 * f.halfH * HAND.frac;
      const rest = human.interactive ? 0 : TURN.restDrop * 2 * f.halfH;
      const pose = {
        x: c * cw * HAND.spread,
        y: top - ch / 2 - c * c * ch * HAND.drop - rest,
        z: -HAND.dist + i * 0.012,
        rx: HAND.tilt,
        ry: entry && entry.showBack ? Math.PI : 0,
        rz: -c * HAND.angle,
        s,
      };
      if (hovered) {
        pose.y += ch * 0.14;
        pose.z += 0.08;
        pose.s *= 1.06;
        pose.rz *= 0.5;
      }
      if (human.faceDown && entry && isPlayable(entry) && !entry.showBack) pose.ry += 0.22;
      return pose;
    }

    function applyHandLocal(mesh, p) {
      mesh.rotation.order = 'ZYX';
      mesh.position.set(p.x, p.y, p.z);
      mesh.rotation.set(p.rx, p.ry, p.rz);
      mesh.scale.setScalar(p.s);
    }

    function handWorldPose(i, n, entry, out) {
      const p = handPose(i, n, entry, false);
      tmpV.set(p.x, p.y, p.z);
      tmpE.set(p.rx, p.ry, p.rz, 'ZYX');
      tmpQ.setFromEuler(tmpE);
      return worldPose(camera, tmpV, tmpQ, p.s, out);
    }

    function isPlayable(entry) {
      if (!human.interactive) return false;
      if (!human.playable) return true;
      if (!entry.card) return true;
      return human.playable.has(entry.card.id);
    }

    function isManilha(entry) {
      return !!(human.highlight && human.manilhaRank && entry.card && !entry.showBack && entry.card.rank === human.manilhaRank);
    }

    function layoutHuman(animate, duration) {
      const n = human.entries.length;
      const dur = duration || 0.28;
      // Teclas 1/2/3 (mesma ordem de hands[0] que o teclado do controlador usa), só com mouse e em
      // paisagem: some no toque (media query ou o último ponteiro foi um dedo) e no retrato.
      const showKeys = human.interactive && !human.touch && human.frame.aspect >= PORTRAIT_ASPECT && hoverCapable();
      human.entries.forEach((e, i) => {
        const mesh = e.mesh;
        if (!mesh || mesh.parent !== camera) return;
        const playable = isPlayable(e);
        const hovered = i === human.hover && playable;
        const p = handPose(i, n, e, hovered);
        mesh.rotation.order = 'ZYX';
        if (animate) {
          Tween.to(mesh.position, { x: p.x, y: p.y, z: p.z }, { duration: dur, ease: 'outCubic' });
          Tween.to(mesh.rotation, { x: p.rx, y: p.ry, z: p.rz }, { duration: dur, ease: 'outCubic' });
          Tween.to(mesh.scale, { x: p.s, y: p.s, z: p.s }, { duration: dur, ease: 'outCubic' });
        } else {
          applyHandLocal(mesh, p);
        }
        // Brilho: na vez, jogáveis acesas e as outras apagadas; fora da vez, todas um pouco escuras.
        e.dimTarget = human.interactive ? (playable ? 1 : TURN.lockedDim) : TURN.restDim;
        e.edgeTarget = human.interactive && playable ? 1 : 0;
        if (!animate) kit.setLight(mesh, LIGHT.hand, e.dimTarget);
        else kit.setLight(mesh, LIGHT.hand);
        if (e.edgeTarget > 0) kit.edgeOf(mesh);
        e.keyTarget = showKeys && playable ? 1 : 0;
        if (e.keyTarget > 0 || mesh.userData.key) kit.keyOf(mesh, i + 1, !!e.showBack);
        if (e.showBack) kit.conceal(mesh);
        else if (e.card) kit.reveal(mesh, e.card);
        const veilOn = human.faceDown && playable && !e.showBack;
        if (veilOn || mesh.userData.veil) {
          Tween.to(kit.veilOf(mesh).material, { opacity: veilOn ? 1 : 0 }, { duration: 0.2 });
        }
        e.manilha = isManilha(e);
        if (e.manilha || mesh.userData.glow) {
          kit.glowOf(mesh);
          kit.rimOf(mesh);
        }
      });
    }

    function newEntryMesh(entry, i, n) {
      const mesh = kit.makeCard(entry.card);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      kit.setLight(mesh, LIGHT.hand);
      if (!entry.showBack && entry.card) kit.reveal(mesh, entry.card);
      camera.add(mesh);
      const p = handPose(i, n, entry, false);
      applyHandLocal(mesh, Object.assign({}, p, { y: p.y - human.frame.halfH }));
      entry.mesh = mesh;
      return mesh;
    }

    function removeEntryMesh(entry) {
      const mesh = entry.mesh;
      if (!mesh) return;
      entry.mesh = null;
      Tween.kill(mesh.position);
      Tween.to(mesh.position, { y: mesh.position.y - human.frame.halfH }, { duration: 0.25, ease: 'inCubic' }).then(() =>
        kit.disposeCard(mesh)
      );
    }

    function setHumanHand(cards, opts) {
      const o = opts || {};
      if (state.dealing) {
        state.pendingHand = [cards, o];
        return;
      }
      human.interactive = !!o.interactive;
      human.playable = Array.isArray(o.playableIds) ? new Set(o.playableIds) : null;
      human.highlight = !!o.highlightManilhas;
      human.manilhaRank = o.manilhaRank || null;
      const list = (cards || []).map((c) => ({ card: parseCard(c), hidden: !!(c && c.hidden) || !parseCard(c) }));
      const used = new Set();
      const next = list.map((item, i) => {
        let found = null;
        if (item.card) found = human.entries.find((e) => !used.has(e) && e.card && e.card.id === item.card.id);
        if (!found && item.hidden) {
          const same = human.entries[i];
          if (same && !used.has(same) && (same.showBack || !same.card)) found = same;
          if (!found) found = human.entries.find((e) => !used.has(e) && (e.showBack || !e.card));
        }
        if (found) {
          used.add(found);
          if (item.card) found.card = item.card;
          found.showBack = item.hidden;
          return found;
        }
        return { card: item.card, mesh: null, showBack: item.hidden, isNew: true };
      });
      human.entries.forEach((e) => {
        if (!used.has(e)) removeEntryMesh(e);
      });
      human.entries = next;
      if (human.hover >= next.length) human.hover = -1;
      next.forEach((e, i) => {
        if (e.isNew) {
          delete e.isNew;
          newEntryMesh(e, i, next.length);
        }
      });
      layoutHuman(true, 0.2);
    }

    function setFaceDownMode(on) {
      human.faceDown = !!on;
      layoutHuman(true, 0.22);
    }

    /**
     * Troca a escala das cartas sobre a mesa (paisagem ↔ retrato) e reposiciona na hora o que já
     * está no tampo. Voos em andamento recalculam o alvo a cada quadro e pousam no mapa novo.
     */
    function setTableScale(scale) {
      if (!(scale > 0) || Math.abs(scale - lay.scale) < 1e-6) return;
      lay = layout(state.players, scale);
      const s = lay.scale;
      deck.group.scale.setScalar(s);
      if (!state.dealing && !Tween.isTweening(deck.group)) {
        deck.group.position.set(lay.deckHome.x, 0, lay.deckHome.z);
        deck.group.rotation.y = lay.deckHome.yaw;
      }
      const q = new THREE.Quaternion();
      state.table.forEach((p) => {
        const sl = lay.slot(p.seat, p.round);
        p.yaw = sl.yaw;
        p.y = sl.y;
        p.mesh.position.set(sl.x, sl.y, sl.z);
        p.mesh.quaternion.copy(tableQuat(sl.yaw, !p.faceDown, q));
        p.mesh.scale.setScalar(s);
        if (p.glow) {
          p.glow.position.set(sl.x, 0.0018, sl.z);
          p.glow.scale.setScalar(s);
        }
      });
      if (state.vira) {
        state.vira.position.set(lay.viraHome.x, BASE_Y + (s * CARD.T) / 2, lay.viraHome.z);
        state.vira.scale.setScalar(s);
      }
      if (turn.seat != null) {
        const t = lay.turnSpot(turn.seat);
        Tween.kill(turn.mesh.position);
        turn.mesh.position.set(t.x, 0.001, t.z);
      }
    }

    function setHandFrame(frame) {
      setTableScale(tableScaleFor(frame.aspect));
      const f = human.frame;
      f.fov = frame.fov;
      f.aspect = frame.aspect;
      f.halfH = HAND.dist * Math.tan(((frame.fov / 2) * Math.PI) / 180);
      f.halfW = f.halfH * frame.aspect;
      const sH = (2 * f.halfH * HAND.frac * HAND.card) / CARD.H;
      const sW = (2 * f.halfW * 0.94) / (CARD.W * (1 + 2 * HAND.spread) + 0.08);
      f.scale = Math.min(sH, sW);
      layoutHuman(false);
    }

    function handTopFraction() {
      const f = human.frame;
      return Math.max(HAND.frac, (CARD.H * f.scale * 1.14) / (2 * f.halfH));
    }

    function humanMeshes() {
      return human.entries.map((e) => (e.mesh && e.mesh.parent === camera ? e.mesh : null));
    }

    function pickHuman(raycaster) {
      const meshes = humanMeshes().filter(Boolean);
      if (!meshes.length) return -1;
      const hits = raycaster.intersectObjects(meshes, false);
      if (!hits.length) return -1;
      return human.entries.findIndex((e) => e.mesh === hits[0].object);
    }

    /** 'touch' | 'mouse' | 'pen': o tipo do último ponteiro (a cena avisa). */
    function setPointerKind(kind) {
      const touch = kind === 'touch';
      if (touch === human.touch) return;
      human.touch = touch;
      layoutHuman(true, 0.14);
    }

    function setHover(i) {
      const idx = i >= 0 && human.entries[i] && isPlayable(human.entries[i]) ? i : -1;
      if (idx === human.hover) return false;
      human.hover = idx;
      layoutHuman(true, 0.14);
      if (idx >= 0) sfx('hover');
      return true;
    }

    /** Clique numa carta: devolve { cardId, index } se ela pode ser jogada agora. */
    function requestPlay(i) {
      const e = human.entries[i];
      if (!e || !isPlayable(e)) return null;
      human.interactive = false;
      human.hover = -1;
      layoutHuman(true, 0.14);
      return { cardId: e.card ? e.card.id : null, index: i };
    }

    function handScreenPoints() {
      const out = [];
      human.entries.forEach((e) => {
        if (!e.mesh) return;
        e.mesh.updateWorldMatrix(true, false);
        out.push(e.mesh.getWorldPosition(new THREE.Vector3()));
      });
      return out;
    }

    // ------------------------------------------------------------------ leques dos oponentes

    function fanPose(i, n) {
      const c = i - (n - 1) / 2;
      const a = -c * 0.2;
      const r = CARD.H * 0.42;
      return { x: -Math.sin(a) * r + c * 0.03, y: Math.cos(a) * r, z: i * 0.005, rz: a };
    }

    function fanWorldPose(fan, i, n, out) {
      const p = fanPose(i, n);
      tmpV.set(p.x, p.y, p.z);
      tmpQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), p.rz);
      return worldPose(fan.group, tmpV, tmpQ, 1, out);
    }

    function layoutFan(seat, animate) {
      const fan = state.fans[seat];
      if (!fan) return;
      const n = fan.cards.length;
      fan.cards.forEach((fc, i) => {
        const p = fanPose(i, n);
        if (fc.mesh.parent !== fan.group) return;
        if (animate) {
          Tween.to(fc.mesh.position, { x: p.x, y: p.y, z: p.z }, { duration: 0.25 });
          Tween.to(fc.mesh.rotation, { x: 0, y: 0, z: p.rz }, { duration: 0.25 });
        } else {
          fc.mesh.position.set(p.x, p.y, p.z);
          fc.mesh.rotation.set(0, 0, p.rz);
        }
      });
    }

    function setSeats(players, anchors) {
      resetImmediate();
      Object.keys(state.fans).forEach((s) => {
        const fan = state.fans[s];
        if (fan.group.parent) fan.group.parent.remove(fan.group);
      });
      state.fans = {};
      lay = layout(players, lay.scale);
      state.players = lay.players;
      for (let s = 1; s < state.players; s++) {
        const anchor = anchors && anchors[s];
        if (!anchor) continue;
        const group = new THREE.Group();
        group.name = 'fan-' + s;
        anchor.add(group);
        state.fans[s] = { group, cards: [], shown: false };
      }
      deck.group.position.set(lay.deckHome.x, 0, lay.deckHome.z);
      deck.group.rotation.y = lay.deckHome.yaw;
      caps.relayout();
      turn.seat = null;
      turn.mesh.material.opacity = 0;
    }

    // ------------------------------------------------------------------ distribuição

    async function dealOne(seat, k, hands, blind, dur, gen) {
      if (!alive(gen)) return;
      deck.setCount(deck.count - 1);
      const mesh = kit.makeCard(null);
      kit.setLight(mesh, LIGHT.table);
      const start = deckTopPose();
      mesh.position.copy(start.pos);
      mesh.quaternion.copy(start.quat);
      mesh.scale.setScalar(start.scale);
      world.add(mesh);
      sfx('deal');
      if (seat === 0) {
        const entry = human.entries[k];
        if (!entry) {
          kit.disposeCard(mesh);
          return;
        }
        mesh.castShadow = false;
        if (!entry.showBack && entry.card) kit.reveal(mesh, entry.card);
        const target = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1 };
        await flight(mesh, () => handWorldPose(k, 3, entry, target), { duration: dur + 0.08, arc: 0.35, light: LIGHT.hand });
        if (!alive(gen) || human.entries.indexOf(entry) < 0) return kit.disposeCard(mesh);
        camera.add(mesh);
        applyHandLocal(mesh, handPose(k, 3, entry, false));
        entry.mesh = mesh;
        if (!entry.showBack) sfx('flip');
      } else {
        const fan = state.fans[seat];
        if (!fan) {
          await flight(mesh, () => deckTopPose(), { duration: 0.01 });
          kit.disposeCard(mesh);
          return;
        }
        const card = parseCard((hands[seat] || [])[k]);
        const target = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1 };
        await flight(mesh, () => fanWorldPose(fan, k, 3, target), {
          duration: dur,
          arc: 0.55,
          spin: (hash01('d' + seat + k) - 0.5) * 1.2,
          light: LIGHT.fan,
        });
        if (!alive(gen)) return kit.disposeCard(mesh);
        fan.group.add(mesh);
        const p = fanPose(k, 3);
        mesh.position.set(p.x, p.y, p.z);
        mesh.rotation.set(0, 0, p.rz);
        fan.cards[k] = { mesh, card };
      }
    }

    async function revealVira(card) {
      const gen = state.gen;
      const c = parseCard(card);
      if (!c) return;
      deck.setCount(deck.count - 1);
      const mesh = kit.makeCard(c);
      kit.setLight(mesh, LIGHT.table);
      kit.reveal(mesh, c);
      const start = deckTopPose();
      mesh.position.copy(start.pos);
      mesh.quaternion.copy(start.quat);
      mesh.scale.setScalar(start.scale);
      world.add(mesh);
      const target = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1 };
      // Alvo recalculado a cada quadro: a escala de mesa pode mudar no meio (girar o celular).
      const viraOut = () => {
        const vh = lay.viraHome;
        target.pos.set(vh.x + 0.62 * ts(), BASE_Y + (ts() * CARD.T) / 2, vh.z);
        tableQuat(vh.yaw, true, target.quat);
        target.scale = ts();
        return target;
      };
      await flight(mesh, viraOut, { duration: 0.42, arc: 0.5, ease: 'inOutCubic' });
      if (!alive(gen)) return kit.disposeCard(mesh);
      sfx('flip');
      deck.base = BASE_Y + CARD.T + 0.0015;
      deck.setCount(deck.count);
      const slide = { v: 0 };
      await Tween.to(slide, { v: 1 }, {
        duration: 0.2,
        ease: 'outCubic',
        onUpdate: () => {
          const vh = lay.viraHome;
          mesh.position.set(vh.x + 0.62 * ts() * (1 - slide.v), BASE_Y + (ts() * CARD.T) / 2, vh.z);
          mesh.scale.setScalar(ts());
        },
      });
      if (!alive(gen)) return kit.disposeCard(mesh);
      state.vira = mesh;
    }

    function hasTableStuff() {
      return (
        state.table.length > 0 ||
        !!state.vira ||
        human.entries.some((e) => e.mesh) ||
        Object.keys(state.fans).some((s) => state.fans[s].cards.length > 0)
      );
    }

    async function dealHand(o) {
      const opts = o || {};
      if (hasTableStuff()) await clearTable();
      const gen = state.gen;
      if (state.disposed) return;
      const players = state.players;
      const hands = opts.hands || [];
      const blind = !!opts.blind;
      const dealer = Number.isInteger(opts.dealer) && opts.dealer >= 0 && opts.dealer < players ? opts.dealer : players - 1;
      state.dealing = true;
      state.pendingHand = null;
      try {
        state.deckSize = opts.deckSize === 40 ? 40 : opts.deckSize > 0 ? opts.deckSize : 24;
        deck.base = BASE_Y;
        deck.setCount(state.deckSize);
        human.entries = (hands[0] || []).slice(0, 3).map((c) => ({ card: parseCard(c), mesh: null, showBack: blind || !parseCard(c) }));
        human.interactive = false;
        human.hover = -1;
        const mao = (dealer + 1) % players;
        await moveDeck(lay.dealerSpot(dealer), 0.3);
        if (!alive(gen)) return;
        const dealerAvatar = avatarOf(dealer);
        if (dealerAvatar) dealerAvatar.act('deal');
        // quickShuffle: corte curto no lugar do riffle completo (o controlador pede isso a partir da
        // 2ª mão de cada jogo).
        if (opts.quickShuffle) await cut();
        else await shuffle();
        if (!alive(gen)) return;
        const order = [];
        for (let k = 0; k < 3; k++) for (let j = 0; j < players; j++) order.push({ seat: (mao + j) % players, k });
        const stagger = 0.08;
        await Promise.all(order.map((it, i) => Tween.delay(i * stagger).then(() => dealOne(it.seat, it.k, hands, blind, 0.34, gen))));
        if (!alive(gen)) return;
        await moveDeck(lay.deckHome, 0.3);
        if (!alive(gen)) return;
        if (opts.vira) await revealVira(opts.vira);
        if (!alive(gen)) return;
      } finally {
        if (gen === state.gen) state.dealing = false;
      }
      layoutHuman(true);
      if (state.pendingHand) {
        const [cards, ho] = state.pendingHand;
        state.pendingHand = null;
        setHumanHand(cards, ho);
      }
    }

    // ------------------------------------------------------------------ jogar, marcar, recolher

    function takeFromHuman(card, handIndex) {
      const list = human.entries;
      let idx = -1;
      if (Number.isInteger(handIndex) && list[handIndex]) idx = handIndex;
      if (idx < 0 && card) idx = list.findIndex((e) => e.card && e.card.id === card.id);
      if (idx < 0) idx = list.findIndex((e) => e.showBack || !e.card);
      if (idx < 0 && list.length) idx = 0;
      let mesh = null;
      if (idx >= 0) {
        const entry = list.splice(idx, 1)[0];
        mesh = entry.mesh;
        if (human.hover === idx) human.hover = -1;
        else if (human.hover > idx) human.hover--;
      }
      if (mesh) {
        Tween.kill(mesh.position);
        Tween.kill(mesh.rotation);
        Tween.kill(mesh.scale);
        for (const k of ['glow', 'veil', 'rim', 'edge', 'key']) {
          const fx = mesh.userData[k];
          if (fx) Tween.to(fx.material, { opacity: 0 }, { duration: 0.15 });
        }
        kit.setLight(mesh, null, 1);
        world.attach(mesh);
      } else {
        mesh = kit.makeCard(null);
        kit.setLight(mesh, LIGHT.hand);
        const p = handPose(1, 3, null, false);
        const wp = worldPose(camera, new THREE.Vector3(p.x, p.y - human.frame.halfH * 0.5, p.z), new THREE.Quaternion(), p.s);
        mesh.position.copy(wp.pos);
        mesh.quaternion.copy(wp.quat);
        mesh.scale.setScalar(wp.scale);
        world.add(mesh);
      }
      layoutHuman(true);
      return mesh;
    }

    function takeFromFan(seat, handIndex) {
      const fan = state.fans[seat];
      let mesh = null;
      if (fan && fan.cards.length) {
        let idx = Number.isInteger(handIndex) && fan.cards[handIndex] ? handIndex : -1;
        if (idx < 0) idx = Math.floor(hash01('pick' + seat + fan.cards.length) * fan.cards.length);
        mesh = fan.cards.splice(idx, 1)[0].mesh;
        world.attach(mesh);
        layoutFan(seat, true);
      }
      if (!mesh) {
        mesh = kit.makeCard(null);
        const a = avatarOf(seat);
        const src = a && a.cardAnchor ? worldPose(a.cardAnchor, new THREE.Vector3(0, CARD.H * 0.4, 0), new THREE.Quaternion(), 1) : deckTopPose();
        mesh.position.copy(src.pos);
        mesh.quaternion.copy(src.quat);
        world.add(mesh);
      }
      return mesh;
    }

    async function playCard(seat, card, o) {
      const gen = state.gen;
      const opts = o || {};
      const c = parseCard(card);
      const faceDown = !!opts.faceDown;
      const round = Number.isInteger(opts.roundIndex)
        ? Math.max(0, Math.min(2, opts.roundIndex))
        : Math.min(2, state.table.filter((p) => p.seat === seat).length);
      let mesh;
      if (seat === 0) mesh = takeFromHuman(c, opts.handIndex);
      else {
        mesh = takeFromFan(seat, opts.handIndex);
        const a = avatarOf(seat);
        if (a) a.act('play');
      }
      if (!faceDown && c) kit.reveal(mesh, c);
      else if (seat !== 0) kit.conceal(mesh);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const target = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1 };
      const slotTarget = () => {
        const sl = lay.slot(seat, round);
        target.pos.set(sl.x, sl.y, sl.z);
        tableQuat(sl.yaw, !faceDown, target.quat);
        target.scale = ts();
        return target;
      };
      const spin = (hash01('spin' + seat + round + (c ? c.id : '')) - 0.5) * 1.6;
      await flight(mesh, slotTarget, {
        duration: seat === 0 ? 0.42 : 0.48,
        arc: seat === 0 ? 0.45 : 0.7,
        spin,
        light: LIGHT.table,
        ease: 'inOutCubic',
      });
      if (!alive(gen)) return kit.disposeCard(mesh);
      sfx('place');
      const sl = lay.slot(seat, round);
      const entry = { mesh, seat, round, faceDown, card: c, glow: null, yaw: sl.yaw, y: sl.y };
      state.table.push(entry);
      await Tween.run(0.12, (e) => {
        const k = Math.sin(Math.PI * e);
        const s = ts();
        mesh.scale.set(s * (1 + k * 0.05), s * (1 + k * 0.05), s * (1 - k * 0.3));
        mesh.position.y = entry.y + k * 0.004;
      }, { target: mesh });
      mesh.scale.setScalar(ts());
      mesh.position.y = entry.y;
    }

    async function markRoundWinner(round, winnerSeat) {
      const plays = state.table.filter((p) => p.round === round);
      if (!plays.length) return;
      if (winnerSeat == null) {
        await Promise.all(
          plays.map((p, i) => {
            const q = new THREE.Quaternion();
            return Tween.run(
              0.55,
              (e, t) => {
                const off = Math.sin(t * Math.PI * 7 + i) * 0.09 * (1 - t);
                tableQuat(p.yaw + off, !p.faceDown, q);
                p.mesh.quaternion.copy(q);
                p.mesh.position.y = p.y + Math.abs(Math.sin(t * Math.PI * 3)) * 0.03 * (1 - t);
              },
              { ease: 'linear', target: p.mesh }
            ).then(() => {
              p.mesh.quaternion.copy(tableQuat(p.yaw, !p.faceDown, q));
              p.mesh.position.y = p.y;
            });
          })
        );
        return;
      }
      let win = null;
      for (const p of plays) if (p.seat === winnerSeat) win = p;
      if (!win) return;
      for (const p of plays) {
        if (p === win) continue;
        const d = { v: p.mesh.userData.dim };
        Tween.to(d, { v: 0.62 }, { duration: 0.35, onUpdate: () => kit.setLight(p.mesh, null, d.v) });
      }
      const glow = kit.tableGlow();
      glow.position.set(win.mesh.position.x, 0.0018, win.mesh.position.z);
      glow.scale.setScalar(ts());
      glow.rotation.z = win.yaw;
      world.add(glow);
      win.glow = glow;
      const mesh = win.mesh;
      const lift = Tween.run(
        0.62,
        (e, t) => {
          const k = t < 0.35 ? Tween.ease.outCubic(t / 0.35) : 1 - Tween.ease.inOutCubic((t - 0.35) / 0.65);
          mesh.position.y = win.y + k * 0.22;
          mesh.scale.setScalar(ts() * (1 + k * 0.08));
        },
        { ease: 'linear', target: mesh }
      ).then(() => {
        mesh.position.y = win.y;
        mesh.scale.setScalar(ts());
      });
      const shine = Tween.to(glow.material, { opacity: 1 }, { duration: 0.25 }).then(() =>
        Tween.to(glow.material, { opacity: 0.55 }, { duration: 0.4 })
      );
      await Promise.all([lift, shine]);
    }

    async function clearTable() {
      const gen = state.gen;
      const items = [];
      for (const p of state.table) {
        items.push(p.mesh);
        if (p.glow) {
          const g = p.glow;
          Tween.to(g.material, { opacity: 0 }, { duration: 0.2 }).then(() => {
            if (g.parent) g.parent.remove(g);
            g.material.dispose();
          });
        }
      }
      state.table = [];
      Object.keys(state.fans).forEach((s) => {
        const fan = state.fans[s];
        fan.cards.forEach((fc) => items.push(fc.mesh));
        fan.cards = [];
      });
      human.entries.forEach((e) => {
        if (e.mesh) items.push(e.mesh);
      });
      human.entries = [];
      human.hover = -1;
      human.interactive = false;
      setTurn(null);
      const vira = state.vira;
      state.vira = null;
      let viraOut = Promise.resolve();
      if (vira) {
        viraOut = Tween.to(vira.position, { x: vira.position.x + 0.62 * ts() }, { duration: 0.18 }).then(() => {
          deck.base = BASE_Y;
          deck.setCount(deck.count);
        });
        items.push(vira);
      }
      items.forEach((m) => {
        Tween.kill(m);
        Tween.kill(m.position);
        Tween.kill(m.rotation);
        Tween.kill(m.scale);
        if (m.parent !== world) world.attach(m);
        m.castShadow = true;
      });
      if (!items.length) return;
      sfx('slide');
      await viraOut;
      const target = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1 };
      await Promise.all(
        items.map((m, i) =>
          Tween.delay(i * 0.03).then(() =>
            flight(m, () => deckTopPose(target), {
              duration: 0.36,
              arc: 0.3,
              spin: (hash01('c' + i) - 0.5) * 1.2,
              light: LIGHT.deck,
              ease: 'inOutCubic',
            }).then(() => {
              kit.disposeCard(m);
              if (alive(gen)) deck.setCount(deck.count + 1);
            })
          )
        )
      );
      if (!alive(gen)) return;
      deck.base = BASE_Y;
      deck.setCount(state.deckSize);
    }

    // ------------------------------------------------------------------ mão de onze: cartas do parceiro

    async function showPartnerHand(cards) {
      const fan = state.fans[2];
      if (state.players !== 4 || !fan) return;
      const anchor = fan.group.parent;
      if (cards && cards.length) {
        cards.forEach((c, i) => {
          let fc = fan.cards[i];
          if (!fc) {
            const mesh = kit.makeCard(null);
            kit.setLight(mesh, LIGHT.fan);
            fan.group.add(mesh);
            fc = fan.cards[i] = { mesh, card: parseCard(c) };
          }
          fc.card = parseCard(c) || fc.card;
          if (fc.card) kit.reveal(fc.mesh, fc.card);
          kit.setLight(fc.mesh, LIGHT.hand * 0.8);
        });
        layoutFan(2, false);
        // Pose de "mostrar": faces viradas para a câmera, maiores, ao lado da cabeça da parceira
        // (à direita na tela, na altura do rosto) para não cobri-lo.
        anchor.updateWorldMatrix(true, false);
        camera.updateMatrixWorld(true);
        const anchorQ = anchor.getWorldQuaternion(new THREE.Quaternion());
        const anchorP = anchor.getWorldPosition(new THREE.Vector3());
        const camP = camera.getWorldPosition(new THREE.Vector3());
        const partner = avatarOf(2);
        const headP =
          partner && partner.headWorldPos ? partner.headWorldPos(new THREE.Vector3()) : anchorP.clone().add(new THREE.Vector3(0, 2.1, 0));
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0);
        if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
        right.normalize();
        const showP = headP.clone().addScaledVector(right, PARTNER_SHOW.side).add(new THREE.Vector3(0, PARTNER_SHOW.up, PARTNER_SHOW.front));
        const look = new THREE.Matrix4().lookAt(camP, showP, Y);
        const worldQ = new THREE.Quaternion().setFromRotationMatrix(look);
        const localQ = anchorQ.clone().invert().multiply(worldQ);
        const localP = anchor.worldToLocal(showP.clone());
        fan.shown = true;
        const q0 = fan.group.quaternion.clone();
        const p0 = fan.group.position.clone();
        const s0 = fan.group.scale.x;
        await Tween.run(
          0.55,
          (e) => {
            fan.group.quaternion.slerpQuaternions(q0, localQ, e);
            fan.group.position.lerpVectors(p0, localP, e);
            fan.group.scale.setScalar(s0 + (PARTNER_SHOW.scale - s0) * e);
          },
          { ease: 'inOutCubic', target: fan.group }
        );
        sfx('flip');
      } else if (fan.shown) {
        fan.shown = false;
        const q0 = fan.group.quaternion.clone();
        const p0 = fan.group.position.clone();
        const s0 = fan.group.scale.x;
        const qI = new THREE.Quaternion();
        const pI = new THREE.Vector3();
        await Tween.run(
          0.45,
          (e) => {
            fan.group.quaternion.slerpQuaternions(q0, qI, e);
            fan.group.position.lerpVectors(p0, pI, e);
            fan.group.scale.setScalar(s0 + (1 - s0) * e);
          },
          { ease: 'inOutCubic', target: fan.group }
        );
        fan.cards.forEach((fc) => {
          kit.conceal(fc.mesh);
          kit.setLight(fc.mesh, LIGHT.fan);
        });
      }
    }

    // ------------------------------------------------------------------ indicação de vez

    const turn = (() => {
      const tex = srgbTexture(THREE, radialCanvas('rgba(255, 222, 160, 0.85)', 'rgba(255, 190, 110, 0.25)'));
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.1), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.001;
      mesh.renderOrder = 0;
      world.add(mesh);
      return { mesh, tex, seat: null, level: 0 };
    })();

    function setTurn(seat) {
      const valid = seat != null && seat >= 0 && seat < state.players;
      turn.seat = valid ? seat : null;
      if (!valid) {
        Tween.to(turn, { level: 0 }, { duration: 0.3 });
        return;
      }
      const s = lay.turnSpot(seat);
      if (turn.level < 0.05) turn.mesh.position.set(s.x, 0.001, s.z);
      Tween.to(turn.mesh.position, { x: s.x, z: s.z }, { duration: 0.35, ease: 'inOutCubic' });
      Tween.to(turn, { level: 1 }, { duration: 0.3 });
    }

    // ------------------------------------------------------------------ tampinhas (placar)

    const caps = (() => {
      const low = ctx.quality === 'low';
      // Tampinha coroa: disco com saia serrilhada (21 dentes), deitada com o logo para cima.
      const profile = [
        [0.0, 0.066],
        [0.098, 0.066],
        [0.116, 0.061],
        [0.127, 0.051],
        [0.131, 0.04],
        [0.137, 0.004],
        [0.13, 0.0],
      ].map(([r, y]) => new THREE.Vector2(r, y));
      const capGeo = new THREE.LatheGeometry(profile, low ? 42 : 63);
      const cp = capGeo.attributes.position;
      for (let i = 0; i < cp.count; i++) {
        const y = cp.getY(i);
        if (y > 0.045) continue;
        const x = cp.getX(i);
        const z = cp.getZ(i);
        const a = Math.atan2(z, x);
        const k = 1 + 0.07 * Math.max(0, Math.cos(a * 21)) * (1 - y / 0.045);
        cp.setX(i, x * k);
        cp.setZ(i, z * k);
      }
      capGeo.computeVertexNormals();
      const faceGeo = new THREE.CircleGeometry(0.1, 28);
      faceGeo.rotateX(-Math.PI / 2);
      faceGeo.translate(0, 0.0665, 0);
      const metals = [
        new THREE.MeshStandardMaterial({ color: 0xd8b56a, roughness: 0.28, metalness: 0.9, envMapIntensity: 1.2 }),
        new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.25, metalness: 0.9, envMapIntensity: 1.2 }),
      ];
      const logos = [
        ['#F2C230', '#B3261E', '#FFFFFF'],
        ['#B3261E', '#F2C230', '#FFFFFF'],
        ['#1F3A6B', '#C9CED6', '#F2C230'],
      ].map(([bg, ring, ink]) => {
        const lc = capLogoCanvas(bg, ring, ink);
        const tex = srgbTexture(THREE, lc.canvas);
        whenFonts(
          '400 70px Shrikhand',
          () => {
            lc.draw();
            tex.needsUpdate = true;
          },
          () => !state.disposed
        );
        return {
          tex,
          mat: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.35, envMapIntensity: 0.9 }),
        };
      });
      const REST_Y = 0.0005;

      function makeCap(seed) {
        const g = new THREE.Group();
        const skirt = new THREE.Mesh(capGeo, metals[Math.floor(hash01('cm' + seed) * metals.length)]);
        const face = new THREE.Mesh(faceGeo, logos[Math.floor(hash01('cl' + seed) * logos.length)].mat);
        skirt.castShadow = true;
        skirt.receiveShadow = true;
        face.receiveShadow = true;
        g.add(skirt, face);
        return g;
      }

      // Copo americano (vidro facetado) com tampinhas dentro, sobre um guardanapo com o nome do time.
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xf4f7f5,
        roughness: 0.05,
        metalness: 0,
        transparent: true,
        opacity: 0.3,
        envMapIntensity: 1.8,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        side: THREE.DoubleSide,
        depthWrite: false,
        flatShading: true,
      });
      const glassBody = new THREE.CylinderGeometry(0.35, 0.28, 0.72, 18, 1, true);
      glassBody.translate(0, 0.44, 0);
      const glassBand = new THREE.CylinderGeometry(0.37, 0.355, 0.16, 28, 1, true);
      glassBand.translate(0, 0.88, 0);
      const glassBase = new THREE.CylinderGeometry(0.28, 0.27, 0.08, 18);
      glassBase.translate(0, 0.04, 0);
      const napkinGeo = new THREE.PlaneGeometry(1.15, 1.15);
      napkinGeo.rotateX(-Math.PI / 2);

      const teams = [0, 1].map((team) => {
        const group = new THREE.Group();
        const body = new THREE.Mesh(glassBody, glassMat);
        const band = new THREE.Mesh(glassBand, glassMat);
        const base = new THREE.Mesh(glassBase, glassMat);
        body.renderOrder = band.renderOrder = base.renderOrder = 4;
        base.castShadow = true;
        group.add(body, band, base);
        for (let i = 0; i < 11; i++) {
          const c = makeCap(team * 100 + i);
          const a = hash01('ga' + team + i) * Math.PI * 2;
          const r = Math.sqrt(hash01('gr' + team + i)) * 0.16;
          c.position.set(Math.cos(a) * r, 0.09 + i * 0.045, Math.sin(a) * r);
          c.rotation.set((hash01('gx' + i) - 0.5) * 1.4, a * 3, (hash01('gz' + i) - 0.5) * 1.4);
          group.add(c);
        }
        const nc = napkinCanvas(team === 0 ? 'NÓS' : 'ELES', team);
        const ntex = srgbTexture(THREE, nc.canvas);
        whenFonts(
          NAPKIN_FONT,
          () => {
            nc.draw();
            ntex.needsUpdate = true;
          },
          () => !state.disposed
        );
        const napkin = new THREE.Mesh(
          napkinGeo,
          new THREE.MeshStandardMaterial({ map: ntex, roughness: 0.95, metalness: 0, transparent: true, alphaTest: 0.1 })
        );
        napkin.receiveShadow = true;
        world.add(group, napkin);
        return { team, group, napkin, ntex, row: [], count: 0 };
      });

      function relayout() {
        teams.forEach((t) => {
          const h = lay.holder(t.team);
          t.group.position.set(h.x, 0, h.z);
          const n = lay.napkin(t.team);
          t.napkin.position.set(n.x, 0.0015, n.z);
          t.napkin.rotation.set(0, n.yaw, 0);
          t.row.forEach((m, i) => placeRow(m, t.team, i));
        });
      }

      function placeRow(m, team, i) {
        const r = lay.capRow(team, i);
        m.position.set(r.x, REST_Y, r.z);
        m.rotation.set(0, r.yaw, 0);
      }

      function holderTop(team) {
        const h = lay.holder(team);
        return new THREE.Vector3(h.x, 1.02, h.z);
      }

      async function animateTeam(t, target) {
        const jobs = [];
        let delay = 0;
        while (t.row.length < target) {
          const i = t.row.length;
          const m = makeCap(t.team * 1000 + i);
          const from = holderTop(t.team);
          m.position.copy(from);
          m.visible = false;
          world.add(m);
          t.row.push(m);
          const r = lay.capRow(t.team, i);
          const to = new THREE.Vector3(r.x, REST_Y, r.z);
          const flipX = Math.PI * 2 * (hash01('fx' + t.team + i) < 0.5 ? 1 : -1);
          jobs.push(
            Tween.delay(delay).then(() => {
              m.visible = true;
              return Tween.run(
                0.46,
                (e, raw) => {
                  m.position.lerpVectors(from, to, e);
                  m.position.y += Math.sin(Math.PI * raw) * 0.5;
                  m.rotation.set(flipX * (1 - e), r.yaw + (1 - e) * 2, 0);
                },
                { ease: 'linear', target: m }
              ).then(() => {
                sfx('bean');
                return Tween.run(
                  0.14,
                  (e, raw) => {
                    m.position.y = REST_Y + Math.sin(Math.PI * raw) * 0.025;
                    m.rotation.z = Math.sin(Math.PI * raw * 2) * 0.05;
                  },
                  { target: m }
                ).then(() => {
                  m.position.y = REST_Y;
                  m.rotation.z = 0;
                });
              });
            })
          );
          delay += 0.13;
        }
        while (t.row.length > target) {
          const m = t.row.pop();
          const from = m.position.clone();
          const to = holderTop(t.team);
          jobs.push(
            Tween.delay(delay).then(() =>
              Tween.run(
                0.36,
                (e, raw) => {
                  m.position.lerpVectors(from, to, e);
                  m.position.y += Math.sin(Math.PI * raw) * 0.4;
                },
                { target: m }
              ).then(() => world.remove(m))
            )
          );
          delay += 0.07;
        }
        await Promise.all(jobs);
        t.count = target;
      }

      function setScore(score, opts) {
        const animate = !opts || opts.animate !== false;
        const vals = [0, 1].map((i) => Math.max(0, Math.min(12, Math.floor(Number((score || [])[i]) || 0))));
        if (!animate) {
          teams.forEach((t, i) => {
            t.row.forEach((m) => {
              Tween.kill(m);
              world.remove(m);
            });
            t.row = [];
            for (let k = 0; k < vals[i]; k++) {
              const m = makeCap(t.team * 1000 + k);
              placeRow(m, t.team, k);
              world.add(m);
              t.row.push(m);
            }
            t.count = vals[i];
          });
          return Promise.resolve();
        }
        return Promise.all(teams.map((t, i) => animateTeam(t, vals[i]))).then(() => undefined);
      }

      relayout();

      return {
        setScore,
        relayout,
        dispose() {
          teams.forEach((t) => {
            world.remove(t.group, t.napkin);
            t.napkin.material.dispose();
            t.ntex.dispose();
            t.row.forEach((m) => world.remove(m));
          });
          [capGeo, faceGeo, glassBody, glassBand, glassBase, napkinGeo, glassMat].forEach((d) => d.dispose());
          metals.forEach((m) => m.dispose());
          logos.forEach((l) => {
            l.tex.dispose();
            l.mat.dispose();
          });
        },
      };
    })();

    // ------------------------------------------------------------------ ciclo de vida

    function resetImmediate() {
      state.gen++;
      state.dealing = false;
      state.pendingHand = null;
      const all = [];
      state.table.forEach((p) => {
        all.push(p.mesh);
        if (p.glow) {
          world.remove(p.glow);
          p.glow.material.dispose();
        }
      });
      state.table = [];
      if (state.vira) all.push(state.vira);
      state.vira = null;
      Object.keys(state.fans).forEach((s) => {
        const fan = state.fans[s];
        fan.cards.forEach((fc) => all.push(fc.mesh));
        fan.cards = [];
        Tween.kill(fan.group);
        fan.group.position.set(0, 0, 0);
        fan.group.quaternion.identity();
        fan.group.scale.setScalar(1);
        fan.shown = false;
      });
      human.entries.forEach((e) => {
        if (e.mesh) all.push(e.mesh);
      });
      human.entries = [];
      human.hover = -1;
      human.interactive = false;
      human.faceDown = false;
      all.forEach((m) => kit.disposeCard(m));
      Tween.kill(deck.group);
      deck.base = BASE_Y;
      deck.setCount(state.deckSize);
    }

    function update(dt, t) {
      turn.mesh.material.opacity = turn.level * (0.22 + Math.sin(t * 2.6) * 0.06);
      const pulse = 0.62 + Math.sin(t * 3.1) * 0.2;
      // Vez do humano: transição curta (~0,2 s) do brilho e do contorno dourado, que pulsa de leve.
      const kTurn = 1 - Math.exp(-dt * 14);
      const edgeLevel = TURN.glow + (Tween.prefersReducedMotion() ? 0 : Math.sin(t * 2.4) * TURN.pulse);
      human.entries.forEach((e) => {
        const u = e.mesh && e.mesh.userData;
        if (!u || e.mesh.parent !== camera) return;
        if (e.dimTarget != null && Math.abs(u.dim - e.dimTarget) > 0.002) {
          kit.setLight(e.mesh, null, Math.abs(u.dim - e.dimTarget) < 0.01 ? e.dimTarget : u.dim + (e.dimTarget - u.dim) * kTurn);
        }
        if (u.edge) u.edge.material.opacity += ((e.edgeTarget ? edgeLevel : 0) - u.edge.material.opacity) * kTurn;
        if (u.key) u.key.material.opacity += ((e.keyTarget ? 0.95 : 0) - u.key.material.opacity) * kTurn;
      });
      human.entries.forEach((e) => {
        const u = e.mesh && e.mesh.userData;
        if (!u || !u.glow) return;
        const k = Math.min(1, dt * 8);
        const targetOp = e.manilha ? pulse : 0;
        u.glow.material.opacity += (targetOp - u.glow.material.opacity) * k;
        if (u.rim) u.rim.material.opacity += ((e.manilha ? 0.75 + (pulse - 0.62) * 0.8 : 0) - u.rim.material.opacity) * k;
      });
    }

    function dispose() {
      state.disposed = true;
      resetImmediate();
      caps.dispose();
      deck.dispose();
      world.remove(turn.mesh);
      turn.mesh.geometry.dispose();
      turn.mesh.material.dispose();
      turn.tex.dispose();
      ctx.scene.remove(world);
      kit.dispose();
    }

    return {
      CARD,
      layout: () => lay,
      setSeats,
      dealHand,
      playCard,
      markRoundWinner,
      clearTable,
      setHumanHand,
      setFaceDownMode,
      showPartnerHand,
      setScore: caps.setScore,
      setTurn,
      setHandFrame,
      setTableScale,
      tableScale: () => lay.scale,
      handTopFraction,
      pickHuman,
      setHover,
      setPointerKind,
      requestPlay,
      handScreenPoints,
      isInteractive: () => human.interactive,
      slotWorld(seat, round) {
        const s = lay.slot(seat, round || 0);
        return new THREE.Vector3(s.x, s.y, s.z);
      },
      keepOut: () => lay.keepOut(),
      resetImmediate,
      update,
      dispose,
    };
  }

  const Cards3D = { CARD, TABLE_SCALE: TS, TABLE_SCALE_PORTRAIT: TS_PORTRAIT, PORTRAIT_ASPECT, tableScaleFor, create, layout, parseCard };
  Truco.Cards3D = Cards3D;
  if (typeof module === 'object' && module.exports) module.exports = Cards3D;
})(typeof window !== 'undefined' ? window : globalThis);
