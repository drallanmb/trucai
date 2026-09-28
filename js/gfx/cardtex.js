/*
 * TrucAÍ — texturas das cartas (Truco.CardTex).
 *
 * Todas as 40 faces (4 5 6 7 Q J K A 2 3 × 4 naipes) e o verso são desenhados
 * por código em canvas 2D, no estilo do baralho brasileiro tradicional:
 * papel creme, índices grandes, pips vetoriais, figuras espelhadas e Ás de
 * espadas ornamentado. Nada de imagens externas.
 *
 * Easter eggs (pedidos do usuário; índices, naipes, cores e contagem de pips
 * continuam os de sempre, então nada muda o valor da carta):
 *   - Dama de Copas (Qh): dama de chanel preto com franja reta e brilhos, tiara branca com
 *     coroinha dourada, fone de ouvido pequeno, olhos grandes de anime e gola alta com plaquinha
 *     de copas, inspirada na garota de mangá da logo da Nous Research (Hermes Agent); segura o
 *     caduceu. Tudo vetorial, no traço das outras figuras (drawBob*).
 *   - Todos os 2 (2c 2h 2s 2d): duas bananinhas sorridentes entre os dois pips (alusão ao
 *     Nano Banana 2), inclinadas em sentidos opostos, com inclinação diferente por naipe. Os dois pips ficam no lugar.
 *   - Ás de Espadas (As): o Clawd (mascote do Claude Code) em pixel-art 8-bit, abraçado no
 *     coração da grande espada, no lugar da flor-de-lis (desenhado com fillRect em grade), e a
 *     fita embaixo diz "CLAUDE CODE".
 *
 * API (docs/ARCHITECTURE.md §5):
 *   CardTex.ready()                 -> Promise (espera as fontes, pré-gera tudo)
 *   CardTex.face(cardOrId)          -> THREE.Texture (cache por id)
 *   CardTex.back()                  -> THREE.Texture
 *   CardTex.faceCanvas(cardOrId, { width }?) -> HTMLCanvasElement (cópia nova)
 *   CardTex.setRenderer(renderer)   -> usa a anisotropia máxima do renderer
 * Extras: CardTex.backCanvas({ width }?), CardTex.WIDTH, CardTex.HEIGHT,
 *   CardTex.setQuality('high'|'low') -> 'low' pinta em 320×448 (as mesmas texturas são recriadas).
 *
 * Memória: ready() pré-gera só o baralho limpo (Q J K A 2 3) e o verso; as faces do sujo (4 5 6 7)
 * são pintadas na primeira vez que alguém pede. Fontes: um desenho feito antes de a família estar
 * declarada E carregada fica marcado e é repintado quando ela chegar (evento 'loadingdone').
 */
(function (root) {
  'use strict';
  const Truco = (root.Truco = root.Truco || {});

  // ---------------------------------------------------------------------------
  // Constantes
  // ---------------------------------------------------------------------------

  const W = 512;
  const H = 716; // 63:88 (unidades de desenho; o canvas pode ser menor na qualidade leve)
  const SIZES = { high: [512, 716], low: [320, 448] };
  const PREGEN_RANKS = ['Q', 'J', 'K', 'A', '2', '3']; // baralho limpo (padrão)
  const CORNER_R = Math.round(W * 0.06);
  const TAU = Math.PI * 2;

  const RANKS = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
  const SUITS = ['clubs', 'hearts', 'spades', 'diamonds'];
  const SUIT_BY_LETTER = { c: 'clubs', h: 'hearts', s: 'spades', d: 'diamonds' };
  const LETTER_BY_SUIT = { clubs: 'c', hearts: 'h', spades: 's', diamonds: 'd' };
  const RED_SUITS = { hearts: true, diamonds: true };

  const INDEX_FAMILY = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  const DISPLAY_FAMILY = 'Shrikhand, "Cooper Black", Georgia, serif';
  const DISPLAY_FALLBACK = '"Cooper Black", Georgia, "Times New Roman", serif';
  const FONT_PROBES = ['700 100px "Barlow Condensed"', '400 60px Shrikhand'];
  const FONT_TIMEOUT_MS = 2000;

  const C = {
    paper: '#F7F1E3',
    paperHi: '#FCF8EE',
    edge: 'rgba(96, 72, 40, 0.42)',
    red: '#C0272D',
    ink: '#1B1B1F',
    navy: '#1F3A6B',
    gold: '#E2B23A',
    goldDeep: '#B8862A',
    brass: '#C9A15B',
    skin: '#F5D6B3',
    skinShade: '#E6B892',
    blush: 'rgba(214, 96, 86, 0.28)',
    fur: '#FCF9F1',
    lace: '#FFFDF6',
    steel: '#DDE2E8',
    steelDark: '#8C96A3',
    wood: '#8A5A2B',
    leaf: '#2F6243',
    wine: '#8E1F1F',
    wineDeep: '#6E1515',
    cream: '#F4E9D2',
    backInk: '#0B0B0C',
    backMark: '#F4F4F1',
  };

  // Índice: rank grande + pip pequeno, no canto superior esquerdo (e girado no inferior direito).
  const INDEX = { x: 51, baseline: 122, size: 130, maxWidth: 74, pipY: 168, pipSize: 26 };

  // Grade dos pips das cartas numéricas (frações da largura/altura).
  const COL_L = 0.3;
  const COL_C = 0.5;
  const COL_R = 0.7;
  const ROW_T = 0.19;
  const ROW_M = 0.5;
  const ROW_B = 0.81;
  const ROW_7 = (ROW_T + ROW_M) / 2;
  const PIP_SIZE = 47; // meia-altura do pip em px

  const PIP_LAYOUTS = {
    '2': [[COL_C, ROW_T], [COL_C, ROW_B]],
    '3': [[COL_C, ROW_T], [COL_C, ROW_M], [COL_C, ROW_B]],
    '4': [[COL_L, ROW_T], [COL_R, ROW_T], [COL_L, ROW_B], [COL_R, ROW_B]],
    '5': [[COL_L, ROW_T], [COL_R, ROW_T], [COL_C, ROW_M], [COL_L, ROW_B], [COL_R, ROW_B]],
    '6': [[COL_L, ROW_T], [COL_R, ROW_T], [COL_L, ROW_M], [COL_R, ROW_M], [COL_L, ROW_B], [COL_R, ROW_B]],
    '7': [[COL_L, ROW_T], [COL_R, ROW_T], [COL_C, ROW_7], [COL_L, ROW_M], [COL_R, ROW_M], [COL_L, ROW_B], [COL_R, ROW_B]],
  };

  // Moldura das figuras (J, Q, K).
  const FRAME = { x: 96, y: 30, w: W - 192, h: H - 60 };

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------

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

  function canvasSupported() {
    return (typeof document !== 'undefined' && !!document.createElement) || typeof OffscreenCanvas !== 'undefined';
  }

  function makeCanvas(w, h) {
    if (typeof document !== 'undefined' && document.createElement) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    throw new Error('CardTex: canvas indisponível neste ambiente');
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function circle(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
  }

  function ellipse(ctx, x, y, rx, ry, rot) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot || 0, 0, TAU);
  }

  /** Preenche o path atual e contorna com tinta (estilo gravura das figuras). */
  function paint(ctx, fill, lineWidth) {
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (lineWidth !== 0) {
      ctx.lineWidth = lineWidth || 2.4;
      ctx.strokeStyle = C.ink;
      ctx.stroke();
    }
  }

  function strokeLine(ctx, pts, width, color) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  /** Traço grosso com contorno (membros, cabos, hastes). */
  function outlinedStroke(ctx, pts, width, color, outline) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    strokeLine(ctx, pts, width + (outline || 2.4) * 2, C.ink);
    strokeLine(ctx, pts, width, color);
    ctx.restore();
  }

  /** true se existe uma FontFace dessa família já carregada (não só declarada). */
  function hasLoadedFace(family) {
    if (typeof document === 'undefined' || !document.fonts || typeof document.fonts.forEach !== 'function') return false;
    let found = false;
    document.fonts.forEach((face) => {
      if (face.status === 'loaded' && face.family.replace(/["']/g, '') === family) found = true;
    });
    return found;
  }

  /** Shrikhand só tem peso 400; sem ela, usa uma serifada em negrito para o nome continuar forte. */
  function displayFont(size) {
    return hasLoadedFace('Shrikhand') ? '400 ' + size + 'px ' + DISPLAY_FAMILY : '700 ' + size + 'px ' + DISPLAY_FALLBACK;
  }

  function suitColor(suit) {
    return RED_SUITS[suit] ? C.red : C.ink;
  }

  // ---------------------------------------------------------------------------
  // Pips vetoriais (unidade: meia-altura = 1, centro na origem, y para baixo)
  // ---------------------------------------------------------------------------

  function heartPath(ctx) {
    ctx.moveTo(0, 1);
    ctx.bezierCurveTo(-0.28, 0.66, -1.0, 0.24, -1.0, -0.33);
    ctx.bezierCurveTo(-1.0, -0.76, -0.72, -1.0, -0.47, -1.0);
    ctx.bezierCurveTo(-0.22, -1.0, -0.06, -0.84, 0, -0.6);
    ctx.bezierCurveTo(0.06, -0.84, 0.22, -1.0, 0.47, -1.0);
    ctx.bezierCurveTo(0.72, -1.0, 1.0, -0.76, 1.0, -0.33);
    ctx.bezierCurveTo(1.0, 0.24, 0.28, 0.66, 0, 1);
    ctx.closePath();
  }

  function diamondPath(ctx) {
    const hw = 0.8;
    ctx.moveTo(0, -1);
    ctx.quadraticCurveTo(hw * 0.36, -0.44, hw, 0);
    ctx.quadraticCurveTo(hw * 0.36, 0.44, 0, 1);
    ctx.quadraticCurveTo(-hw * 0.36, 0.44, -hw, 0);
    ctx.quadraticCurveTo(-hw * 0.36, -0.44, 0, -1);
    ctx.closePath();
  }

  function spadePath(ctx) {
    ctx.moveTo(0, -1);
    ctx.bezierCurveTo(0.24, -0.64, 1.0, -0.3, 1.0, 0.2);
    ctx.bezierCurveTo(1.0, 0.56, 0.74, 0.74, 0.5, 0.74);
    ctx.bezierCurveTo(0.28, 0.74, 0.12, 0.62, 0.05, 0.46);
    ctx.quadraticCurveTo(0.08, 0.84, 0.36, 1.0);
    ctx.lineTo(-0.36, 1.0);
    ctx.quadraticCurveTo(-0.08, 0.84, -0.05, 0.46);
    ctx.bezierCurveTo(-0.12, 0.62, -0.28, 0.74, -0.5, 0.74);
    ctx.bezierCurveTo(-0.74, 0.74, -1.0, 0.56, -1.0, 0.2);
    ctx.bezierCurveTo(-1.0, -0.3, -0.24, -0.64, 0, -1);
    ctx.closePath();
  }

  function clubPath(ctx) {
    const r = 0.43;
    const lobes = [[0, -0.54], [-0.5, 0.1], [0.5, 0.1]];
    for (const [x, y] of lobes) {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
    }
    ctx.moveTo(0.3, 0);
    ctx.arc(0, 0, 0.3, 0, TAU);
    ctx.moveTo(-0.07, 0.1);
    ctx.quadraticCurveTo(-0.08, 0.8, -0.38, 1.0);
    ctx.lineTo(0.38, 1.0);
    ctx.quadraticCurveTo(0.08, 0.8, 0.07, 0.1);
    ctx.closePath();
  }

  const PIP_PATHS = { hearts: heartPath, diamonds: diamondPath, spades: spadePath, clubs: clubPath };

  /** Monta o path do pip em (x, y) com meia-altura `size`; `flip` gira 180°. */
  function pipPath(ctx, suit, x, y, size, flip) {
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.rotate(Math.PI);
    ctx.scale(size, size);
    ctx.beginPath();
    PIP_PATHS[suit](ctx);
    ctx.restore();
  }

  function drawPip(ctx, suit, x, y, size, flip, color) {
    pipPath(ctx, suit, x, y, size, flip);
    ctx.fillStyle = color || suitColor(suit);
    ctx.fill('nonzero');
  }

  // ---------------------------------------------------------------------------
  // Papel, borda e índices
  // ---------------------------------------------------------------------------

  let paperTile = null;

  function paperPattern(ctx) {
    if (!paperTile) {
      const size = 192;
      paperTile = makeCanvas(size, size);
      const g = paperTile.getContext('2d');
      const img = g.createImageData(size, size);
      const rnd = mulberry32(1979);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = rnd();
        const dark = v < 0.5;
        img.data[i] = dark ? 110 : 255;
        img.data[i + 1] = dark ? 84 : 253;
        img.data[i + 2] = dark ? 48 : 244;
        img.data[i + 3] = Math.floor(Math.abs(v - 0.5) * 2 * 15);
      }
      g.putImageData(img, 0, 0);
      // Fibras curtas bem discretas.
      g.lineCap = 'round';
      for (let k = 0; k < 70; k++) {
        const x = rnd() * size;
        const y = rnd() * size;
        const a = rnd() * TAU;
        const len = 4 + rnd() * 10;
        g.strokeStyle = 'rgba(150, 118, 72, ' + (0.05 + rnd() * 0.06).toFixed(3) + ')';
        g.lineWidth = 0.5 + rnd() * 0.5;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + Math.cos(a + 0.6) * len * 0.5, y + Math.sin(a + 0.6) * len * 0.5,
          x + Math.cos(a) * len, y + Math.sin(a) * len);
        g.stroke();
      }
    }
    return ctx.createPattern(paperTile, 'repeat');
  }

  function drawPaper(ctx) {
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.1, W / 2, H / 2, H * 0.72);
    glow.addColorStop(0, 'rgba(255, 253, 246, 0.35)');
    glow.addColorStop(1, 'rgba(196, 164, 112, 0.07)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = paperPattern(ctx);
    ctx.fillRect(0, 0, W, H);
  }

  function drawEdge(ctx) {
    roundRectPath(ctx, 1.5, 1.5, W - 3, H - 3, CORNER_R - 1.5);
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.edge;
    ctx.stroke();
  }

  function drawIndex(ctx, rank, suit) {
    ctx.save();
    ctx.fillStyle = suitColor(suit);
    ctx.font = '700 ' + INDEX.size + 'px ' + INDEX_FAMILY;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(rank, INDEX.x, INDEX.baseline, INDEX.maxWidth);
    ctx.restore();
    drawPip(ctx, suit, INDEX.x, INDEX.pipY, INDEX.pipSize);
  }

  function drawIndices(ctx, rank, suit) {
    drawIndex(ctx, rank, suit);
    ctx.save();
    ctx.translate(W, H);
    ctx.rotate(Math.PI);
    drawIndex(ctx, rank, suit);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Cartas numéricas e ases
  // ---------------------------------------------------------------------------

  function drawNumber(ctx, rank, suit) {
    for (const [fx, fy] of PIP_LAYOUTS[rank]) {
      drawPip(ctx, suit, fx * W, fy * H, PIP_SIZE, fy > 0.5);
    }
    if (rank === '2') {
      // duas bananinhas (Nano Banana 2): uma em cima da outra, inclinadas em sentidos opostos
      const tilt = BANANA_TILT[suit];
      drawBanana(ctx, W / 2 - 14, H / 2 - 50, tilt, 0.78);
      drawBanana(ctx, W / 2 + 14, H / 2 + 62, -tilt, 0.78);
    }
  }

  // --- Easter egg: a bananinha dos 2 ------------------------------------------

  const BANANA = {
    skin: '#F6D23A',
    skinHi: '#FFF0A0',
    skinDeep: '#DDA91E',
    tip: '#5A3A1A',
    stem: '#7C6A2C',
    spot: 'rgba(110, 72, 30, 0.75)',
  };
  const BANANA_TILT = { clubs: -0.3, hearts: 0.2, spades: -0.1, diamonds: 0.34 };

  function bananaBodyPath(ctx) {
    ctx.beginPath();
    ctx.moveTo(-56, -12);
    ctx.quadraticCurveTo(0, 24, 52, -16); // borda de dentro (côncava)
    ctx.quadraticCurveTo(60, -14, 58, -4); // ombro perto do cabinho
    ctx.quadraticCurveTo(0, 70, -60, -2); // barriga (convexa)
    ctx.quadraticCurveTo(-62, -10, -56, -12);
    ctx.closePath();
  }

  /** Bananinha deitada e sorridente, centrada em (x, y); menor que um pip e sem forma de naipe. */
  function drawBanana(ctx, x, y, angle, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0);
    if (scale) ctx.scale(scale, scale);
    ctx.translate(0, -18); // centro visual do crescente
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Cabinho (atrás do corpo).
    ctx.beginPath();
    ctx.moveTo(48, -12);
    ctx.quadraticCurveTo(60, -22, 66, -38);
    ctx.lineTo(76, -34);
    ctx.quadraticCurveTo(70, -16, 58, -4);
    ctx.closePath();
    paint(ctx, BANANA.stem, 2.2);
    ctx.beginPath();
    ctx.moveTo(65, -39);
    ctx.lineTo(77, -34);
    ctx.lineWidth = 5;
    ctx.strokeStyle = BANANA.tip;
    ctx.stroke();

    // Corpo com volume.
    bananaBodyPath(ctx);
    const g = ctx.createLinearGradient(0, -6, 0, 34);
    g.addColorStop(0, BANANA.skinHi);
    g.addColorStop(0.35, BANANA.skin);
    g.addColorStop(1, BANANA.skinDeep);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // Aresta da casca e brilho.
    ctx.beginPath();
    ctx.moveTo(-50, 0);
    ctx.quadraticCurveTo(0, 50, 52, -6);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(150, 100, 20, 0.45)';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-40, -3);
    ctx.quadraticCurveTo(-4, 22, 30, 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 252, 225, 0.8)';
    ctx.stroke();
    // Pintinhas marrons.
    ctx.fillStyle = BANANA.spot;
    for (const [sx, sy, rx, ry] of [[-34, 18, 2.6, 1.8], [30, 20, 2.2, 1.6], [38, 10, 1.6, 1.2], [-26, 24, 1.5, 1.1]]) {
      ellipse(ctx, sx, sy, rx, ry, 0.4);
      ctx.fill();
    }
    ctx.restore();
    bananaBodyPath(ctx);
    paint(ctx, null, 2.6);

    // Pontinha escura.
    ellipse(ctx, -60, -7, 4.5, 5.5, 0.3);
    paint(ctx, BANANA.tip, 1.6);

    // Carinha simpática.
    ctx.fillStyle = C.ink;
    for (const s of [1, -1]) {
      ellipse(ctx, s * 9, 16, 2.6, 3.2);
      ctx.fill();
    }
    ctx.fillStyle = '#FFFFFF';
    for (const s of [1, -1]) {
      circle(ctx, s * 9 - 0.9, 14.8, 1);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(232, 110, 90, 0.45)';
    for (const s of [1, -1]) {
      ellipse(ctx, s * 17, 22, 3.6, 2.2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 20, 4.2, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
    ctx.restore();
  }

  function drawAce(ctx, suit) {
    if (suit === 'spades') {
      drawAceOfSpades(ctx);
      return;
    }
    const cx = W / 2;
    const cy = H / 2;
    const size = suit === 'diamonds' ? 96 : 88;
    drawPip(ctx, suit, cx, cy, size);
  }

  /** Espiral decorativa (arabesco) começando em (x, y). */
  function curl(ctx, x, y, r, startAngle, dir, turns) {
    ctx.beginPath();
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = startAngle + dir * t * turns * TAU;
      const rr = r * (1 - 0.78 * t);
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  function leafShape(ctx, x, y, len, width, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(width, -len * 0.5, 0, -len);
    ctx.quadraticCurveTo(-width, -len * 0.5, 0, 0);
    ctx.closePath();
    ctx.restore();
  }

  function drawAceOfSpades(ctx) {
    const cx = W / 2;
    const cy = H / 2 + 4;

    // Anéis do medalhão.
    ctx.save();
    circle(ctx, cx, cy, 200);
    ctx.lineWidth = 2;
    ctx.strokeStyle = C.brass;
    ctx.stroke();
    circle(ctx, cx, cy, 192);
    ctx.lineWidth = 4;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
    circle(ctx, cx, cy, 184);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = C.ink;
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * TAU;
      circle(ctx, cx + Math.cos(a) * 176, cy + Math.sin(a) * 176, i % 2 ? 1.5 : 2.5);
      ctx.fill();
    }
    // Raios finos ao fundo.
    ctx.save();
    circle(ctx, cx, cy, 166);
    ctx.clip();
    ctx.strokeStyle = 'rgba(201, 161, 91, 0.5)';
    ctx.lineWidth = 1.3;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 70, cy + Math.sin(a) * 70);
      ctx.lineTo(cx + Math.cos(a) * 166, cy + Math.sin(a) * 166);
      ctx.stroke();
    }
    ctx.restore();

    // Arabescos simétricos (desenha o lado direito e espelha), dentro do medalhão.
    for (const side of [1, -1]) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(side, 1);
      ctx.lineCap = 'round';
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(30, 132);
      ctx.bezierCurveTo(78, 138, 128, 112, 140, 60);
      ctx.bezierCurveTo(146, 32, 128, 14, 110, 24);
      ctx.stroke();
      ctx.lineWidth = 3.4;
      curl(ctx, 118, 38, 13, -Math.PI * 0.6, -1, 0.9);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(34, -142);
      ctx.bezierCurveTo(84, -150, 132, -118, 136, -70);
      ctx.bezierCurveTo(138, -46, 120, -36, 106, -46);
      ctx.stroke();
      ctx.lineWidth = 3;
      curl(ctx, 114, -58, 11, Math.PI * 0.55, 1, 0.9);
      const leaves = [
        [76, 134, 22, 8, -1.9], [114, 114, 22, 8, -1.2], [140, 78, 20, 7, -0.5],
        [72, -144, 20, 7, 1.3], [118, -118, 20, 7, 0.6],
      ];
      for (const [lx, ly, len, lw, la] of leaves) {
        leafShape(ctx, lx, ly, len, lw, la);
        ctx.fillStyle = C.gold;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.fillStyle = C.red;
      circle(ctx, 150, 8, 5);
      ctx.fill();
      ctx.restore();
    }

    // Grande espada com filetes.
    const size = 132;
    drawPip(ctx, 'spades', cx, cy, size, false, C.ink);
    pipPath(ctx, 'spades', cx, cy + 4, size * 0.86, false);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = C.cream;
    ctx.stroke();
    pipPath(ctx, 'spades', cx, cy + 6, size * 0.8, false);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(201, 161, 91, 0.9)';
    ctx.stroke();

    // Easter egg: o Clawd no coração da espada (no lugar da flor-de-lis).
    drawClawd(ctx, cx, cy + 6, 10);

    // Coroinha entre a ponta da espada e o aro.
    ctx.save();
    ctx.translate(cx, cy - 150);
    ctx.beginPath();
    ctx.moveTo(-20, 7);
    ctx.lineTo(-22, -10);
    ctx.lineTo(-10, -1);
    ctx.lineTo(0, -15);
    ctx.lineTo(10, -1);
    ctx.lineTo(22, -10);
    ctx.lineTo(20, 7);
    ctx.closePath();
    paint(ctx, C.gold, 2);
    for (const [px, py] of [[-22, -10], [0, -15], [22, -10]]) {
      circle(ctx, px, py, 3.2);
      paint(ctx, C.lace, 1.3);
    }
    ctx.restore();

    // Fita com o nome.
    ctx.save();
    ctx.translate(cx, cy + 178);
    for (const s of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(s * 92, -12);
      ctx.lineTo(s * 128, -10);
      ctx.lineTo(s * 116, 4);
      ctx.lineTo(s * 128, 18);
      ctx.lineTo(s * 92, 16);
      ctx.closePath();
      paint(ctx, C.wineDeep, 2);
    }
    ctx.beginPath();
    ctx.moveTo(-104, -20);
    ctx.quadraticCurveTo(0, -30, 104, -20);
    ctx.lineTo(104, 10);
    ctx.quadraticCurveTo(0, 0, -104, 10);
    ctx.closePath();
    paint(ctx, C.wine, 2.2);
    ctx.fillStyle = C.cream;
    ctx.font = '700 25px ' + INDEX_FAMILY;
    ctx.textBaseline = 'middle';
    drawSpacedText(ctx, 'CLAUDE CODE', 0, -8, 2.2, 190);
    ctx.restore();
    ctx.restore();
  }

  // --- Easter egg: o Clawd em pixel-art ---------------------------------------
  // Grade 16 × 7: B corpo, E olho, A braço, L perna. Simétrica em torno do centro.
  const CLAWD_GRID = [
    '..BBBBBBBBBBBB..',
    '..BBEBBBBBBEBB..',
    '..BBEBBBBBBEBB..',
    'AABBBBBBBBBBBBAA',
    '..BBBBBBBBBBBB..',
    '...L.L....L.L...',
    '...L.L....L.L...',
  ];
  const CLAWD_COLORS = { B: '#D97757', A: '#D97757', L: '#D97757', E: '#1B1B1F' };

  /**
   * Clawd centrado em (cx, cy), `cell` px por pixel da grade. Só fillRect em coordenadas
   * inteiras: nada de curvas nem suavização, os pixels ficam bem marcados.
   */
  function drawClawd(ctx, cx, cy, cell) {
    const rows = CLAWD_GRID.length;
    const cols = CLAWD_GRID[0].length;
    const x0 = Math.round(cx - (cols * cell) / 2);
    const y0 = Math.round(cy - (rows * cell) / 2);
    const o = Math.max(2, Math.round(cell * 0.4)); // contorno creme, também em degraus
    const filled = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols && CLAWD_GRID[r][c] !== '.';
    ctx.save();
    ctx.fillStyle = C.cream;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (filled(r, c)) ctx.fillRect(x0 + c * cell - o, y0 + r * cell - o, cell + o * 2, cell + o * 2);
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = CLAWD_GRID[r][c];
        if (k === '.') continue;
        ctx.fillStyle = CLAWD_COLORS[k];
        ctx.fillRect(x0 + c * cell, y0 + r * cell, cell, cell);
      }
    }
    ctx.restore();
  }

  /** Texto com espaçamento entre letras (compatível com navegadores sem ctx.letterSpacing). */
  function drawSpacedText(ctx, text, x, y, spacing, maxWidth) {
    const chars = Array.from(text);
    const widths = chars.map((ch) => ctx.measureText(ch).width);
    let total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
    const scale = maxWidth && total > maxWidth ? maxWidth / total : 1;
    total *= scale;
    ctx.save();
    ctx.translate(x - total / 2, y);
    ctx.scale(scale, 1);
    ctx.textAlign = 'left';
    let cursor = 0;
    chars.forEach((ch, i) => {
      ctx.fillText(ch, cursor, 0);
      cursor += widths[i] + spacing;
    });
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Figuras (J, Q, K)
  // ---------------------------------------------------------------------------
  //
  // Cada meia-figura é desenhada em coordenadas locais com origem no centro da
  // linha divisória, y negativo para cima (a cabeça fica perto de y = -205).
  // A metade de baixo é a mesma meia-figura girada 180°, como numa carta real.

  const COURT_PALETTES = {
    hearts: { robe: C.red, panel: C.gold, band: C.navy, trim: C.gold, motif: C.gold, hair: '#C98A2C', eye: C.navy },
    diamonds: { robe: C.gold, panel: C.red, band: C.navy, trim: C.red, motif: C.red, hair: '#9A4A22', eye: '#5A3A1A' },
    spades: { robe: C.navy, panel: C.gold, band: C.red, trim: C.gold, motif: C.gold, hair: '#2A2324', eye: '#3A2A1A' },
    clubs: { robe: '#2A2A31', panel: C.red, band: C.gold, trim: C.gold, motif: C.red, hair: '#6B3F1F', eye: C.navy },
  };

  // Objeto e espelhamento por figura (varia a composição entre naipes); `bob` troca a dama padrão
  // pela dama de chanel, tiara e fone (easter egg da Qh, drawBob*).
  const COURT_SPECS = {
    Kh: { object: 'swordBehind', mirror: false },
    Ks: { object: 'sword', mirror: true },
    Kd: { object: 'axe', mirror: false },
    Kc: { object: 'scepter', mirror: true },
    Qh: { object: 'caduceus', mirror: true, bob: true }, // easter egg: dama de chanel e fone, inspirada na logo da Nous (Hermes)
    Qs: { object: 'scepterOrb', mirror: false },
    Qd: { object: 'tulip', mirror: true },
    Qc: { object: 'bouquet', mirror: false },
    Jh: { object: 'torch', mirror: false },
    Js: { object: 'halberd', mirror: true },
    Jd: { object: 'pennant', mirror: false },
    Jc: { object: 'arrow', mirror: true },
  };

  const HAND = { K: [86, -96], Q: [66, -84], J: [86, -92] };

  function torsoPath(ctx) {
    ctx.beginPath();
    ctx.moveTo(-164, 2);
    ctx.lineTo(-156, -92);
    ctx.quadraticCurveTo(-148, -128, -104, -138);
    ctx.lineTo(-36, -152);
    ctx.lineTo(36, -152);
    ctx.lineTo(104, -138);
    ctx.quadraticCurveTo(148, -128, 156, -92);
    ctx.lineTo(164, 2);
    ctx.closePath();
  }

  function drawRobeMotifs(ctx, rank, pal) {
    ctx.save();
    if (rank === 'K') {
      // Cruzetas/florões em grade.
      ctx.fillStyle = pal.motif;
      for (let y = -118; y < 0; y += 30) {
        for (let x = -150; x <= 150; x += 30) {
          const ox = ((y / 30) | 0) % 2 ? 15 : 0;
          const px = x + ox;
          ctx.beginPath();
          ctx.moveTo(px, y - 7);
          ctx.lineTo(px + 3, y - 2);
          ctx.lineTo(px + 7, y);
          ctx.lineTo(px + 3, y + 2);
          ctx.lineTo(px, y + 7);
          ctx.lineTo(px - 3, y + 2);
          ctx.lineTo(px - 7, y);
          ctx.lineTo(px - 3, y - 2);
          ctx.closePath();
          ctx.fill();
        }
      }
    } else if (rank === 'Q') {
      // Florzinhas de quatro pétalas.
      for (let y = -122; y < 0; y += 28) {
        for (let x = -150; x <= 150; x += 28) {
          const px = x + (((y / 28) | 0) % 2 ? 14 : 0);
          ctx.fillStyle = pal.motif;
          for (let k = 0; k < 4; k++) {
            const a = (k / 4) * TAU + Math.PI / 4;
            circle(ctx, px + Math.cos(a) * 4, y + Math.sin(a) * 4, 3.2);
            ctx.fill();
          }
          ctx.fillStyle = C.lace;
          circle(ctx, px, y, 1.8);
          ctx.fill();
        }
      }
    } else {
      // Listras diagonais (gibão do valete).
      ctx.strokeStyle = pal.motif;
      ctx.lineWidth = 5;
      for (let x = -320; x < 200; x += 22) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 150, -150);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(27, 27, 31, 0.55)';
      ctx.lineWidth = 1.2;
      for (let x = -309; x < 211; x += 22) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 150, -150);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawTorso(ctx, rank, pal) {
    torsoPath(ctx);
    ctx.fillStyle = pal.robe;
    ctx.fill();
    ctx.save();
    torsoPath(ctx);
    ctx.clip();
    drawRobeMotifs(ctx, rank, pal);

    // Painel central com losangos.
    ctx.beginPath();
    ctx.moveTo(-30, -152);
    ctx.lineTo(30, -152);
    ctx.lineTo(46, 2);
    ctx.lineTo(-46, 2);
    ctx.closePath();
    paint(ctx, pal.panel, 2.2);
    for (let y = -126; y < 0; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y - 12);
      ctx.lineTo(10, y);
      ctx.lineTo(0, y + 12);
      ctx.lineTo(-10, y);
      ctx.closePath();
      paint(ctx, pal.band, 1.6);
      circle(ctx, 0, y, 2.6);
      ctx.fillStyle = C.lace;
      ctx.fill();
    }
    // Galões dourados nas bordas do painel.
    for (const s of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(s * 36, -152);
      ctx.lineTo(s * 53, 2);
      ctx.lineWidth = 7;
      ctx.strokeStyle = pal.trim === pal.panel ? C.lace : pal.trim;
      ctx.stroke();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = C.ink;
      ctx.beginPath();
      ctx.moveTo(s * 32, -152);
      ctx.lineTo(s * 49, 2);
      ctx.moveTo(s * 40, -152);
      ctx.lineTo(s * 57, 2);
      ctx.stroke();
    }
    // Faixa (cinto) junto da divisória.
    ctx.beginPath();
    ctx.rect(-170, -17, 340, 19);
    paint(ctx, pal.band, 2);
    ctx.fillStyle = C.gold;
    for (let x = -156; x <= 156; x += 16) {
      circle(ctx, x, -8, 2.8);
      ctx.fill();
    }
    ctx.restore();
    torsoPath(ctx);
    paint(ctx, null, 2.6);
  }

  function drawErmine(ctx) {
    ctx.beginPath();
    ctx.moveTo(-148, -100);
    ctx.quadraticCurveTo(-134, -140, -58, -154);
    ctx.lineTo(58, -154);
    ctx.quadraticCurveTo(134, -140, 148, -100);
    ctx.quadraticCurveTo(72, -114, 0, -92);
    ctx.quadraticCurveTo(-72, -114, -148, -100);
    ctx.closePath();
    ctx.save();
    paint(ctx, C.fur, 2.4);
    ctx.clip();
    ctx.fillStyle = C.ink;
    for (let y = -146; y < -90; y += 18) {
      for (let x = -140; x <= 140; x += 24) {
        const px = x + (((y + 146) / 18) % 2 ? 12 : 0);
        ctx.beginPath();
        ctx.moveTo(px, y - 3);
        ctx.quadraticCurveTo(px + 3, y + 4, px, y + 8);
        ctx.quadraticCurveTo(px - 3, y + 4, px, y - 3);
        ctx.fill();
        circle(ctx, px - 3.5, y - 5, 1.3);
        ctx.fill();
        circle(ctx, px + 3.5, y - 5, 1.3);
        ctx.fill();
        circle(ctx, px, y - 7, 1.3);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawRuff(ctx) {
    const cx = 0;
    const cy = -150;
    const rx = 70;
    const ry = 20;
    const n = 26;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      circle(ctx, cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 9.5);
      paint(ctx, C.lace, 1.4);
    }
    ellipse(ctx, cx, cy, rx, ry);
    paint(ctx, C.lace, 0);
    ctx.save();
    ellipse(ctx, cx, cy, rx + 6, ry + 6);
    ctx.clip();
    ctx.strokeStyle = 'rgba(27, 27, 31, 0.45)';
    ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * TAU;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * rx * 0.35, cy + Math.sin(a) * ry * 0.35);
      ctx.lineTo(cx + Math.cos(a) * (rx + 4), cy + Math.sin(a) * (ry + 4));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawJackCollar(ctx, pal) {
    ctx.beginPath();
    ctx.moveTo(-60, -152);
    ctx.lineTo(60, -152);
    ctx.lineTo(0, -104);
    ctx.closePath();
    paint(ctx, C.lace, 2.2);
    ctx.beginPath();
    ctx.moveTo(-44, -152);
    ctx.lineTo(44, -152);
    ctx.lineTo(0, -118);
    ctx.closePath();
    paint(ctx, pal.band, 1.8);
    ctx.fillStyle = C.gold;
    for (const [x, y] of [[-24, -144], [0, -132], [24, -144]]) {
      circle(ctx, x, y, 3.2);
      ctx.fill();
    }
  }

  function drawNeck(ctx) {
    ctx.beginPath();
    ctx.moveTo(-14, -176);
    ctx.lineTo(-14, -146);
    ctx.quadraticCurveTo(0, -140, 14, -146);
    ctx.lineTo(14, -176);
    ctx.closePath();
    paint(ctx, C.skinShade, 2);
  }

  function drawHead(ctx, rank) {
    // Orelhas (J e K; a dama tem o cabelo por cima).
    if (rank !== 'Q') {
      for (const s of [1, -1]) {
        ellipse(ctx, s * 35, -204, 7, 11);
        paint(ctx, C.skin, 2);
      }
    }
    ellipse(ctx, 0, -205, 35, 45);
    paint(ctx, C.skin, 2.4);
  }

  function drawFaceFeatures(ctx, rank, pal) {
    ctx.save();
    ctx.lineCap = 'round';
    // Bochechas.
    for (const s of [1, -1]) {
      const g = ctx.createRadialGradient(s * 19, -186, 1, s * 19, -186, 11);
      g.addColorStop(0, C.blush);
      g.addColorStop(1, 'rgba(214, 96, 86, 0)');
      ctx.fillStyle = g;
      circle(ctx, s * 19, -186, 11);
      ctx.fill();
    }
    // Olhos.
    for (const s of [1, -1]) {
      const ex = s * 14;
      const ey = -210;
      ctx.beginPath();
      ctx.moveTo(ex - 9, ey);
      ctx.quadraticCurveTo(ex, ey - 7.5, ex + 9, ey);
      ctx.quadraticCurveTo(ex, ey + 5, ex - 9, ey);
      ctx.closePath();
      paint(ctx, '#FFFFFF', 1.3);
      circle(ctx, ex + 0.6, ey - 0.6, 3.6);
      ctx.fillStyle = pal.eye;
      ctx.fill();
      circle(ctx, ex + 0.6, ey - 0.6, 1.6);
      ctx.fillStyle = C.ink;
      ctx.fill();
      // Pálpebra superior.
      ctx.beginPath();
      ctx.moveTo(ex - 10, ey + 0.5);
      ctx.quadraticCurveTo(ex, ey - 8.5, ex + 10, ey + 0.5);
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = C.ink;
      ctx.stroke();
      if (rank === 'Q') {
        ctx.lineWidth = 1.4;
        for (let k = 0; k < 3; k++) {
          const lx = ex + s * (4 + k * 3.2);
          ctx.beginPath();
          ctx.moveTo(lx, ey - 5 + k * 1.5);
          ctx.lineTo(lx + s * 3, ey - 8 + k * 1.5);
          ctx.stroke();
        }
      }
      // Sobrancelha.
      ctx.beginPath();
      ctx.moveTo(ex - s * 9, ey - 11);
      ctx.quadraticCurveTo(ex + s * 1, ey - (rank === 'K' ? 16 : 17), ex + s * 11, ey - 11);
      ctx.lineWidth = rank === 'K' ? 3.6 : 2.4;
      ctx.strokeStyle = rank === 'K' ? pal.hair : C.ink;
      ctx.stroke();
      if (rank === 'K') {
        ctx.lineWidth = 1;
        ctx.strokeStyle = C.ink;
        ctx.stroke();
      }
    }
    // Nariz.
    ctx.beginPath();
    ctx.moveTo(-1, -205);
    ctx.quadraticCurveTo(-5, -194, -6, -189);
    ctx.quadraticCurveTo(-1, -184, 5, -188);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
    // Boca.
    const my = rank === 'K' ? -170 : -173;
    ctx.beginPath();
    ctx.moveTo(-10, my - 2);
    ctx.quadraticCurveTo(-4, my - 4, 0, my - 2);
    ctx.quadraticCurveTo(4, my - 4, 10, my - 2);
    ctx.quadraticCurveTo(0, my + 6, -10, my - 2);
    ctx.closePath();
    paint(ctx, C.red, 1.2);
    ctx.restore();
  }

  function drawKingHairBack(ctx, pal) {
    ctx.beginPath();
    ctx.moveTo(-34, -232);
    ctx.bezierCurveTo(-58, -214, -58, -176, -56, -150);
    ctx.bezierCurveTo(-54, -138, -46, -134, -40, -140);
    ctx.lineTo(40, -140);
    ctx.bezierCurveTo(46, -134, 54, -138, 56, -150);
    ctx.bezierCurveTo(58, -176, 58, -214, 34, -232);
    ctx.closePath();
    paint(ctx, pal.hair, 2.2);
  }

  function drawKingBeard(ctx, pal) {
    ctx.beginPath();
    ctx.moveTo(-35, -206);
    ctx.bezierCurveTo(-40, -176, -34, -146, -14, -134);
    ctx.quadraticCurveTo(-7, -124, 0, -122);
    ctx.quadraticCurveTo(7, -124, 14, -134);
    ctx.bezierCurveTo(34, -146, 40, -176, 35, -206);
    ctx.lineTo(28, -204);
    ctx.bezierCurveTo(28, -182, 18, -158, 0, -158);
    ctx.bezierCurveTo(-18, -158, -28, -182, -28, -204);
    ctx.closePath();
    paint(ctx, pal.hair, 2.2);
    // Cachos da barba.
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(27, 27, 31, 0.6)';
    ctx.lineWidth = 1.3;
    for (const [x, y, r] of [[-22, -160, 6], [-10, -144, 6], [10, -144, 6], [22, -160, 6], [0, -132, 5], [-28, -180, 5], [28, -180, 5]]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0.2, Math.PI * 1.2);
      ctx.stroke();
    }
    ctx.restore();
    // Bigode.
    ctx.beginPath();
    ctx.moveTo(0, -181);
    ctx.bezierCurveTo(-8, -184, -18, -182, -22, -174);
    ctx.bezierCurveTo(-26, -168, -30, -170, -30, -175);
    ctx.bezierCurveTo(-26, -168, -18, -172, -14, -176);
    ctx.bezierCurveTo(-8, -178, -3, -176, 0, -175);
    ctx.bezierCurveTo(3, -176, 8, -178, 14, -176);
    ctx.bezierCurveTo(18, -172, 26, -168, 30, -175);
    ctx.bezierCurveTo(30, -170, 26, -168, 22, -174);
    ctx.bezierCurveTo(18, -182, 8, -184, 0, -181);
    ctx.closePath();
    paint(ctx, pal.hair, 1.6);
  }

  function drawKingHairFront(ctx, pal) {
    ctx.beginPath();
    ctx.moveTo(-36, -212);
    ctx.bezierCurveTo(-38, -236, -24, -250, 0, -251);
    ctx.bezierCurveTo(24, -250, 38, -236, 36, -212);
    ctx.bezierCurveTo(30, -226, 22, -234, 12, -236);
    ctx.quadraticCurveTo(0, -228, -12, -236);
    ctx.bezierCurveTo(-22, -234, -30, -226, -36, -212);
    ctx.closePath();
    paint(ctx, pal.hair, 2);
  }

  function drawQueenHair(ctx, pal) {
    ctx.beginPath();
    ctx.moveTo(-30, -246);
    ctx.bezierCurveTo(-64, -236, -60, -196, -60, -168);
    ctx.bezierCurveTo(-60, -140, -74, -118, -80, -100);
    ctx.bezierCurveTo(-66, -96, -54, -104, -48, -112);
    ctx.bezierCurveTo(-40, -104, -30, -110, -26, -120);
    ctx.lineTo(26, -120);
    ctx.bezierCurveTo(30, -110, 40, -104, 48, -112);
    ctx.bezierCurveTo(54, -104, 66, -96, 80, -100);
    ctx.bezierCurveTo(74, -118, 60, -140, 60, -168);
    ctx.bezierCurveTo(60, -196, 64, -236, 30, -246);
    ctx.closePath();
    paint(ctx, pal.hair, 2.2);
    // Mechas onduladas.
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(27, 27, 31, 0.55)';
    ctx.lineWidth = 1.4;
    for (const s of [1, -1]) {
      for (let k = 0; k < 3; k++) {
        const x0 = s * (44 + k * 8);
        ctx.beginPath();
        ctx.moveTo(x0, -214 + k * 6);
        ctx.bezierCurveTo(x0 + s * 8, -186, x0 - s * 6, -160, x0 + s * (6 + k * 3), -118 + k * 4);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawQueenBangs(ctx, pal) {
    ctx.beginPath();
    ctx.moveTo(-37, -206);
    ctx.bezierCurveTo(-40, -236, -22, -252, 0, -252);
    ctx.bezierCurveTo(22, -252, 40, -236, 37, -206);
    ctx.bezierCurveTo(30, -222, 16, -230, 2, -226);
    ctx.bezierCurveTo(-12, -232, -30, -224, -37, -206);
    ctx.closePath();
    paint(ctx, pal.hair, 2);
  }

  function drawJackHair(ctx, pal) {
    ctx.beginPath();
    ctx.moveTo(-37, -196);
    ctx.bezierCurveTo(-44, -232, -26, -254, 0, -254);
    ctx.bezierCurveTo(26, -254, 44, -232, 37, -196);
    ctx.bezierCurveTo(33, -208, 30, -220, 22, -226);
    ctx.bezierCurveTo(8, -222, -12, -226, -22, -226);
    ctx.bezierCurveTo(-30, -220, -33, -208, -37, -196);
    ctx.closePath();
    paint(ctx, pal.hair, 2);
    // Cachos laterais.
    for (const s of [1, -1]) {
      for (const [dx, dy] of [[40, -196], [43, -182], [41, -168]]) {
        circle(ctx, s * dx, dy, 7.5);
        paint(ctx, pal.hair, 1.8);
      }
    }
  }

  function drawKingCrown(ctx, pal) {
    // Veludo interno.
    ctx.beginPath();
    ctx.moveTo(-36, -258);
    ctx.bezierCurveTo(-36, -300, 36, -300, 36, -258);
    ctx.closePath();
    paint(ctx, pal.band === C.gold ? C.red : pal.band, 2);
    // Pontas.
    ctx.beginPath();
    ctx.moveTo(-42, -258);
    ctx.lineTo(-46, -300);
    ctx.lineTo(-28, -276);
    ctx.lineTo(-18, -304);
    ctx.lineTo(-8, -278);
    ctx.lineTo(0, -314);
    ctx.lineTo(8, -278);
    ctx.lineTo(18, -304);
    ctx.lineTo(28, -276);
    ctx.lineTo(46, -300);
    ctx.lineTo(42, -258);
    ctx.closePath();
    paint(ctx, C.gold, 2.2);
    for (const [x, y] of [[-46, -300], [-18, -304], [0, -314], [18, -304], [46, -300]]) {
      circle(ctx, x, y, 4.2);
      paint(ctx, C.lace, 1.5);
    }
    // Aro com pedras.
    ctx.beginPath();
    ctx.moveTo(-44, -262);
    ctx.quadraticCurveTo(0, -268, 44, -262);
    ctx.lineTo(44, -244);
    ctx.quadraticCurveTo(0, -250, -44, -244);
    ctx.closePath();
    paint(ctx, C.gold, 2.2);
    const gems = [C.red, C.navy, C.red, C.navy, C.red];
    gems.forEach((g, i) => {
      const x = -32 + i * 16;
      ellipse(ctx, x, -255, 4.2, 5);
      paint(ctx, g, 1.2);
    });
  }

  function drawQueenCrown(ctx, pal) {
    ctx.beginPath();
    ctx.moveTo(-34, -248);
    ctx.lineTo(-38, -276);
    ctx.quadraticCurveTo(-26, -270, -20, -284);
    ctx.quadraticCurveTo(-10, -274, 0, -296);
    ctx.quadraticCurveTo(10, -274, 20, -284);
    ctx.quadraticCurveTo(26, -270, 38, -276);
    ctx.lineTo(34, -248);
    ctx.closePath();
    paint(ctx, C.gold, 2.2);
    for (const [x, y, r] of [[-38, -276, 3.6], [-20, -284, 3.6], [0, -296, 4.4], [20, -284, 3.6], [38, -276, 3.6]]) {
      circle(ctx, x, y, r);
      paint(ctx, C.lace, 1.3);
    }
    ctx.beginPath();
    ctx.moveTo(-36, -256);
    ctx.quadraticCurveTo(0, -262, 36, -256);
    ctx.lineTo(35, -244);
    ctx.quadraticCurveTo(0, -250, -35, -244);
    ctx.closePath();
    paint(ctx, C.gold, 2);
    ellipse(ctx, 0, -266, 5, 6.5);
    paint(ctx, pal.band === C.gold ? C.red : pal.band, 1.3);
    for (const x of [-20, 20]) {
      circle(ctx, x, -251, 3);
      paint(ctx, C.red, 1);
    }
  }

  function drawJackHat(ctx, pal) {
    // Pluma caída para trás, do lado oposto ao objeto que ele segura.
    ctx.beginPath();
    ctx.moveTo(-18, -268);
    ctx.bezierCurveTo(-46, -298, -96, -290, -106, -232);
    ctx.bezierCurveTo(-98, -244, -90, -250, -84, -252);
    ctx.bezierCurveTo(-86, -242, -88, -232, -92, -222);
    ctx.bezierCurveTo(-78, -246, -60, -262, -36, -256);
    ctx.closePath();
    paint(ctx, pal.panel === C.gold ? C.lace : pal.panel, 2);
    ctx.beginPath();
    ctx.moveTo(-26, -264);
    ctx.bezierCurveTo(-56, -284, -88, -276, -98, -236);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
    // Boina.
    ctx.beginPath();
    ctx.moveTo(50, -250);
    ctx.bezierCurveTo(56, -286, -40, -298, -56, -262);
    ctx.bezierCurveTo(-40, -252, 20, -244, 50, -250);
    ctx.closePath();
    paint(ctx, pal.band, 2.2);
    // Aba/faixa.
    ctx.beginPath();
    ctx.moveTo(46, -246);
    ctx.bezierCurveTo(20, -240, -30, -246, -50, -256);
    ctx.lineTo(-48, -246);
    ctx.bezierCurveTo(-28, -236, 20, -230, 44, -236);
    ctx.closePath();
    paint(ctx, C.gold, 1.8);
    circle(ctx, -22, -250, 5);
    paint(ctx, pal.band === C.red ? C.gold : C.red, 1.4);
  }

  function drawArm(ctx, pal, hx, hy) {
    const pts = [[120, -120], [134, -52], [hx + 6, hy + 8]];
    outlinedStroke(ctx, pts, 30, pal.robe);
    // Punho.
    const [ex, ey] = pts[1];
    const dx = hx - ex;
    const dy = hy - ey;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const cx = hx - ux * 16;
    const cy = hy - uy * 16;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.atan2(uy, ux));
    ctx.beginPath();
    ctx.rect(-7, -15.5, 14, 31);
    paint(ctx, pal.robe === C.gold ? C.red : C.gold, 2);
    ctx.restore();
  }

  function drawHand(ctx, hx, hy) {
    ellipse(ctx, hx, hy, 12, 14);
    paint(ctx, C.skin, 2.2);
    ctx.save();
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath();
      ctx.moveTo(hx - 9, hy + k * 5.5);
      ctx.quadraticCurveTo(hx - 2, hy + k * 5.5 + 2, hx + 4, hy + k * 5.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- Objetos das figuras -------------------------------------------------

  function drawSword(ctx, x, y, angle, length) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    // Lâmina.
    ctx.beginPath();
    ctx.moveTo(-7.5, -24);
    ctx.lineTo(-7.5, -length + 22);
    ctx.lineTo(0, -length);
    ctx.lineTo(7.5, -length + 22);
    ctx.lineTo(7.5, -24);
    ctx.closePath();
    paint(ctx, C.steel, 2.2);
    ctx.beginPath();
    ctx.moveTo(0, -30);
    ctx.lineTo(0, -length + 26);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = C.steelDark;
    ctx.stroke();
    // Guarda.
    ctx.beginPath();
    ctx.rect(-26, -28, 52, 9);
    paint(ctx, C.gold, 2);
    for (const s of [1, -1]) {
      circle(ctx, s * 28, -23.5, 5.5);
      paint(ctx, C.gold, 1.8);
    }
    // Empunhadura e pomo.
    ctx.beginPath();
    ctx.rect(-5, -19, 10, 44);
    paint(ctx, C.red, 1.8);
    circle(ctx, 0, 30, 7);
    paint(ctx, C.gold, 2);
    ctx.restore();
  }

  function drawScepter(ctx, x, y, top, withOrb) {
    ctx.beginPath();
    ctx.rect(x - 4.5, top + 14, 9, y + 44 - top - 14);
    paint(ctx, C.gold, 2);
    for (let yy = top + 34; yy < y + 40; yy += 34) {
      ctx.beginPath();
      ctx.rect(x - 7, yy, 14, 6);
      paint(ctx, C.goldDeep, 1.4);
    }
    circle(ctx, x, y + 48, 7);
    paint(ctx, C.gold, 2);
    if (withOrb) {
      circle(ctx, x, top + 4, 14);
      paint(ctx, C.navy, 2.2);
      ctx.beginPath();
      ctx.moveTo(x - 14, top + 4);
      ctx.lineTo(x + 14, top + 4);
      ctx.moveTo(x, top + 4);
      ctx.lineTo(x, top + 18);
      ctx.lineWidth = 3;
      ctx.strokeStyle = C.gold;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, top - 10);
      ctx.lineTo(x, top - 28);
      ctx.moveTo(x - 7, top - 20);
      ctx.lineTo(x + 7, top - 20);
      ctx.lineWidth = 5;
      ctx.strokeStyle = C.ink;
      ctx.stroke();
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = C.gold;
      ctx.stroke();
    } else {
      // Flor-de-lis no topo.
      ctx.beginPath();
      ctx.moveTo(x, top - 30);
      ctx.bezierCurveTo(x + 10, top - 16, x + 9, top - 2, x, top + 8);
      ctx.bezierCurveTo(x - 9, top - 2, x - 10, top - 16, x, top - 30);
      ctx.closePath();
      paint(ctx, C.gold, 2);
      for (const s of [1, -1]) {
        ctx.beginPath();
        ctx.moveTo(x + s * 3, top + 6);
        ctx.bezierCurveTo(x + s * 20, top + 4, x + s * 28, top - 12, x + s * 20, top - 20);
        ctx.bezierCurveTo(x + s * 18, top - 8, x + s * 10, top - 2, x + s * 3, top - 2);
        ctx.closePath();
        paint(ctx, C.gold, 1.8);
      }
      ctx.beginPath();
      ctx.rect(x - 12, top + 6, 24, 8);
      paint(ctx, C.red, 1.8);
    }
  }

  function drawAxe(ctx, x, y) {
    const top = -292;
    ctx.beginPath();
    ctx.rect(x - 5, top, 10, y + 50 - top);
    paint(ctx, C.wood, 2);
    // Lâmina em meia-lua.
    ctx.beginPath();
    ctx.moveTo(x + 4, top + 12);
    ctx.lineTo(x + 26, top + 18);
    ctx.quadraticCurveTo(x + 60, top - 6, x + 64, top + 36);
    ctx.quadraticCurveTo(x + 60, top + 78, x + 26, top + 56);
    ctx.lineTo(x + 4, top + 62);
    ctx.closePath();
    paint(ctx, C.steel, 2.2);
    ctx.beginPath();
    ctx.moveTo(x + 58, top + 12);
    ctx.quadraticCurveTo(x + 66, top + 36, x + 58, top + 60);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = C.steelDark;
    ctx.stroke();
    // Contra-ponta.
    ctx.beginPath();
    ctx.moveTo(x - 4, top + 26);
    ctx.lineTo(x - 26, top + 36);
    ctx.lineTo(x - 4, top + 46);
    ctx.closePath();
    paint(ctx, C.steel, 2);
    ctx.beginPath();
    ctx.moveTo(x - 5, top);
    ctx.lineTo(x, top - 18);
    ctx.lineTo(x + 5, top);
    ctx.closePath();
    paint(ctx, C.steel, 2);
    ctx.beginPath();
    ctx.rect(x - 8, top + 64, 16, 8);
    paint(ctx, C.gold, 1.8);
  }

  function drawHalberd(ctx, x, y) {
    const top = -300;
    ctx.beginPath();
    ctx.rect(x - 4.5, top + 10, 9, y + 60 - top - 10);
    paint(ctx, C.wood, 2);
    // Ponta.
    ctx.beginPath();
    ctx.moveTo(x - 7, top + 14);
    ctx.lineTo(x, top - 22);
    ctx.lineTo(x + 7, top + 14);
    ctx.closePath();
    paint(ctx, C.steel, 2);
    // Lâmina.
    ctx.beginPath();
    ctx.moveTo(x + 4, top + 18);
    ctx.quadraticCurveTo(x + 44, top + 14, x + 50, top + 30);
    ctx.quadraticCurveTo(x + 44, top + 54, x + 50, top + 70);
    ctx.quadraticCurveTo(x + 26, top + 60, x + 4, top + 62);
    ctx.closePath();
    paint(ctx, C.steel, 2.2);
    // Gancho.
    ctx.beginPath();
    ctx.moveTo(x - 4, top + 30);
    ctx.quadraticCurveTo(x - 24, top + 34, x - 34, top + 22);
    ctx.quadraticCurveTo(x - 24, top + 46, x - 4, top + 48);
    ctx.closePath();
    paint(ctx, C.steel, 2);
    // Borla.
    ctx.beginPath();
    ctx.moveTo(x - 6, top + 70);
    ctx.lineTo(x + 6, top + 70);
    ctx.lineTo(x + 10, top + 92);
    ctx.lineTo(x - 10, top + 92);
    ctx.closePath();
    paint(ctx, C.red, 1.8);
  }

  function drawPennantSpear(ctx, x, y, pal) {
    const top = -296;
    ctx.beginPath();
    ctx.rect(x - 4.5, top + 10, 9, y + 60 - top - 10);
    paint(ctx, C.wood, 2);
    ctx.beginPath();
    ctx.moveTo(x, top - 26);
    ctx.quadraticCurveTo(x + 12, top - 2, x, top + 14);
    ctx.quadraticCurveTo(x - 12, top - 2, x, top - 26);
    ctx.closePath();
    paint(ctx, C.steel, 2);
    // Flâmula.
    ctx.beginPath();
    ctx.moveTo(x + 4, top + 18);
    ctx.bezierCurveTo(x + 30, top + 12, x + 50, top + 30, x + 70, top + 22);
    ctx.lineTo(x + 54, top + 40);
    ctx.lineTo(x + 70, top + 58);
    ctx.bezierCurveTo(x + 50, top + 64, x + 30, top + 50, x + 4, top + 56);
    ctx.closePath();
    ctx.save();
    paint(ctx, pal.panel, 2);
    ctx.clip();
    ctx.fillStyle = pal.band;
    ctx.fillRect(x, top + 30, 80, 12);
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(x + 4, top + 18);
    ctx.bezierCurveTo(x + 30, top + 12, x + 50, top + 30, x + 70, top + 22);
    ctx.lineTo(x + 54, top + 40);
    ctx.lineTo(x + 70, top + 58);
    ctx.bezierCurveTo(x + 50, top + 64, x + 30, top + 50, x + 4, top + 56);
    ctx.closePath();
    paint(ctx, null, 2);
  }

  function drawArrow(ctx, x, y, pal) {
    const top = -290;
    ctx.beginPath();
    ctx.rect(x - 3.5, top + 20, 7, y + 56 - top - 20);
    paint(ctx, C.wood, 1.8);
    ctx.beginPath();
    ctx.moveTo(x, top - 10);
    ctx.lineTo(x + 13, top + 24);
    ctx.lineTo(x, top + 18);
    ctx.lineTo(x - 13, top + 24);
    ctx.closePath();
    paint(ctx, C.steel, 2);
    // Penas.
    for (const s of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(x + s * 2, y + 22);
      ctx.lineTo(x + s * 14, y + 30);
      ctx.lineTo(x + s * 14, y + 58);
      ctx.lineTo(x + s * 2, y + 50);
      ctx.closePath();
      paint(ctx, s > 0 ? pal.panel : C.lace, 1.8);
    }
  }

  function flamePath(ctx, x, base, height, width) {
    ctx.beginPath();
    ctx.moveTo(x - width, base);
    ctx.bezierCurveTo(x - width * 1.3, base - height * 0.4, x - width * 0.4, base - height * 0.55, x - width * 0.5, base - height * 0.8);
    ctx.bezierCurveTo(x - width * 0.1, base - height * 0.62, x + width * 0.1, base - height * 0.7, x, base - height);
    ctx.bezierCurveTo(x + width * 0.5, base - height * 0.72, x + width * 0.9, base - height * 0.6, x + width * 0.62, base - height * 0.82);
    ctx.bezierCurveTo(x + width * 1.4, base - height * 0.5, x + width * 1.2, base - height * 0.2, x + width, base);
    ctx.closePath();
  }

  function drawTorch(ctx, x, y) {
    const top = -232;
    ctx.beginPath();
    ctx.moveTo(x - 6, top + 12);
    ctx.lineTo(x + 6, top + 12);
    ctx.lineTo(x + 4, y + 52);
    ctx.lineTo(x - 4, y + 52);
    ctx.closePath();
    paint(ctx, C.wood, 2);
    ctx.beginPath();
    ctx.rect(x - 7, top + 40, 14, 7);
    paint(ctx, C.gold, 1.6);
    // Chama.
    flamePath(ctx, x, top - 2, 78, 22);
    paint(ctx, C.red, 2.2);
    flamePath(ctx, x, top - 2, 50, 12);
    paint(ctx, C.gold, 0);
    ellipse(ctx, x, top - 12, 5, 9);
    ctx.fillStyle = C.lace;
    ctx.fill();
    // Copo da tocha.
    ctx.beginPath();
    ctx.moveTo(x - 20, top - 4);
    ctx.lineTo(x + 20, top - 4);
    ctx.lineTo(x + 9, top + 16);
    ctx.lineTo(x - 9, top + 16);
    ctx.closePath();
    paint(ctx, C.gold, 2.2);
    ctx.beginPath();
    ctx.moveTo(x - 16, top + 2);
    ctx.lineTo(x + 16, top + 2);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
  }

  function drawStem(ctx, pts) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    ctx.quadraticCurveTo(pts[1][0], pts[1][1], pts[2][0], pts[2][1]);
    ctx.lineWidth = 5.5;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.leaf;
    ctx.stroke();
    ctx.restore();
  }

  function drawRose(ctx, x, y, color) {
    circle(ctx, x, y, 19);
    paint(ctx, color, 2.2);
    ctx.save();
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, 12, Math.PI * 0.9, Math.PI * 2.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 1, y + 1, 7, Math.PI * 1.6, Math.PI * 2.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x - 1, y, 3, 0, Math.PI * 1.5);
    ctx.stroke();
    ctx.restore();
  }

  function drawTulip(ctx, x, y) {
    ctx.beginPath();
    ctx.moveTo(x - 16, y - 16);
    ctx.lineTo(x - 8, y - 4);
    ctx.lineTo(x, y - 20);
    ctx.lineTo(x + 8, y - 4);
    ctx.lineTo(x + 16, y - 16);
    ctx.quadraticCurveTo(x + 20, y + 14, x, y + 16);
    ctx.quadraticCurveTo(x - 20, y + 14, x - 16, y - 16);
    ctx.closePath();
    paint(ctx, C.red, 2.2);
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 12);
    ctx.quadraticCurveTo(x, y - 6, x + 6, y + 12);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = C.gold;
    ctx.stroke();
  }

  function drawDaisy(ctx, x, y, petals, color, center) {
    for (let k = 0; k < petals; k++) {
      const a = (k / petals) * TAU;
      ellipse(ctx, x + Math.cos(a) * 8, y + Math.sin(a) * 8, 7, 4.2, a);
      paint(ctx, color, 1.3);
    }
    circle(ctx, x, y, 5);
    paint(ctx, center, 1.3);
  }

  function drawLeaf(ctx, x, y, angle) {
    leafShape(ctx, x, y, 22, 8, angle);
    paint(ctx, C.leaf, 1.6);
  }

  function drawObject(ctx, kind, hx, hy, pal) {
    switch (kind) {
      case 'sword':
        drawSword(ctx, hx, hy, 0, 250);
        break;
      case 'swordBehind':
        drawSword(ctx, hx, hy, -0.62, 270);
        break;
      case 'scepter':
        drawScepter(ctx, hx, hy, -270, false);
        break;
      case 'scepterOrb':
        drawScepter(ctx, hx + 18, hy, -262, true);
        break;
      case 'axe':
        drawAxe(ctx, hx, hy);
        break;
      case 'halberd':
        drawHalberd(ctx, hx, hy);
        break;
      case 'pennant':
        drawPennantSpear(ctx, hx, hy, pal);
        break;
      case 'arrow':
        drawArrow(ctx, hx, hy, pal);
        break;
      case 'torch':
        drawTorch(ctx, hx, hy);
        break;
      case 'caduceus':
        drawCaduceus(ctx, hx + 4, hy);
        break;
      case 'rose':
        drawStem(ctx, [[hx, hy], [hx + 10, hy - 40], [hx + 20, hy - 76]]);
        drawLeaf(ctx, hx + 9, hy - 36, 0.9);
        drawLeaf(ctx, hx + 11, hy - 48, -0.9);
        drawRose(ctx, hx + 20, hy - 84, C.red);
        break;
      case 'tulip':
        drawStem(ctx, [[hx, hy], [hx + 14, hy - 40], [hx + 20, hy - 74]]);
        drawLeaf(ctx, hx + 12, hy - 34, 0.7);
        drawTulip(ctx, hx + 20, hy - 88);
        break;
      case 'bouquet':
        drawStem(ctx, [[hx, hy], [hx - 4, hy - 40], [hx - 10, hy - 72]]);
        drawStem(ctx, [[hx, hy], [hx + 12, hy - 40], [hx + 26, hy - 64]]);
        drawStem(ctx, [[hx, hy], [hx + 6, hy - 50], [hx + 10, hy - 94]]);
        drawLeaf(ctx, hx + 2, hy - 30, -0.7);
        drawDaisy(ctx, hx - 10, hy - 76, 7, C.lace, C.gold);
        drawDaisy(ctx, hx + 28, hy - 66, 7, C.gold, C.red);
        drawRose(ctx, hx + 10, hy - 100, C.red);
        break;
      default:
        break;
    }
  }

  // --- Easter egg: a dama de chanel preto, tiara e fone (Qh) -------------------
  // Inspirada na garota de mangá da logo da Nous Research, mas desenhada no traço do baralho:
  // cabelo preto em chanel com franja reta e brilhos brancos, tiara branca com coroinha dourada,
  // um fone pequeno numa orelha, olhos grandes de anime olhando de lado e gola alta com plaquinha.

  const BOB = { hair: '#1D1D25', strand: '#474B63', shine: '#FFFDF6' };

  /** Brilho do cabelo: cunha branca afinando nas pontas, ao longo de `angle`. */
  function hairShine(ctx, x, y, len, width, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(-len / 2, 0);
    ctx.quadraticCurveTo(0, -width, len / 2, 0);
    ctx.quadraticCurveTo(0, width * 0.35, -len / 2, 0);
    ctx.closePath();
    ctx.fillStyle = BOB.shine;
    ctx.fill();
    ctx.restore();
  }

  function drawBobHairBack(ctx) {
    // Volume do chanel atrás da cabeça, com as pontas viradas para fora na altura do queixo.
    ctx.beginPath();
    ctx.moveTo(0, -268);
    ctx.bezierCurveTo(42, -268, 62, -242, 60, -204);
    ctx.bezierCurveTo(59, -180, 60, -164, 68, -154);
    ctx.quadraticCurveTo(82, -142, 96, -156);
    ctx.quadraticCurveTo(94, -130, 66, -130);
    ctx.quadraticCurveTo(44, -132, 30, -144);
    ctx.lineTo(-30, -144);
    ctx.quadraticCurveTo(-44, -132, -66, -130);
    ctx.quadraticCurveTo(-94, -130, -96, -156);
    ctx.quadraticCurveTo(-82, -142, -68, -154);
    ctx.bezierCurveTo(-60, -162, -59, -180, -60, -204);
    ctx.bezierCurveTo(-62, -242, -42, -268, 0, -268);
    ctx.closePath();
    paint(ctx, BOB.hair, 2.4);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = BOB.strand;
    ctx.lineWidth = 1.5;
    for (const s of [1, -1]) {
      for (const [x0, x1, y1] of [[50, 64, -140], [56, 76, -138]]) {
        ctx.beginPath();
        ctx.moveTo(s * x0, -214);
        ctx.bezierCurveTo(s * (x0 + 3), -186, s * (x0 + 2), -160, s * x1, y1);
        ctx.stroke();
      }
    }
    ctx.restore();
    // Brilhos nas laterais.
    for (const s of [1, -1]) {
      hairShine(ctx, s * 54, -190, 30, 5, s * 1.45);
      hairShine(ctx, s * 78, -137, 20, 4, s * -0.25);
    }
  }

  function drawHighCollar(ctx, pal) {
    // Gola alta creme que sobe pelo pescoço, com debrum azul-marinho e a plaquinha de copas.
    ctx.beginPath();
    ctx.moveTo(-20, -168);
    ctx.quadraticCurveTo(0, -162, 20, -168);
    ctx.lineTo(30, -140);
    ctx.quadraticCurveTo(0, -130, -30, -140);
    ctx.closePath();
    paint(ctx, C.lace, 2.2);
    ctx.beginPath();
    ctx.moveTo(-28, -146);
    ctx.quadraticCurveTo(0, -137, 28, -146);
    ctx.lineTo(30, -140);
    ctx.quadraticCurveTo(0, -130, -30, -140);
    ctx.closePath();
    paint(ctx, pal.band, 1.6);
    ctx.save();
    ctx.strokeStyle = 'rgba(27, 27, 31, 0.4)';
    ctx.lineWidth = 1;
    for (const x of [-12, 12]) {
      ctx.beginPath();
      ctx.moveTo(x * 1.05, -164);
      ctx.lineTo(x * 1.35, -144);
      ctx.stroke();
    }
    ctx.restore();
    // Plaquinha dourada com um coraçãozinho.
    ctx.save();
    ctx.translate(0, -151);
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.rect(-8, -8, 16, 16);
    ctx.restore();
    paint(ctx, C.gold, 1.8);
    pipPath(ctx, 'hearts', 0, -151, 5);
    ctx.fillStyle = C.red;
    ctx.fill();
  }

  function drawBobHead(ctx) {
    // Rosto delicado de queixo fino.
    ctx.beginPath();
    ctx.moveTo(0, -250);
    ctx.bezierCurveTo(24, -250, 36, -232, 36, -208);
    ctx.bezierCurveTo(36, -190, 29, -176, 17, -166);
    ctx.quadraticCurveTo(7, -158, 0, -158);
    ctx.quadraticCurveTo(-7, -158, -17, -166);
    ctx.bezierCurveTo(-29, -176, -36, -190, -36, -208);
    ctx.bezierCurveTo(-36, -232, -24, -250, 0, -250);
    ctx.closePath();
    paint(ctx, C.skin, 2.4);
  }

  function drawBobFace(ctx, pal) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of [1, -1]) {
      const g = ctx.createRadialGradient(s * 21, -181, 1, s * 21, -181, 10);
      g.addColorStop(0, C.blush);
      g.addColorStop(1, 'rgba(214, 96, 86, 0)');
      ctx.fillStyle = g;
      circle(ctx, s * 21, -181, 10);
      ctx.fill();
    }
    // Olhos grandes olhando de lado (as duas íris puxadas para +x).
    const look = 3.2;
    for (const s of [1, -1]) {
      const ex = s * 15;
      const ey = -199;
      ctx.beginPath();
      ctx.moveTo(ex - 11, ey - 1);
      ctx.bezierCurveTo(ex - 8, ey - 13, ex + 8, ey - 13, ex + 11, ey - 3);
      ctx.bezierCurveTo(ex + 9, ey + 9, ex - 8, ey + 10, ex - 11, ey - 1);
      ctx.closePath();
      paint(ctx, '#FFFFFF', 1.2);
      ctx.save();
      ctx.clip();
      const ix = ex + look;
      const g = ctx.createLinearGradient(0, ey - 10, 0, ey + 9);
      g.addColorStop(0, '#0B1226');
      g.addColorStop(0.6, pal.eye);
      g.addColorStop(1, '#4E7FC4');
      ellipse(ctx, ix, ey, 7.5, 9.5);
      ctx.fillStyle = g;
      ctx.fill();
      ellipse(ctx, ix + 0.4, ey - 0.5, 3.6, 5);
      ctx.fillStyle = '#070A14';
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#FFFFFF';
      ellipse(ctx, ix - 2.8, ey - 3.6, 2.8, 3.4);
      ctx.fill();
      circle(ctx, ix + 3, ey + 4, 1.4);
      ctx.fill();
      // Linha grossa dos cílios de cima, com dois cílios para fora.
      ctx.beginPath();
      ctx.moveTo(ex - s * 12, ey + 1);
      ctx.bezierCurveTo(ex - s * 9, ey - 14, ex + s * 8, ey - 15, ex + s * 12.5, ey - 4);
      ctx.lineTo(ex + s * 18, ey - 9);
      ctx.lineTo(ex + s * 14, ey - 2);
      ctx.lineTo(ex + s * 17, ey + 1);
      ctx.lineTo(ex + s * 11.5, ey - 1);
      ctx.bezierCurveTo(ex + s * 7, ey - 11, ex - s * 8, ey - 10, ex - s * 12, ey + 1);
      ctx.closePath();
      ctx.fillStyle = C.ink;
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = C.ink;
      ctx.stroke();
      // Dobra da pálpebra e cílio de baixo.
      ctx.beginPath();
      ctx.moveTo(ex - s * 7, ey - 15);
      ctx.quadraticCurveTo(ex + s * 3, ey - 18, ex + s * 10, ey - 12);
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ex - s * 2, ey + 8.5);
      ctx.quadraticCurveTo(ex + s * 6, ey + 7.5, ex + s * 10, ey + 3);
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }
    // Narizinho de um traço e boca pequena.
    ctx.beginPath();
    ctx.moveTo(2, -188);
    ctx.quadraticCurveTo(-1, -184, 1.5, -182);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-5, -171);
    ctx.quadraticCurveTo(0, -172.5, 5, -171);
    ctx.quadraticCurveTo(0, -166, -5, -171);
    ctx.closePath();
    paint(ctx, '#C23A44', 1.2);
    ctx.restore();
  }

  function drawBobBangs(ctx) {
    // Franja reta e cheia, cortada logo acima dos olhos, com mechinhas separadas na ponta.
    ctx.beginPath();
    ctx.moveTo(-39, -206);
    ctx.bezierCurveTo(-44, -246, -24, -268, 0, -268);
    ctx.bezierCurveTo(24, -268, 44, -246, 39, -206);
    const cut = [[33, -216], [30, -212], [24, -218], [19, -214], [13, -219], [7, -215], [1, -220], [-5, -215], [-11, -219], [-17, -214], [-23, -218], [-29, -212], [-33, -216]];
    for (const [x, y] of cut) ctx.lineTo(x, y);
    ctx.closePath();
    paint(ctx, BOB.hair, 2.2);
    // Mechas laterais que emolduram o rosto e viram para fora no queixo.
    for (const s of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(s * 38, -228);
      ctx.bezierCurveTo(s * 44, -200, s * 42, -176, s * 48, -158);
      ctx.quadraticCurveTo(s * 56, -148, s * 66, -150);
      ctx.quadraticCurveTo(s * 56, -138, s * 42, -146);
      ctx.bezierCurveTo(s * 34, -156, s * 30, -178, s * 30, -212);
      ctx.closePath();
      paint(ctx, BOB.hair, 2);
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = BOB.strand;
    ctx.lineWidth = 1.3;
    for (const x of [-20, 2, 22]) {
      ctx.beginPath();
      ctx.moveTo(x * 0.6, -262);
      ctx.quadraticCurveTo(x * 1.1, -244, x * 1.05, -224);
      ctx.stroke();
    }
    ctx.restore();
    // Anel de brilho na franja (o clássico reflexo de mangá): cunhas ao longo de uma elipse.
    for (let k = 0; k < 7; k++) {
      const t = Math.PI * (1.12 + k * 0.127);
      const x = Math.cos(t) * 33;
      const y = -214 + Math.sin(t) * 26;
      const tangent = Math.atan2(Math.cos(t) * 26, -Math.sin(t) * 33);
      hairShine(ctx, x, y, 13, 3.6, tangent + 1.25);
    }
    for (const s of [1, -1]) hairShine(ctx, s * 38, -190, 18, 3, s * 1.5);
  }

  function drawBobTiara(ctx, pal) {
    // Tiara branca fina por cima do cabelo.
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-44, -218);
    ctx.bezierCurveTo(-48, -276, 48, -276, 44, -218);
    ctx.lineWidth = 8;
    ctx.strokeStyle = C.ink;
    ctx.stroke();
    ctx.lineWidth = 4.6;
    ctx.strokeStyle = C.lace;
    ctx.stroke();
    ctx.restore();
    // Coroinha dourada presa na tiara (continua sendo dama).
    ctx.beginPath();
    ctx.moveTo(-15, -258);
    ctx.lineTo(-18, -276);
    ctx.lineTo(-8, -268);
    ctx.lineTo(0, -284);
    ctx.lineTo(8, -268);
    ctx.lineTo(18, -276);
    ctx.lineTo(15, -258);
    ctx.quadraticCurveTo(0, -262, -15, -258);
    ctx.closePath();
    paint(ctx, C.gold, 2);
    for (const [x, y, r] of [[-18, -276, 2.8], [0, -285, 3.4], [18, -276, 2.8]]) {
      circle(ctx, x, y, r);
      paint(ctx, C.lace, 1.2);
    }
    pipPath(ctx, 'hearts', 0, -266, 4.2);
    ctx.fillStyle = C.red;
    ctx.fill();
    // Fone de ouvido pequeno na orelha do lado de fora (a tiara faz de arco).
    ellipse(ctx, -45, -208, 9, 13);
    paint(ctx, pal.band, 2);
    ellipse(ctx, -45, -208, 5, 8.5);
    ctx.lineWidth = 2;
    ctx.strokeStyle = C.gold;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-45, -208, 6.5, 10.5, 0, Math.PI * 1.1, Math.PI * 1.45);
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.strokeStyle = C.lace;
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(-48, -225, 6, 6);
    paint(ctx, C.lace, 1.4);
  }

  /** Caduceu pequeno: bastão dourado, duas serpentes, asinhas e esfera no topo. */
  function drawCaduceus(ctx, x, y) {
    const bottom = y + 40;
    const top = y - 112;
    ctx.beginPath();
    ctx.rect(x - 3.5, top, 7, bottom - top);
    paint(ctx, C.gold, 1.8);
    // Serpentes (duas hélices defasadas).
    const y0 = y - 14;
    const y1 = top + 26;
    for (const phase of [0, Math.PI]) {
      const pts = [];
      for (let i = 0; i <= 32; i++) {
        const t = i / 32;
        const amp = 12 - t * 2;
        pts.push([x + Math.sin(phase + Math.PI / 2 + t * 1.5 * TAU) * amp, y0 + (y1 - y0) * t]);
      }
      outlinedStroke(ctx, pts, 4.2, C.leaf, 1.4);
      // Cabeças viradas uma para a outra, logo abaixo das asinhas.
      const [sx, sy] = pts[pts.length - 1];
      const dir = sx > x ? -1 : 1;
      ellipse(ctx, sx + dir * 3, sy - 3, 6, 4, dir * 0.5);
      paint(ctx, C.leaf, 1.4);
      circle(ctx, sx + dir * 5, sy - 4.5, 1.2);
      ctx.fillStyle = C.ink;
      ctx.fill();
    }
    // Asinhas no topo.
    for (const s of [1, -1]) {
      ctx.save();
      ctx.translate(x + s * 3, top + 8);
      ctx.scale(s, 1);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(12, -14, 26, -14);
      ctx.lineTo(20, -8);
      ctx.lineTo(25, -5);
      ctx.lineTo(17, -1);
      ctx.lineTo(20, 3);
      ctx.quadraticCurveTo(8, 5, 0, 0);
      ctx.closePath();
      paint(ctx, C.lace, 1.5);
      ctx.restore();
    }
    circle(ctx, x, top - 4, 7);
    paint(ctx, C.gold, 1.8);
    circle(ctx, x - 2, top - 6, 2);
    ctx.fillStyle = C.lace;
    ctx.fill();
  }

  function drawFigure(ctx, rank, pal, spec) {
    const [hx, hy] = HAND[rank];
    const behind = spec.object === 'swordBehind';
    const bob = !!spec.bob;

    if (rank === 'K') drawKingHairBack(ctx, pal);
    drawTorso(ctx, rank, pal);
    if (bob) drawBobHairBack(ctx);
    else if (rank === 'Q') drawQueenHair(ctx, pal);

    if (bob) {
      drawNeck(ctx);
      drawHighCollar(ctx, pal);
    } else if (rank === 'K') drawErmine(ctx);
    else if (rank === 'Q') drawRuff(ctx);
    else drawJackCollar(ctx, pal);

    if (behind) drawObject(ctx, spec.object, hx, hy, pal);

    if (bob) {
      drawBobHead(ctx);
      drawBobFace(ctx, pal);
      drawBobBangs(ctx);
      drawBobTiara(ctx, pal);
    } else {
      drawNeck(ctx);
      drawHead(ctx, rank);
      drawFaceFeatures(ctx, rank, pal);
      if (rank === 'K') {
        drawKingBeard(ctx, pal);
        drawKingHairFront(ctx, pal);
        drawKingCrown(ctx, pal);
      } else if (rank === 'Q') {
        drawQueenBangs(ctx, pal);
        drawQueenCrown(ctx, pal);
      } else {
        drawJackHair(ctx, pal);
        drawJackHat(ctx, pal);
      }
    }

    drawArm(ctx, pal, hx, hy);
    if (!behind) drawObject(ctx, spec.object, hx, hy, pal);
    drawHand(ctx, hx, hy);
  }

  function drawCourt(ctx, rank, suit) {
    const pal = COURT_PALETTES[suit];
    const spec = COURT_SPECS[rank + LETTER_BY_SUIT[suit]];
    const f = FRAME;
    const midY = f.y + f.h / 2;

    // Filete dourado externo.
    ctx.save();
    ctx.strokeStyle = C.brass;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(f.x - 6, f.y - 6, f.w + 12, f.h + 12);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(f.x, f.y, f.w, f.h);
    ctx.clip();
    ctx.fillStyle = C.paperHi;
    ctx.fillRect(f.x, f.y, f.w, f.h);

    for (let half = 0; half < 2; half++) {
      ctx.save();
      if (half === 1) {
        ctx.translate(W, H);
        ctx.rotate(Math.PI);
      }
      ctx.beginPath();
      ctx.rect(f.x, f.y, f.w, f.h / 2);
      ctx.clip();
      ctx.translate(W / 2, midY);
      ctx.save();
      if (spec.mirror) ctx.scale(-1, 1);
      ctx.lineJoin = 'round';
      drawFigure(ctx, rank, pal, spec);
      ctx.restore();
      // Pip da figura, do lado oposto ao objeto.
      const px = spec.mirror ? 124 : -124;
      drawPip(ctx, suit, px, -286, 22);
      ctx.restore();
    }
    ctx.restore();

    // Divisória e moldura.
    ctx.save();
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(f.x, midY);
    ctx.lineTo(f.x + f.w, midY);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeRect(f.x, f.y, f.w, f.h);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Verso
  // ---------------------------------------------------------------------------

  // Verso preto com o símbolo dos três quadrados vazados no centro. Os quadrados
  // são iguais, com o mesmo traço, e deslocados na diagonal em torno do centro
  // da carta: o desenho fica idêntico de cabeça para baixo.
  function drawBack(ctx) {
    const cx = W / 2;
    const cy = H / 2;

    ctx.fillStyle = C.backInk;
    ctx.fillRect(0, 0, W, H);
    const lift = ctx.createRadialGradient(cx, cy, 20, cx, cy, H * 0.7);
    lift.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
    lift.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = lift;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = paperPattern(ctx);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    const side = Math.round(W * 0.42);
    const offset = Math.round(side * 0.16);
    const stroke = Math.max(6, Math.round(side * 0.05));
    ctx.save();
    ctx.strokeStyle = C.backMark;
    ctx.lineWidth = stroke;
    ctx.lineJoin = 'miter';
    for (const k of [-1, 0, 1]) {
      const x = cx + k * offset - side / 2;
      const y = cy + k * offset - side / 2;
      ctx.strokeRect(x, y, side, side);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Montagem, cache e texturas
  // ---------------------------------------------------------------------------

  function parseCard(cardOrId) {
    let rank = null;
    let suit = null;
    if (cardOrId && typeof cardOrId === 'object') {
      if (cardOrId.rank && cardOrId.suit) {
        rank = String(cardOrId.rank).toUpperCase();
        suit = String(cardOrId.suit).toLowerCase();
      } else if (typeof cardOrId.id === 'string') {
        return parseCard(cardOrId.id);
      }
    } else if (typeof cardOrId === 'string' && cardOrId.length >= 2) {
      rank = cardOrId.slice(0, -1).toUpperCase();
      suit = SUIT_BY_LETTER[cardOrId.slice(-1).toLowerCase()] || null;
    }
    if (RANKS.indexOf(rank) < 0 || SUITS.indexOf(suit) < 0) {
      throw new Error('CardTex: carta inválida: ' + JSON.stringify(cardOrId));
    }
    return { id: rank + LETTER_BY_SUIT[suit], rank, suit };
  }

  function isHidden(cardOrId) {
    return cardOrId == null || (typeof cardOrId === 'object' && cardOrId.hidden === true);
  }

  function paintFace(ctx, card) {
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    roundRectPath(ctx, 0, 0, W, H, CORNER_R);
    ctx.clip();
    drawPaper(ctx);
    if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') drawCourt(ctx, card.rank, card.suit);
    else if (card.rank === 'A') drawAce(ctx, card.suit);
    else drawNumber(ctx, card.rank, card.suit);
    drawIndices(ctx, card.rank, card.suit);
    drawEdge(ctx);
    ctx.restore();
  }

  function paintBack(ctx) {
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    roundRectPath(ctx, 0, 0, W, H, CORNER_R);
    ctx.clip();
    drawBack(ctx);
    drawEdge(ctx);
    ctx.restore();
  }

  const BACK_KEY = 'back';
  const canvases = new Map();
  const textures = new Map();
  const staleKeys = new Map(); // key -> assinatura das fontes carregadas quando foi pintado
  let maxAnisotropy = 1;
  let readyPromise = null;
  let fontListener = false;
  let size = SIZES.high;

  /** Famílias das fontes das cartas já carregadas (declaradas E carregadas), como texto. */
  function fontSignature() {
    const fams = ['Barlow Condensed', 'Shrikhand'];
    const U = Truco.GfxUtil;
    if (U && U.loadedFamilies) {
      const loaded = U.loadedFamilies();
      return fams.filter((f) => loaded.has(f)).join('|');
    }
    return fams.filter((f) => hasLoadedFace(f)).join('|');
  }

  /** true só quando as famílias estão declaradas E carregadas (check() dá true sem nenhuma declarada). */
  function fontsAvailable() {
    if (typeof document === 'undefined' || !document.fonts) return true;
    return fontSignature() === 'Barlow Condensed|Shrikhand';
  }

  function paintKey(key, canvas) {
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    if (key === BACK_KEY) paintBack(ctx);
    else paintFace(ctx, parseCard(key));
    ctx.restore();
    if (fontsAvailable()) staleKeys.delete(key);
    else {
      staleKeys.set(key, fontSignature());
      watchFontLoads();
    }
  }

  function canvasFor(key) {
    let canvas = canvases.get(key);
    if (!canvas) {
      canvas = makeCanvas(size[0], size[1]);
      paintKey(key, canvas);
      canvases.set(key, canvas);
    }
    return canvas;
  }

  function textureFor(key) {
    let tex = textures.get(key);
    if (tex) return tex;
    const THREE = root.THREE;
    if (!THREE) throw new Error('CardTex: THREE não está carregado');
    tex = new THREE.CanvasTexture(canvasFor(key));
    tex.name = 'card:' + key;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = maxAnisotropy;
    tex.needsUpdate = true;
    textures.set(key, tex);
    return tex;
  }

  /** Repinta o que foi desenhado com outras fontes (mantém os mesmos objetos canvas e textura). */
  function refreshStale() {
    if (!staleKeys.size) return;
    const sig = fontSignature();
    for (const [key, painted] of Array.from(staleKeys)) {
      const canvas = canvases.get(key);
      if (!canvas) {
        staleKeys.delete(key);
        continue;
      }
      if (painted === sig) continue;
      try {
        paintKey(key, canvas);
      } catch (e) {
        report(e, 'redesenho da carta ' + key);
        staleKeys.delete(key);
        continue;
      }
      const tex = textures.get(key);
      if (tex) tex.needsUpdate = true;
    }
  }

  function report(err, where) {
    const U = Truco.GfxUtil;
    if (U && U.report) U.report(err, where);
    else if (root.console) root.console.error(where, err);
  }

  function watchFontLoads() {
    if (fontListener || typeof document === 'undefined' || !document.fonts || !document.fonts.addEventListener) return;
    fontListener = true;
    document.fonts.addEventListener('loadingdone', refreshStale);
  }

  /** Troca o tamanho dos desenhos (qualidade leve = 320×448) e recria as texturas na GPU. */
  function setQuality(q) {
    const next = q === 'low' ? SIZES.low : SIZES.high;
    if (next === size) return;
    size = next;
    canvases.forEach((canvas, key) => {
      canvas.width = size[0];
      canvas.height = size[1];
      paintKey(key, canvas);
      const tex = textures.get(key);
      if (tex) {
        // r159 aloca com texStorage2D (tamanho imutável): descarta e reenvia no tamanho novo.
        tex.dispose();
        tex.needsUpdate = true;
      }
    });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function loadFonts() {
    if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return Promise.resolve();
    const load = Promise.all(FONT_PROBES.map((f) => document.fonts.load(f, 'AKQJ234567 TrucAÍ')))
      .then((lists) => {
        // Se as regras @font-face ainda não foram registradas, espera o conjunto todo.
        if (lists.some((l) => !l || !l.length)) return document.fonts.ready;
        return null;
      })
      .catch(() => null);
    return Promise.race([load, delay(FONT_TIMEOUT_MS)]);
  }

  /** Chaves pré-geradas: o baralho limpo (padrão) e o verso; as do sujo saem sob demanda. */
  function pregenKeys() {
    const keys = [];
    for (const suit of SUITS) for (const rank of PREGEN_RANKS) keys.push(rank + LETTER_BY_SUIT[suit]);
    keys.push(BACK_KEY);
    return keys;
  }

  async function pregenerate() {
    if (!canvasSupported()) return;
    const withTextures = !!root.THREE;
    const keys = pregenKeys();
    for (let i = 0; i < keys.length; i++) {
      if (withTextures) textureFor(keys[i]);
      else canvasFor(keys[i]);
      // Cede o thread de vez em quando para não travar animações do menu.
      if (i % 6 === 5) await delay(0);
    }
  }

  function ready() {
    if (!readyPromise) {
      readyPromise = loadFonts()
        .then(() => {
          refreshStale();
          watchFontLoads();
          return pregenerate();
        })
        .then(() => undefined);
    }
    return readyPromise;
  }

  function keyOf(cardOrId) {
    return isHidden(cardOrId) ? BACK_KEY : parseCard(cardOrId).id;
  }

  function copyCanvas(source, opts) {
    const width = Math.max(1, Math.round((opts && opts.width) || source.width));
    const height = Math.round((width * H) / W);
    let src = source;
    // Reduções grandes em etapas de 1/2 para manter os traços nítidos.
    while (src.width / 2 >= width * 1.02) {
      const step = makeCanvas(Math.round(src.width / 2), Math.round(src.height / 2));
      const g = step.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, step.width, step.height);
      src = step;
    }
    const out = makeCanvas(width, height);
    const g = out.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, width, height);
    return out;
  }

  const CardTex = {
    WIDTH: W,
    HEIGHT: H,

    ready,

    /** Textura da face; carta encoberta ({hidden:true}) ou nula devolve o verso. */
    face(cardOrId) {
      return textureFor(keyOf(cardOrId));
    },

    back() {
      return textureFor(BACK_KEY);
    },

    /** Cópia nova do desenho da face (pode ir direto para o DOM); `opts.width` reduz. */
    faceCanvas(cardOrId, opts) {
      return copyCanvas(canvasFor(keyOf(cardOrId)), opts);
    },

    backCanvas(opts) {
      return copyCanvas(canvasFor(BACK_KEY), opts);
    },

    setQuality,

    setRenderer(renderer) {
      let max = 1;
      try {
        max = renderer && renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 1;
      } catch (e) {
        max = 1;
      }
      max = Math.max(1, max || 1);
      if (max === maxAnisotropy) return;
      maxAnisotropy = max;
      textures.forEach((tex) => {
        tex.anisotropy = maxAnisotropy;
        tex.needsUpdate = true;
      });
    },
  };

  Truco.CardTex = CardTex;
  if (typeof module === 'object' && module.exports) module.exports = CardTex;
})(typeof window !== 'undefined' ? window : globalThis);
