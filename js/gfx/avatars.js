/*
 * TrucAÍ — Truco.Avatars: os parceiros de mesa, estilizados e simpáticos (low-poly bem acabado).
 *
 *   Avatars.create(ctx, spec) -> { group, cardAnchor, headWorldPos(target?), act(kind) -> Promise,
 *                                  signal(gesto) -> Promise, lookAt(point|null), setTurn(bool),
 *                                  update(dt, t), dispose(), look }
 *   Avatars.resolveLook(spec)   (puro) visual resolvido: cabelo, rosto, roupa, acessórios e cores válidas
 *   Avatars.signalSteps(gesto, lado)  (puro) linha do tempo de um sinal
 *
 * Contrato em docs/SCENE-INTERNALS.md §5. Referencial local: +Z aponta para o centro da mesa,
 * +Y para cima, origem na altura do tampo (y = 0), cadeira atrás (desenhada pelo World).
 *
 * spec — dois formatos, que podem se misturar:
 *   antigo:  seat, name, shirt, skin, hair (cores '#hex'), style:
 *              'bigode' (careca com bigodão, camisa listrada)   'bone'  (boné, camisa de time)
 *              'coque'  (coque com óculos e brincos, blusa lisa) 'topete' (topete, camisa de time)
 *              ou só o cabelo: 'careca' | 'curto' | 'comprido' | 'black' | 'laterais'
 *            Sem style (nem hairStyle), o assento escolhe: 1 'bigode', 2 'coque', 3 'topete'.
 *   ficha (docs/PERSONAGENS.md, apêndice): seat, name, skin, hair, shirt, accent ('#hex'),
 *            hairStyle 'careca'|'curto'|'topete'|'coque'|'comprido'|'black'|'laterais'|'rabo-de-cavalo'
 *            face      'nenhum'|'bigode'|'bigodao'|'cavanhaque'|'barba' (barba cheia, com o bigode junto)
 *            accessory 'nenhum'|'bone'|'bone-frente'|'oculos'|'oculos-fino'|'chapeu-panama'|
 *                      'lapis-na-orelha'|'palito-na-boca', OU uma lista deles (ex.: ['bone-frente',
 *                      'oculos-fino']): um por grupo (cabeça: bone/bone-frente/chapeu-panama; rosto:
 *                      oculos/oculos-fino; vale o último), lápis e palito somam, 'nenhum' limpa.
 *            capColor  '#hex' (cor do boné; padrão = accent, senão derivada da camisa)
 *            capMark   'tres-quadrados' | null (marca branca na frente da copa do boné)
 *            earrings  true|false (brincos; sem o campo, o do estilo), lashes true|false (cílios)
 *            belly     0..1 (barriga; 0 = reto)
 *            outfit    'camisa-lisa'|'camisa-listrada'|'camisa-de-time'|'regata'|'camisa-social'|'avental'
 *            Com hairStyle, os padrões são os da ficha (curto, nenhum, camisa-lisa, nenhum); valor
 *            desconhecido cai no padrão. Acentos/maiúsculas são aceitos ('Chapéu-Panamá').
 *   pants: cor da calça (opcional).
 *
 * act(kind): 'idle' | 'shout' | 'think' | 'win' | 'lose' | 'nod' | 'shake' | 'play' | 'deal', ou o nome
 * de um sinal (vai para signal). signal(gesto): 'piscar' | 'levantar-sobrancelha' | 'bochecha-com-lingua'
 * | 'ponta-da-lingua' | 'levantar-ombro' | 'encher-bochechas' | 'cocar-nariz' (aceita 'coçar-nariz'):
 * ~1 s olhando para a câmera, com o lado do rosto virado para ela. Um act/sinal novo interrompe o
 * anterior (que resolve na hora); nenhum rejeita; gesto desconhecido resolve na hora.
 * ctx.tween (opcional): relógio de animação próprio no lugar do Truco.Tween (a prévia usa).
 */
(function (root) {
  'use strict';
  const Truco = (root.Truco = root.Truco || {});

  const LEAN = 0.18; // postura: debruçado sobre a mesa
  // Olhar: giro da cabeça limitado de forma assimétrica em relação à câmera (o rosto continua
  // visível): até GAZE.toward para o lado da câmera, até GAZE.away para o lado oposto; quem vê a
  // câmera de lado (os laterais) ainda puxa o giro GAZE.camBias na direção dela. A cabeça inclina
  // no máximo GAZE.pitchDown para baixo e o resto do olhar vai para as pupilas.
  const GAZE = Object.freeze({ toward: 1.1, away: 0.2, camBias: 0.35, pitchDown: 0.25, pitchUp: 0.45, camChance: 0.5 });
  const HIPS = [0, -2.45, -0.3]; // pivô do quadril no referencial do avatar
  const SHOULDER = [1.05, 4.62, 0.05]; // (x espelhado para o lado direito)
  const UPPER = 1.45;
  const FORE = 1.35;
  const HEAD_R = 0.78;
  const NECK_PIVOT = [0, 5.4, 0.06];
  const HEAD_C = [0, 0.74, 0.04]; // centro da cabeça a partir do pivô do pescoço
  const FAN = [0, 4.39, 1.49]; // base do leque (quadril) com a pose de repouso

  const CAP_TILT = -0.33; // boné para trás: a cúpula passa de −0,12 para −0,45 rad
  const PANAMA_TILT = -0.3; // chapéu também jogado para trás: a aba não esconde os olhos da câmera alta
  const HAIRS = ['careca', 'curto', 'topete', 'coque', 'comprido', 'black', 'laterais', 'rabo-de-cavalo'];
  const FACES = ['nenhum', 'bigode', 'bigodao', 'cavanhaque', 'barba'];
  const OUTFITS = ['lisa', 'listrada', 'time', 'regata', 'social', 'avental'];
  const ACCESSORIES = ['nenhum', 'bone', 'bone-frente', 'oculos', 'oculos-fino', 'chapeu-panama', 'lapis-na-orelha', 'palito-na-boca'];
  // Grupos que se excluem (um por grupo): cabeça (boné/chapéu) e rosto (óculos). Lápis e palito somam.
  const ACCESSORY_GROUP = Object.freeze({ bone: 'cabeca', 'bone-frente': 'cabeca', 'chapeu-panama': 'cabeca', oculos: 'rosto', 'oculos-fino': 'rosto' });
  const CAP_MARKS = ['tres-quadrados'];
  const SIGNALS = ['piscar', 'levantar-sobrancelha', 'bochecha-com-lingua', 'ponta-da-lingua', 'levantar-ombro', 'encher-bochechas', 'cocar-nariz'];
  // Nomes da ficha (docs/PERSONAGENS.md) → nome interno da roupa.
  const OUTFIT_ALIASES = Object.freeze({
    'camisa-lisa': 'lisa',
    'camisa-listrada': 'listrada',
    'camisa-de-time': 'time',
    'camisa-social': 'social',
    regata: 'regata',
    avental: 'avental',
  });
  const LOOKS = Object.freeze({
    bigode: { hair: 'careca', face: 'bigodao', outfit: 'listrada', belly: 1, glasses: false, cap: false, earrings: false },
    bone: { hair: 'curto', face: 'nenhum', outfit: 'time', belly: 0.3, glasses: false, cap: true, earrings: false },
    coque: { hair: 'coque', face: 'nenhum', outfit: 'lisa', belly: 0.4, glasses: true, cap: false, earrings: true },
    topete: { hair: 'topete', face: 'nenhum', outfit: 'time', belly: 0, glasses: false, cap: false, earrings: false },
  });
  // Padrões da ficha (docs/PERSONAGENS.md §3) quando o spec vem com hairStyle (formato novo).
  const FICHA_DEFAULT = Object.freeze({ hair: 'curto', face: 'nenhum', outfit: 'lisa', belly: 0.4 });
  const DEFAULT_STYLE_BY_SEAT = { 1: 'bigode', 2: 'coque', 3: 'topete' };
  const PANTS = ['#2e3a4f', '#4a3a2c', '#3a3a3e', '#2f3b33'];
  const DEFAULT_COLORS = Object.freeze({ skin: '#c68a5e', hair: '#2b1d14', shirt: '#2f5d8a' });

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function hash01(n) {
    const s = Math.sin(n * 91.345 + 17.17) * 43758.5453;
    return s - Math.floor(s);
  }

  /** 'Chapéu Panamá' → 'chapeu-panama' (sem acentos, minúsculas, espaços viram hífen). */
  function normKey(v) {
    if (typeof v !== 'string') return null;
    let s = v;
    try {
      s = s.normalize('NFD');
    } catch (e) {
      // normalize indisponível: segue sem tirar acentos.
    }
    return s.replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  }

  function normalizeOutfit(o) {
    const k = normKey(o);
    if (!k) return null;
    if (OUTFIT_ALIASES[k]) return OUTFIT_ALIASES[k];
    return OUTFITS.indexOf(k) >= 0 ? k : null;
  }

  function normalizeSignal(g) {
    const k = normKey(g);
    return k && SIGNALS.indexOf(k) >= 0 ? k : null;
  }

  /** '#abc' | '#aabbcc' | 0xaabbcc → '#aabbcc' (minúsculas); qualquer outra coisa → null. */
  function parseColor(v) {
    if (typeof v === 'number' && isFinite(v) && v >= 0 && v <= 0xffffff) return '#' + ('00000' + Math.floor(v).toString(16)).slice(-6);
    if (typeof v !== 'string') return null;
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
    if (!m) return null;
    let h = m[1].toLowerCase();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return '#' + h;
  }

  /**
   * Aplica UM acessório ao visual. Boné, boné para a frente e chapéu se excluem (cabeça); óculos e
   * óculos fino se excluem (rosto); lápis e palito somam; 'nenhum' tira todos.
   * 'bone-frente' liga cap + capFront; 'oculos-fino' liga glasses + glassesThin.
   */
  function applyAccessory(look, acc) {
    switch (acc) {
      case 'nenhum':
        look.cap = look.capFront = look.glasses = look.glassesThin = look.panama = look.pencil = look.toothpick = false;
        break;
      case 'bone':
      case 'bone-frente':
        look.cap = true;
        look.capFront = acc === 'bone-frente';
        look.panama = false;
        break;
      case 'chapeu-panama':
        look.panama = true;
        look.cap = look.capFront = false;
        break;
      case 'oculos':
      case 'oculos-fino':
        look.glasses = true;
        look.glassesThin = acc === 'oculos-fino';
        break;
      case 'lapis-na-orelha':
        look.pencil = true;
        break;
      case 'palito-na-boca':
        look.toothpick = true;
        break;
      default:
        return false;
    }
    look.accessory = acc;
    return true;
  }

  /** Lista dos acessórios ligados no visual (na ordem cabeça, rosto, orelha, boca). */
  function activeAccessories(look) {
    const out = [];
    if (look.cap) out.push(look.capFront ? 'bone-frente' : 'bone');
    if (look.panama) out.push('chapeu-panama');
    if (look.glasses) out.push(look.glassesThin ? 'oculos-fino' : 'oculos');
    if (look.pencil) out.push('lapis-na-orelha');
    if (look.toothpick) out.push('palito-na-boca');
    return out;
  }

  /**
   * Resolve o visual a partir do spec (puro, testável). Três entradas possíveis:
   *   - style antigo ('bigode'|'bone'|'coque'|'topete', ou só o cabelo) → visual pronto + sobreposições;
   *   - hairStyle (formato da ficha) → padrões da ficha (curto, sem rosto, camisa lisa, sem acessório);
   *   - nada disso → o estilo pronto do assento.
   * Valores desconhecidos nunca quebram: caem no padrão. Devolve também as cores já validadas.
   */
  function resolveLook(spec) {
    const o = spec || {};
    const style = typeof o.style === 'string' ? o.style.toLowerCase() : null;
    const hairStyle = normKey(o.hairStyle);
    const off = { glasses: false, glassesThin: false, cap: false, capFront: false, earrings: false, lashes: false, panama: false, pencil: false, toothpick: false };
    let look;
    if (style && LOOKS[style]) look = Object.assign({ style }, off, LOOKS[style]);
    else if (style && HAIRS.indexOf(style) >= 0) {
      look = Object.assign({ style, hair: style, face: style === 'careca' ? 'bigode' : 'nenhum', outfit: 'lisa', belly: 0.4 }, off);
    } else if (o.hairStyle !== undefined && o.hairStyle !== null) {
      look = Object.assign({ style: null }, off, FICHA_DEFAULT);
    } else {
      const s = DEFAULT_STYLE_BY_SEAT[o.seat] || 'bigode';
      look = Object.assign({ style: s }, off, LOOKS[s]);
    }
    if (hairStyle && HAIRS.indexOf(hairStyle) >= 0) look.hair = hairStyle;
    const face = normKey(o.face);
    if (face && FACES.indexOf(face) >= 0) look.face = face;
    const outfit = normalizeOutfit(o.outfit);
    if (outfit) look.outfit = outfit;
    look.accessory = look.cap ? 'bone' : look.glasses ? 'oculos' : 'nenhum';
    // accessory: string ou lista (cabeça + rosto + orelha/boca juntos), aplicados em ordem.
    const accs = Array.isArray(o.accessory) ? o.accessory : [o.accessory];
    for (const a of accs) applyAccessory(look, normKey(a));
    look.accessories = activeAccessories(look);
    const mark = normKey(o.capMark);
    look.capMark = mark && CAP_MARKS.indexOf(mark) >= 0 ? mark : null;
    if (typeof o.earrings === 'boolean') look.earrings = o.earrings;
    if (typeof o.lashes === 'boolean') look.lashes = o.lashes;
    if (typeof o.belly === 'number' && isFinite(o.belly)) look.belly = clamp(o.belly, 0, 1);
    const seat = typeof o.seat === 'number' ? o.seat : 0;
    look.colors = {
      skin: parseColor(o.skin) || DEFAULT_COLORS.skin,
      hair: parseColor(o.hair) || DEFAULT_COLORS.hair,
      shirt: parseColor(o.shirt) || DEFAULT_COLORS.shirt,
      accent: parseColor(o.accent),
      cap: parseColor(o.capColor), // null = derivada (accent, senão o contraste da camisa)
      pants: parseColor(o.pants) || PANTS[((seat % PANTS.length) + PANTS.length) % PANTS.length],
    };
    return look;
  }

  // ---------------------------------------------------------------------------
  // Pose: pesos animados pelos acts e sinais (todos com repouso definido)
  // ---------------------------------------------------------------------------

  const REST = Object.freeze({
    jump: 0,
    lean: 0,
    slump: 0,
    tilt: 0,
    nod: 0,
    shake: 0,
    mouth: 0,
    smile: 0.3,
    browUp: 0,
    browTilt: 0,
    squint: 0,
    rThink: 0,
    rShout: 0,
    rWin: 0,
    lWin: 0,
    rPlay: 0,
    deal: 0,
    jitter: 0,
    down: 0,
    lookUp: 0,
    // Sinais (P = lado +X do avatar, a esquerda dele; N = lado −X).
    winkP: 0,
    winkN: 0,
    browP: 0,
    browN: 0,
    cheekP: 0,
    cheekN: 0,
    shrugP: 0,
    shrugN: 0,
    tongue: 0,
    pucker: 0,
    mouthSide: 0,
    rNose: 0,
    scratch: 0,
  });
  const POSE_KEYS = Object.keys(REST);

  /**
   * Linha do tempo de um sinal (puro): lista de [props, duração, easing] para seq().
   * side = +1 ou −1: o lado do rosto que faz o gesto (o avatar escolhe o lado virado para a câmera).
   * Tudo bem exagerado: na câmera do jogo a cabeça da parceira tem ~80 px.
   */
  function signalSteps(name, side) {
    const s = side < 0 ? -1 : 1;
    const P = (base) => (s > 0 ? base + 'P' : base + 'N');
    const Q = (base) => (s > 0 ? base + 'N' : base + 'P');
    const o = (pairs) => {
      const r = {};
      for (let i = 0; i < pairs.length; i += 2) r[pairs[i]] = pairs[i + 1];
      return r;
    };
    switch (normalizeSignal(name)) {
      case 'piscar':
        return [
          [o([P('wink'), 1, P('brow'), -0.7, Q('brow'), 0.35, P('cheek'), 0.35, 'smile', 1, 'mouthSide', s * 0.8, 'tilt', -s * 0.14, 'nod', -0.04]), 0.16, 'outQuad'],
          [{}, 0.55],
          [REST, 0.3],
        ];
      case 'levantar-sobrancelha':
        return [
          [o([P('brow'), 2.2, Q('brow'), -0.5, 'tilt', s * 0.1, 'smile', 0.5, 'mouthSide', -s * 0.5, 'nod', -0.06]), 0.2, 'outBack'],
          [o([P('brow'), 1.7]), 0.18],
          [o([P('brow'), 2.2]), 0.18],
          [{}, 0.2],
          [REST, 0.3],
        ];
      case 'bochecha-com-lingua':
        return [
          [o([P('cheek'), 1.3, 'mouthSide', s * 0.55, 'smile', 0.12, 'pucker', 0.4, P('brow'), 0.7, 'squint', 0.2, 'tilt', s * 0.08]), 0.2, 'outBack'],
          [o([P('cheek'), 1.0]), 0.2],
          [o([P('cheek'), 1.3]), 0.2],
          [{}, 0.15],
          [REST, 0.3],
        ];
      case 'ponta-da-lingua':
        return [
          [o(['tongue', 1, 'mouth', 0.3, 'smile', 0.35, 'squint', 0.4, 'browUp', 0.4, 'mouthSide', s * 0.35, 'tilt', -s * 0.08]), 0.18, 'outBack'],
          [o(['tongue', 0.8]), 0.22],
          [o(['tongue', 1]), 0.22],
          [{}, 0.13],
          [REST, 0.3],
        ];
      case 'levantar-ombro':
        return [
          [o([P('shrug'), 1, 'tilt', -s * 0.24, 'smile', 0.4, P('brow'), 0.9, 'mouthSide', s * 0.45]), 0.22, 'outBack'],
          [o([P('shrug'), 0.9]), 0.25],
          [{}, 0.2],
          [REST, 0.33],
        ];
      case 'encher-bochechas':
        return [
          [{ cheekP: 1.2, cheekN: 1.2, pucker: 1, smile: 0, browUp: 0.7, nod: -0.05 }, 0.22, 'outBack'],
          [{ cheekP: 1.05, cheekN: 1.05 }, 0.22],
          [{ cheekP: 1.2, cheekN: 1.2 }, 0.22],
          [{ cheekP: 0, cheekN: 0, pucker: 0, mouth: 0.35 }, 0.12, 'outQuad'],
          [REST, 0.24],
        ];
      case 'cocar-nariz':
        return [
          [{ rNose: 1, squint: 0.35, browTilt: 0.3, smile: 0.1, nod: -0.05, tilt: 0.06 }, 0.3],
          [{ scratch: 1 }, 0.09],
          [{ scratch: 0 }, 0.09],
          [{ scratch: 1 }, 0.09],
          [{ scratch: 0 }, 0.09],
          [{ scratch: 1 }, 0.09],
          [{ scratch: 0 }, 0.09],
          [REST, 0.34],
        ];
      default:
        return null;
    }
  }

  /**
   * IK de dois ossos (ombro → cotovelo → punho). s, t, pole: [x, y, z]; a, b: comprimentos.
   * Escreve em out.elbow e out.wrist (o punho é aproximado do alvo se ele estiver fora de alcance).
   */
  function solveTwoBone(s, t, a, b, pole, out) {
    let dx = t[0] - s[0];
    let dy = t[1] - s[1];
    let dz = t[2] - s[2];
    let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-6) {
      dx = 0;
      dy = -1;
      dz = 0;
      d = 1;
    } else {
      dx /= d;
      dy /= d;
      dz /= d;
    }
    const dc = clamp(d, Math.abs(a - b) + 1e-4, a + b - 1e-4);
    const x = (a * a - b * b + dc * dc) / (2 * dc);
    const h = Math.sqrt(Math.max(0, a * a - x * x));
    let px = pole[0];
    let py = pole[1];
    let pz = pole[2];
    const dot = px * dx + py * dy + pz * dz;
    px -= dot * dx;
    py -= dot * dy;
    pz -= dot * dz;
    let pl = Math.sqrt(px * px + py * py + pz * pz);
    if (pl < 1e-6) {
      px = -dy;
      py = dx;
      pz = 0;
      pl = Math.sqrt(px * px + py * py) || 1;
    }
    px /= pl;
    py /= pl;
    pz /= pl;
    out.elbow[0] = s[0] + dx * x + px * h;
    out.elbow[1] = s[1] + dy * x + py * h;
    out.elbow[2] = s[2] + dz * x + pz * h;
    out.wrist[0] = s[0] + dx * dc;
    out.wrist[1] = s[1] + dy * dc;
    out.wrist[2] = s[2] + dz * dc;
    return out;
  }

  // ---------------------------------------------------------------------------
  // Geometria
  // ---------------------------------------------------------------------------

  function xf(THREE, x, y, z, rx, ry, rz, sx, sy, sz) {
    const s = sx == null ? 1 : sx;
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x || 0, y || 0, z || 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)),
      new THREE.Vector3(s, sy == null ? s : sy, sz == null ? s : sz)
    );
  }

  /** Junta partes (geometria + matriz + cor por vértice) numa geometria só. */
  function merge(THREE, parts) {
    let total = 0;
    const prepared = parts.map((p) => {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      if (p.m) g.applyMatrix4(p.m);
      total += g.attributes.position.count;
      return { g, c: p.c };
    });
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    const col = new Float32Array(total * 3);
    const c = new THREE.Color();
    let o = 0;
    for (const it of prepared) {
      const n = it.g.attributes.position.count;
      pos.set(it.g.attributes.position.array, o * 3);
      nor.set(it.g.attributes.normal.array, o * 3);
      if (it.g.attributes.uv) uv.set(it.g.attributes.uv.array, o * 2);
      c.set(it.c == null ? 0xffffff : it.c);
      for (let i = 0; i < n; i++) {
        col[(o + i) * 3] = c.r;
        col[(o + i) * 3 + 1] = c.g;
        col[(o + i) * 3 + 2] = c.b;
      }
      o += n;
      it.g.dispose();
    }
    parts.forEach((p) => p.geo.dispose());
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
  }

  function lathe(THREE, pts, seg, phiStart) {
    return new THREE.LatheGeometry(
      pts.map((p) => new THREE.Vector2(p[0], p[1])),
      seg,
      phiStart || 0
    );
  }

  /**
   * Aba curvada do boné para a frente, no referencial da copa (base da copa em y = 0, frente +Z;
   * copa = elipsoide de semieixos rx em X e rz em Z na base). Casca fechada (em cima, embaixo e a
   * borda), para servir com material de um lado só: da borda da copa até uma elipse maior na
   * frente, descendo (pitch) e com as laterais caindo.
   */
  function capBrim(THREE, rx, rz, low) {
    const nA = low ? 12 : 22; // ao longo da aba
    const nV = low ? 3 : 5; // da copa até a ponta
    const TH = 1.15; // ±66°
    const pitch = 0.34; // relativo à base da copa (que fica inclinada para trás): a aba fica quase na horizontal
    const thick = 0.05;
    const top = [];
    for (let i = 0; i <= nA; i++) {
      const a = -TH + (2 * TH * i) / nA;
      const s = Math.sin(a);
      const c = Math.cos(a);
      const inX = rx * 0.97 * s;
      const inZ = rz * 0.97 * c;
      const outX = rx * 1.05 * s;
      const outZ = (rz + 0.48) * c;
      for (let j = 0; j <= nV; j++) {
        const v = j / nV;
        const x = inX + (outX - inX) * v;
        const z = inZ + (outZ - inZ) * v;
        const d = Math.hypot(x - inX, z - inZ);
        const y = -d * Math.tan(pitch) - 0.17 * s * s * v - 0.03 * v * v;
        top.push([x, y, z]);
      }
    }
    const pos = [];
    const idx = [];
    const n = top.length;
    for (const p of top) pos.push(p[0], p[1], p[2]);
    for (const p of top) pos.push(p[0], p[1] - thick, p[2]);
    const at = (i, j) => i * (nV + 1) + j;
    for (let i = 0; i < nA; i++) {
      for (let j = 0; j < nV; j++) {
        const a = at(i, j);
        const b = at(i + 1, j);
        const c = at(i + 1, j + 1);
        const d = at(i, j + 1);
        idx.push(a, d, b, b, d, c); // em cima (normal para +Y)
        idx.push(n + a, n + b, n + d, n + b, n + c, n + d); // embaixo
      }
    }
    // Borda: contorno da grade (ponta, laterais e o lado da copa), ligando em cima e embaixo.
    const ring = [];
    for (let i = 0; i <= nA; i++) ring.push(at(i, nV));
    for (let j = nV - 1; j >= 0; j--) ring.push(at(nA, j));
    for (let i = nA - 1; i >= 0; i--) ring.push(at(i, 0));
    for (let j = 1; j < nV; j++) ring.push(at(0, j));
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      idx.push(a, b, n + a, b, n + b, n + a);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /** Raio do tronco na altura y (antes da escala 0,68 em Z), suave entre as chaves do perfil. */
  function torsoRadiusAt(belly, y) {
    const keys = [
      [-0.45, 0.0],
      [-0.4, 0.8],
      [0.2, 0.95],
      [1.2, 0.93 + belly * 0.16],
      [2.2, 0.91 + belly * 0.12],
      [3.2, 0.95],
      [4.0, 1.03],
      [4.55, 1.02],
      [4.95, 0.8],
      [5.15, 0.44],
      [5.24, 0.3],
      [5.26, 0.0],
    ];
    let k = 0;
    while (k < keys.length - 2 && keys[k + 1][0] < y) k++;
    const [y0, r0] = keys[k];
    const [y1, r1] = keys[k + 1];
    const t = clamp((y - y0) / (y1 - y0), 0, 1);
    const s = t * t * (3 - 2 * t);
    return Math.max(0, r0 + (r1 - r0) * s);
  }

  /** Perfil do tronco (raio por altura), amostrado em alturas uniformes para as listras ficarem retas. */
  function torsoProfile(belly) {
    const pts = [];
    const N = 22;
    for (let i = 0; i <= N; i++) {
      const y = -0.45 + (5.71 * i) / N;
      pts.push([torsoRadiusAt(belly, y), y]);
    }
    pts[0][0] = 0;
    pts[N][0] = 0;
    return pts;
  }

  // Altura do tronco ↔ linha do canvas da camisa (a lathe mapeia v uniforme em y; topo do canvas = topo).
  const TORSO_Y0 = -0.45;
  const TORSO_H = 5.71;
  const rowOf = (y, S) => ((TORSO_Y0 + TORSO_H - y) / TORSO_H) * S;

  // ---------------------------------------------------------------------------
  // Texturas da roupa (canvas pequeno por avatar)
  // ---------------------------------------------------------------------------

  function makeCanvas(w, h) {
    if (Truco.Table && Truco.Table.tex) return Truco.Table.tex.makeCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  const APRON = '#efe8d8'; // avental de padeiro (creme)

  function shirtCanvas(S, outfit, shirt, accent, seed, skin) {
    const c = makeCanvas(S, S);
    const g = c.getContext('2d');
    const k = S / 256;
    g.fillStyle = shirt;
    g.fillRect(0, 0, S, S);
    // Trama leve do tecido.
    let r = seed;
    const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 700; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
      g.fillRect(rnd() * S, rnd() * S, 2 * k, 1 * k);
    }
    const front = S / 2; // com phiStart = π, a frente fica no meio do canvas
    if (outfit === 'listrada') {
      g.fillStyle = accent;
      const n = 13;
      for (let i = 0; i < n; i++) {
        if (i % 2) g.fillRect(0, (i * S) / n, S, S / n);
      }
    }
    if (outfit === 'social') {
      // Risca de giz bem fina (a cor secundária, discreta).
      g.globalAlpha = 0.28;
      g.fillStyle = accent;
      for (let x = 3 * k; x < S; x += 9 * k) g.fillRect(x, 0, 1.2 * k, S);
      g.globalAlpha = 1;
    }
    if (outfit === 'regata') {
      // Canelado vertical, cavas e decote em U (pele), com viés na borda.
      g.fillStyle = 'rgba(0,0,0,0.09)';
      for (let x = 0; x < S; x += 4 * k) g.fillRect(x, 0, 1.5 * k, S);
      const edge = 'rgba(0,0,0,0.22)';
      const hole = (cx, cy, rx, ry) => {
        g.beginPath();
        g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        g.fillStyle = skin;
        g.fill();
        g.lineWidth = 3 * k;
        g.strokeStyle = edge;
        g.stroke();
      };
      g.fillStyle = skin;
      g.fillRect(0, 0, S, rowOf(5.1, S));
      const top = rowOf(5.1, S);
      hole(S * 0.25, top, S * 0.105, rowOf(3.85, S) - top); // cavas (lados)
      hole(S * 0.75, top, S * 0.105, rowOf(3.85, S) - top);
      hole(front, top, S * 0.085, rowOf(4.25, S) - top); // decote da frente
      hole(0, top, S * 0.07, rowOf(4.7, S) - top); // costas
      hole(S, top, S * 0.07, rowOf(4.7, S) - top);
      g.fillStyle = skin;
      g.fillRect(0, 0, S, top);
    } else if (outfit === 'time') {
      // Faixas laterais, gola V, escudo genérico e número nas costas.
      g.fillStyle = accent;
      g.fillRect(S * 0.24, 0, 10 * k, S);
      g.fillRect(S * 0.74, 0, 10 * k, S);
      g.beginPath();
      g.moveTo(front - 30 * k, 0);
      g.lineTo(front, 34 * k);
      g.lineTo(front + 30 * k, 0);
      g.lineWidth = 9 * k;
      g.strokeStyle = accent;
      g.stroke();
      const bx = front + 24 * k;
      const by = 58 * k;
      g.fillStyle = accent;
      g.beginPath();
      g.moveTo(bx - 9 * k, by - 10 * k);
      g.lineTo(bx + 9 * k, by - 10 * k);
      g.lineTo(bx + 9 * k, by + 2 * k);
      g.quadraticCurveTo(bx, by + 14 * k, bx - 9 * k, by + 2 * k);
      g.closePath();
      g.fill();
      g.fillStyle = shirt;
      g.beginPath();
      g.arc(bx, by - 2 * k, 3.5 * k, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = accent;
      g.font = '700 ' + Math.round(64 * k) + 'px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('10', 0, 92 * k);
      g.fillText('10', S, 92 * k);
    } else if (outfit === 'social') {
      // Carcela larga com seis botões e bolso com lapela no peito.
      g.fillStyle = 'rgba(255,255,255,0.1)';
      g.fillRect(front - 6 * k, 0, 12 * k, S * 0.8);
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.fillRect(front - 6.5 * k, 0, 1.2 * k, S * 0.8);
      g.fillRect(front + 5.5 * k, 0, 1.2 * k, S * 0.8);
      for (let i = 0; i < 6; i++) {
        const y = (18 + i * 27) * k;
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.beginPath();
        g.arc(front, y + 0.8 * k, 3.2 * k, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#f4f1ea';
        g.beginPath();
        g.arc(front, y, 3 * k, 0, Math.PI * 2);
        g.fill();
      }
      const px = front + 16 * k;
      g.fillStyle = 'rgba(0,0,0,0.1)';
      g.fillRect(px, 46 * k, 30 * k, 30 * k);
      g.strokeStyle = 'rgba(0,0,0,0.3)';
      g.lineWidth = 2 * k;
      g.strokeRect(px, 46 * k, 30 * k, 30 * k);
      g.beginPath();
      g.moveTo(px, 46 * k);
      g.lineTo(px + 15 * k, 56 * k);
      g.lineTo(px + 30 * k, 46 * k);
      g.stroke();
    } else {
      // Carcela com botões e bolso no peito.
      g.fillStyle = 'rgba(0,0,0,0.14)';
      g.fillRect(front - 4 * k, 0, 8 * k, S * 0.7);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      for (let i = 0; i < 5; i++) {
        g.beginPath();
        g.arc(front, (20 + i * 30) * k, 2.6 * k, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = 'rgba(0,0,0,0.22)';
      g.lineWidth = 2 * k;
      g.strokeRect(front + 18 * k, 44 * k, 26 * k, 28 * k);
    }
    if (outfit === 'avental') {
      // Alça do pescoço (dos cantos do peitilho até a nuca) e cordão da cintura com laço atrás.
      g.strokeStyle = APRON;
      g.lineCap = 'round';
      g.lineWidth = 7 * k;
      const bibTop = rowOf(3.95, S);
      for (const sx of [-1, 1]) {
        g.beginPath();
        g.moveTo(front + sx * S * 0.075, bibTop + 3 * k);
        g.quadraticCurveTo(front + sx * S * 0.12, rowOf(4.7, S), front + sx * S * 0.2, rowOf(5.2, S));
        g.stroke();
      }
      g.lineWidth = 6 * k;
      g.beginPath();
      g.moveTo(0, rowOf(5.08, S));
      g.lineTo(S, rowOf(5.08, S));
      g.stroke();
      const waist = rowOf(2.2, S);
      g.fillStyle = APRON;
      g.fillRect(0, waist - 3 * k, S, 6 * k);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(0, waist + 3 * k, S, 1.2 * k);
      // Laço nas costas (bordas do canvas).
      g.fillStyle = APRON;
      for (const x of [0, S]) {
        g.beginPath();
        g.ellipse(x, waist, 12 * k, 7 * k, 0, 0, Math.PI * 2);
        g.fill();
        g.fillRect(x - 3 * k, waist, 6 * k, 30 * k);
      }
    }
    // Sombra suave na barra da camisa.
    const grd = g.createLinearGradient(0, S, 0, S * 0.85);
    grd.addColorStop(0, 'rgba(0,0,0,0.25)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, S * 0.85, S, S * 0.15);
    return c;
  }

  /** Tecido do avental: creme com pesponto na barra, bolso duplo e um tico de farinha. */
  function apronCanvas(S, seed) {
    const c = makeCanvas(S, S);
    const g = c.getContext('2d');
    const k = S / 256;
    g.fillStyle = APRON;
    g.fillRect(0, 0, S, S);
    let r = seed;
    const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(90,70,40,0.06)' : 'rgba(255,255,255,0.3)';
      g.fillRect(rnd() * S, rnd() * S, 2 * k, 1 * k);
    }
    for (let i = 0; i < 14; i++) {
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath();
      g.arc(S * (0.3 + rnd() * 0.4), S * (0.45 + rnd() * 0.3), (3 + rnd() * 7) * k, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(80,60,30,0.35)';
    g.lineWidth = 1.6 * k;
    g.setLineDash([5 * k, 4 * k]);
    g.strokeRect(6 * k, 6 * k, S - 12 * k, S - 12 * k);
    // Bolso (v de 0,5 a 1,4 no avental: parte de baixo do canvas), dividido ao meio.
    const pt = S * 0.62;
    const pb = S * 0.84;
    g.setLineDash([]);
    g.fillStyle = 'rgba(0,0,0,0.05)';
    g.fillRect(S * 0.2, pt, S * 0.6, pb - pt);
    g.strokeStyle = 'rgba(80,60,30,0.45)';
    g.lineWidth = 2.4 * k;
    g.strokeRect(S * 0.2, pt, S * 0.6, pb - pt);
    g.setLineDash([5 * k, 4 * k]);
    g.lineWidth = 1.6 * k;
    g.beginPath();
    g.moveTo(S * 0.5, pt);
    g.lineTo(S * 0.5, pb);
    g.moveTo(S * 0.2, pt + 5 * k);
    g.lineTo(S * 0.8, pt + 5 * k);
    g.stroke();
    g.setLineDash([]);
    return c;
  }

  // ---------------------------------------------------------------------------
  // Avatar
  // ---------------------------------------------------------------------------

  function create(ctx, opts) {
    const THREE = ctx.THREE;
    // ctx.tween: relógio próprio (a prévia da tela de criação não pode mexer no Tween global da mesa).
    const Tween = ctx.tween || Truco.Tween;
    const o = opts || {};
    const seat = o.seat || 0;
    const low = ctx.quality === 'low';
    const seg = low ? 12 : 22;
    const look = resolveLook(o);
    const disposables = [];
    const track = (x) => {
      disposables.push(x);
      return x;
    };

    const C = look.colors;
    const skinC = new THREE.Color(C.skin);
    const hairC = new THREE.Color(C.hair);
    const shirtC = new THREE.Color(C.shirt);
    const lum = shirtC.r * 0.3 + shirtC.g * 0.59 + shirtC.b * 0.11;
    const accentC = C.accent
      ? new THREE.Color(C.accent)
      : look.outfit === 'listrada'
        ? shirtC.clone().lerp(new THREE.Color(0xf4efe4), 0.72)
        : lum < 0.25
          ? new THREE.Color(0xf2efe6)
          : new THREE.Color(0x1d1d24);
    const pantsC = new THREE.Color(C.pants);
    const noseC = skinC.clone().lerp(new THREE.Color(0xd06a5a), 0.18);
    const blushC = skinC.clone().lerp(new THREE.Color(0xff7a78), 0.32);
    const lipC = skinC.clone().multiplyScalar(0.45).lerp(new THREE.Color(0x6a2020), 0.5);
    const capC = C.cap ? new THREE.Color(C.cap) : C.accent ? accentC.clone() : shirtC.clone().offsetHSL(0.5, 0, 0).lerp(new THREE.Color(0x202028), 0.25);
    const bare = look.outfit === 'regata'; // braços de fora

    const skinMat = track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: look.hair === 'careca' ? 0.42 : 0.58, metalness: 0 }));
    const hairMat = track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: look.hair === 'topete' ? 0.38 : 0.78, metalness: 0 }));
    const clothMat = track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }));
    const shirtTex = track(
      new THREE.CanvasTexture(shirtCanvas(low ? 128 : 256, look.outfit, '#' + shirtC.getHexString(), '#' + accentC.getHexString(), 1 + seat * 977, '#' + skinC.getHexString()))
    );
    shirtTex.colorSpace = THREE.SRGBColorSpace;
    shirtTex.anisotropy = 4;
    const shirtMat = track(new THREE.MeshStandardMaterial({ map: shirtTex, roughness: 0.82, metalness: 0 }));
    // Manga: cor por vértice (a da camisa e o punho de outra cor); a listrada usa a mesma textura do tronco.
    const striped = look.outfit === 'listrada';
    const sleeveMat = bare ? skinMat : track(new THREE.MeshStandardMaterial({ vertexColors: true, map: striped ? shirtTex : null, roughness: 0.82 }));
    const sleeveC = bare ? skinC : striped ? new THREE.Color(0xffffff) : shirtC;
    const eyeWhiteMat = track(new THREE.MeshStandardMaterial({ color: 0xfbf8f2, roughness: 0.25, metalness: 0 }));
    const pupilMat = track(new THREE.MeshStandardMaterial({ color: 0x1c130e, roughness: 0.2, metalness: 0 }));
    const sparkMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const mouthMat = track(new THREE.MeshStandardMaterial({ color: lipC, roughness: 0.5 }));
    const mouthInMat = track(new THREE.MeshStandardMaterial({ color: 0x3a1210, roughness: 0.6 }));
    const browMat = track(new THREE.MeshStandardMaterial({ color: hairC.clone().multiplyScalar(0.85), roughness: 0.8 }));
    // Peças pequenas (lápis, palito, chapéu, língua): cor por vértice.
    const propMat = track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 }));
    const tongueMat = track(new THREE.MeshStandardMaterial({ color: 0xe8707e, roughness: 0.35, metalness: 0 }));

    // Com a aba do boné para a frente, a cabeça quase não abaixa (a aba esconderia os olhos da câmera).
    const pitchDown = look.capFront ? 0.06 : GAZE.pitchDown;
    // Lado virado para a câmera do humano (+1 = +X local, a esquerda do avatar); frente a frente: +1.
    const toHumanX = -Math.sin(o.facing || 0);
    const camSide = toHumanX < -0.3 ? -1 : 1;

    const group = new THREE.Group();
    group.name = 'avatar-' + seat;
    if (o.position) group.position.copy(o.position);
    group.rotation.y = o.facing || 0;
    const baseY = group.position.y;

    const mk = (geo, mat, cast) => {
      const m = new THREE.Mesh(track(geo), mat);
      m.castShadow = !!cast;
      m.receiveShadow = true;
      return m;
    };

    // ------------------------------------------------------------------ pernas (fixas, sob a mesa)
    {
      const parts = [];
      for (const sx of [-0.43, 0.43]) {
        parts.push({ geo: new THREE.CapsuleGeometry(0.36, 1.25, 4, 10), m: xf(THREE, sx, -2.62, 0.62, Math.PI / 2 - 0.04, 0, 0), c: pantsC });
        parts.push({ geo: new THREE.CapsuleGeometry(0.28, 4.0, 4, 10), m: xf(THREE, sx * 1.04, -4.75, 1.42, 0.05, 0, 0), c: pantsC });
        parts.push({ geo: new THREE.SphereGeometry(0.34, 12, 8), m: xf(THREE, sx * 1.04, -7.13, 1.68, 0, 0, 0, 0.95, 0.62, 1.55), c: '#2a211b' });
      }
      group.add(mk(merge(THREE, parts), clothMat, false));
    }

    // ------------------------------------------------------------------ tronco
    const hips = new THREE.Group();
    hips.position.fromArray(HIPS);
    group.add(hips);
    const torso = mk(lathe(THREE, torsoProfile(look.belly), low ? 16 : 28, Math.PI), shirtMat, true);
    torso.scale.set(1, 1, 0.68);
    hips.add(torso);
    {
      // Pescoço e gola (aro e pontas da camisa/blusa, ou gola V da camisa de time) numa peça só.
      // Regata: sem gola (o decote e as cavas estão pintados na textura). Social: colarinho em pé
      // com pontas maiores.
      const parts = [{ geo: new THREE.CylinderGeometry(0.27, 0.3, 0.8, 14), m: xf(THREE, 0, 5.35, 0.04), c: skinC }];
      if (!bare) {
        parts.push({ geo: new THREE.TorusGeometry(0.36, 0.075, 8, 22), m: xf(THREE, 0, 5.14, 0.02, Math.PI / 2 - 0.12, 0, 0, 1, 1, 0.8), c: look.outfit === 'time' ? accentC : shirtC.clone().multiplyScalar(0.82) });
      }
      if (look.outfit === 'social') {
        const collarC = shirtC.clone().lerp(new THREE.Color(0xffffff), 0.12);
        parts.push({ geo: new THREE.CylinderGeometry(0.33, 0.38, 0.26, 22, 1, true), m: xf(THREE, 0, 5.24, 0.0, -0.12, 0, 0, 1, 1, 0.82), c: collarC });
        for (const sx of [-1, 1]) {
          parts.push({ geo: new THREE.BoxGeometry(0.4, 0.05, 0.36), m: xf(THREE, sx * 0.21, 5.07, 0.38, 0.62, sx * 0.42, sx * -0.34), c: collarC });
        }
      } else if (look.outfit !== 'time' && !bare) {
        for (const sx of [-1, 1]) {
          parts.push({ geo: new THREE.BoxGeometry(0.34, 0.05, 0.3), m: xf(THREE, sx * 0.2, 5.05, 0.36, 0.5, sx * 0.4, sx * -0.3), c: look.outfit === 'listrada' ? accentC : shirtC.clone().multiplyScalar(0.9) });
        }
      }
      hips.add(mk(merge(THREE, parts), clothMat, false));
    }
    if (look.outfit === 'avental') {
      // Avental por cima da camisa: casca um pouco maior que o tronco, só na frente, com o peitilho
      // mais estreito que a saia. Filho do tronco (acompanha a respiração e a escala em Z).
      const W = 0.62;
      const pts = [];
      const N = 14;
      for (let i = 0; i <= N; i++) {
        const y = -0.3 + (4.25 * i) / N;
        pts.push(new THREE.Vector2(torsoRadiusAt(look.belly, y) + 0.05, y));
      }
      const geo = new THREE.LatheGeometry(pts, low ? 8 : 14, -W, 2 * W);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const rr = Math.hypot(x, z);
        const t = clamp((y - 2.0) / 0.6, 0, 1);
        const w = 0.98 + (0.52 - 0.98) * t * t * (3 - 2 * t); // saia larga → peitilho estreito
        const phi = (Math.atan2(x, z) / W) * w;
        pos.setXYZ(i, Math.sin(phi) * rr, y, Math.cos(phi) * rr);
      }
      geo.computeVertexNormals();
      const apronTex = track(new THREE.CanvasTexture(apronCanvas(low ? 128 : 256, 7 + seat * 131)));
      apronTex.colorSpace = THREE.SRGBColorSpace;
      apronTex.anisotropy = 4;
      const apronMat = track(new THREE.MeshStandardMaterial({ map: apronTex, roughness: 0.9, metalness: 0 }));
      torso.add(mk(geo, apronMat, true));
    }

    // ------------------------------------------------------------------ cabeça
    const headPivot = new THREE.Group();
    headPivot.position.fromArray(NECK_PIVOT);
    hips.add(headPivot);
    const head = new THREE.Group();
    head.position.fromArray(HEAD_C);
    headPivot.add(head);
    {
      const parts = [
        { geo: new THREE.SphereGeometry(HEAD_R, seg + 6, seg), m: xf(THREE, 0, 0, 0, 0, 0, 0, 1, 1.03, 0.97), c: skinC },
        { geo: new THREE.SphereGeometry(0.16, 12, 10), m: xf(THREE, 0, -0.08, HEAD_R * 0.97, 0, 0, 0, 1, 0.92, 0.95), c: noseC },
      ];
      for (const sx of [-1, 1]) {
        parts.push({ geo: new THREE.SphereGeometry(0.2, 12, 10), m: xf(THREE, sx * HEAD_R * 0.98, 0.0, -0.04, 0, 0, 0, 0.45, 0.95, 0.75), c: skinC });
        parts.push({ geo: new THREE.SphereGeometry(0.15, 10, 8), m: xf(THREE, sx * 0.44, -0.2, 0.6, 0, sx * 0.55, 0, 1, 0.7, 0.4), c: blushC });
      }
      head.add(mk(merge(THREE, parts), skinMat, true));
    }
    // Olhos (brancos, pupilas com brilho): um grupo por olho, para piscar um só (sinal 'piscar').
    // eyes[0] é o do lado −X, eyes[1] o do lado +X (mesma ordem de brows e cheeks).
    const eyes = [];
    const pupils = [];
    for (const sx of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(sx * 0.27, 0.12, 0);
      head.add(eye);
      eye.add(mk(merge(THREE, [{ geo: new THREE.SphereGeometry(0.165, 16, 12), m: xf(THREE, 0, 0, 0.66, 0, 0, 0, 1, 1.14, 0.62) }]), eyeWhiteMat, false));
      const pu = new THREE.Group();
      pu.add(mk(merge(THREE, [{ geo: new THREE.SphereGeometry(0.095, 12, 10), m: xf(THREE, 0, -0.01, 0.745, 0, 0, 0, 1, 1.1, 0.5) }]), pupilMat, false));
      pu.add(mk(merge(THREE, [{ geo: new THREE.SphereGeometry(0.03, 6, 5), m: xf(THREE, 0.03, 0.035, 0.79) }]), sparkMat, false));
      eye.add(pu);
      if (look.lashes) {
        // Cílios: dois traços grossos no canto de fora, de cima (fecham junto com a pálpebra).
        const Lh = [];
        for (const [ang, len] of [[0.55, 0.11], [0.95, 0.09]]) {
          const px = sx * 0.165 * Math.sin(ang);
          const py = 0.188 * Math.cos(ang);
          Lh.push({ geo: new THREE.CapsuleGeometry(0.02, len, 3, 6), m: xf(THREE, px + sx * 0.03, py + 0.03, 0.7, 0.35, 0, -sx * (ang + 0.25)) });
        }
        eye.add(mk(merge(THREE, Lh), pupilMat, false));
      }
      eyes.push(eye);
      pupils.push(pu);
    }
    const brows = [-1, 1].map((sx) => {
      const b = mk(new THREE.CapsuleGeometry(0.045, 0.2, 3, 8), browMat, false);
      b.rotation.z = Math.PI / 2;
      b.position.set(sx * 0.28, 0.4, 0.64);
      head.add(b);
      return b;
    });
    // Boca: arco (sorriso/bico) e boca aberta.
    const smileArc = Math.PI * 0.78;
    const smile = mk(new THREE.TorusGeometry(0.19, 0.034, 6, 16, smileArc), mouthMat, false);
    smile.position.set(0, -0.36, 0.7);
    head.add(smile);
    const open = mk(new THREE.SphereGeometry(0.17, 16, 10), mouthInMat, false);
    open.position.set(0, -0.4, 0.66);
    head.add(open);
    // Sinais: bochechas estufadas (uma ou as duas) e a pontinha da língua; escondidas em repouso.
    const cheekGeo = track(merge(THREE, [{ geo: new THREE.SphereGeometry(0.25, 16, 12), c: skinC.clone().lerp(blushC, 0.7) }]));
    const cheeks = [-1, 1].map((sx) => {
      const m = new THREE.Mesh(cheekGeo, skinMat);
      m.position.set(sx * 0.42, -0.24, 0.5);
      m.visible = false;
      head.add(m);
      return m;
    });
    const tongue = mk(new THREE.SphereGeometry(0.13, 14, 10), tongueMat, false);
    tongue.visible = false;
    head.add(tongue);

    // Cabelo, bigode/barba, boné, chapéu, óculos, brincos, lápis e palito.
    const hatted = look.cap || look.panama;
    // Com chapéu/boné, o black fica mais baixo (espremido) e o chapéu cresce para caber por cima dele.
    const hatFit = look.hair === 'black' ? { s: 1.2, lift: 0.1 } : null;
    const fitM = (tiltX, m) => {
      const out = new THREE.Matrix4().makeRotationX(tiltX);
      if (hatFit) out.multiply(new THREE.Matrix4().makeTranslation(0, hatFit.lift, -0.04)).multiply(new THREE.Matrix4().makeScale(hatFit.s, hatFit.s, hatFit.s));
      return out.multiply(m);
    };
    // Boné numa peça à parte: sobe junto com as sobrancelhas (o gesto continua legível sob a aba).
    let capMesh = null;
    {
      const H = [];
      const Cp = [];
      const hc = hairC;
      const capPart = (theta, rx, s) => ({ geo: new THREE.SphereGeometry(HEAD_R * 1.05, seg + 4, seg, 0, Math.PI * 2, 0, theta), m: xf(THREE, 0, 0.02, -0.02, rx, 0, 0, s[0], s[1], s[2]), c: hc });
      const hairStyle = look.hair;
      if (hairStyle === 'careca') {
        const ring = new THREE.TorusGeometry(HEAD_R * 0.92, 0.13, 8, 26, Math.PI * 1.22);
        H.push({ geo: ring, m: xf(THREE, 0, -0.08, -0.06, Math.PI / 2 + 0.25, 0, Math.PI * 0.89, 1, 1.05, 1), c: hc });
      } else if (hairStyle === 'black') {
        // Black power: volume alto e para trás, com a linha do cabelo na testa (o rosto fica livre).
        // Com boné/chapéu, fica mais baixo e mais largo, saindo por baixo da aba.
        const afro = new THREE.IcosahedronGeometry(1.05, low ? 2 : 3);
        if (hatted) H.push({ geo: afro, m: xf(THREE, 0, 0.3, -0.3, 0, 0, 0, 1.08, 0.62, 0.9), c: hc });
        else H.push({ geo: afro, m: xf(THREE, 0, 0.45, -0.3, 0, 0, 0, 1.05, 0.85, 0.9), c: hc });
      } else if (hairStyle === 'laterais') {
        for (const sx of [-1, 1]) H.push({ geo: new THREE.SphereGeometry(0.34, 12, 8), m: xf(THREE, sx * 0.62, 0.05, -0.18, 0, 0, 0, 0.55, 0.9, 1.2), c: hc });
      } else {
        // Com boné/chapéu, só o cabelo que aparece por baixo da aba (nuca e costeletas).
        if (!hatted) H.push(capPart(Math.PI * 0.5, -0.42, [1.0, 1.02, 1.02]));
        const backFrom = hatted ? 0.36 : 0.15;
        H.push({ geo: new THREE.SphereGeometry(HEAD_R * 1.04, seg + 4, seg, Math.PI * 1.12, Math.PI * 0.76, Math.PI * backFrom, Math.PI * (0.7 - backFrom)), m: xf(THREE, 0, 0.02, -0.02), c: hc });
        for (const sx of [-1, 1]) H.push({ geo: new THREE.CapsuleGeometry(0.08, 0.26, 3, 6), m: xf(THREE, sx * 0.72, -0.05, 0.12, 0, 0, sx * 0.12), c: hc });
        if (hairStyle === 'coque') {
          if (hatted) {
            // Coque baixo, na nuca, por baixo da aba.
            H.push({ geo: new THREE.SphereGeometry(0.3, 16, 12), m: xf(THREE, 0, -0.08, -0.9), c: hc });
            H.push({ geo: new THREE.TorusGeometry(0.19, 0.05, 6, 16), m: xf(THREE, 0, -0.06, -0.72, 0.15, 0, 0), c: '#b3261e' });
          } else {
            H.push({ geo: new THREE.SphereGeometry(0.33, 16, 12), m: xf(THREE, 0, 0.72, -0.5), c: hc });
            H.push({ geo: new THREE.TorusGeometry(0.2, 0.05, 6, 16), m: xf(THREE, 0, 0.6, -0.4, 1.0, 0, 0), c: '#b3261e' });
          }
        } else if (hairStyle === 'topete' && !hatted) {
          // Topete: onda alta caindo para a frente, com a ponta sobre a testa (some debaixo do chapéu).
          H.push({ geo: new THREE.SphereGeometry(1, 18, 12), m: xf(THREE, 0.02, 0.7, 0.4, -0.5, 0, 0.06, 0.5, 0.28, 0.46), c: hc });
          H.push({ geo: new THREE.SphereGeometry(1, 16, 10), m: xf(THREE, 0.06, 0.74, 0.74, 0.35, 0, 0.1, 0.38, 0.19, 0.26), c: hc });
        } else if (hairStyle === 'topete' && !look.capFront) {
          // Debaixo do chapéu, só uma franjinha para o lado.
          H.push({ geo: new THREE.SphereGeometry(1, 14, 10), m: xf(THREE, 0.1, 0.36, 0.64, 0.5, 0, 0.25, 0.34, 0.12, 0.2), c: hc });
        } else if (hairStyle === 'comprido') {
          H.push({ geo: new THREE.CapsuleGeometry(0.62, 0.9, 4, 12), m: xf(THREE, 0, -0.35, -0.32, 0.1, 0, 0, 1.18, 1, 0.62), c: hc });
        } else if (hairStyle === 'rabo-de-cavalo') {
          // Rabo de cavalo alto: cabelo puxado para trás, xuxinha e o rabo caindo pelas costas em três
          // gomos que afinam (com boné, sai pela abertura de trás, logo abaixo da aba de trás).
          const ty = hatted ? -0.12 : 0.36;
          const tz = hatted ? -0.9 : -0.74;
          const pitch = hatted ? 0.25 : 0.75; // o elástico acompanha a curva da nuca
          // Sem boné: franja lateral varrida para um lado (a do lado de fora da cabeça, sobre a testa).
          if (!hatted) H.push({ geo: new THREE.SphereGeometry(1, 16, 10), m: xf(THREE, -0.16, 0.5, 0.52, 0.62, 0.1, -0.42, 0.5, 0.16, 0.3), c: hc });
          H.push({ geo: new THREE.TorusGeometry(0.12, 0.055, 6, 16), m: xf(THREE, 0, ty, tz, pitch, 0, 0), c: accentC });
          H.push({ geo: new THREE.SphereGeometry(0.2, 14, 10), m: xf(THREE, 0, ty - 0.06, tz - 0.14, 0, 0, 0, 0.95, 1.05, 1), c: hc });
          H.push({ geo: new THREE.CapsuleGeometry(0.17, 0.42, 4, 12), m: xf(THREE, 0, ty - 0.42, tz - 0.24, -0.28, 0, 0, 1, 1, 0.85), c: hc });
          H.push({ geo: new THREE.CapsuleGeometry(0.11, 0.3, 4, 10), m: xf(THREE, 0.02, ty - 0.86, tz - 0.22, 0.2, 0, 0.12, 1, 1, 0.85), c: hc });
        }
      }
      const face = look.face;
      if (face === 'bigode' || face === 'bigodao' || face === 'cavanhaque') {
        // Dois gomos sob o nariz, caindo para os lados (o bigodão é mais cheio e comprido).
        const big = face === 'bigodao';
        const len = big ? 0.25 : 0.19;
        const thick = big ? 0.1 : 0.065;
        for (const sx of [-1, 1]) {
          H.push({ geo: new THREE.SphereGeometry(1, 14, 10), m: xf(THREE, sx * (len * 0.62), -0.27, 0.74, 0.1, sx * -0.35, sx * (big ? 0.42 : 0.28), len, thick, thick * 0.9), c: hc });
          if (big) H.push({ geo: new THREE.SphereGeometry(1, 10, 8), m: xf(THREE, sx * 0.3, -0.37, 0.64, 0, sx * -0.6, sx * 1.1, 0.1, 0.055, 0.05), c: hc });
        }
      }
      if (face === 'cavanhaque') H.push({ geo: new THREE.SphereGeometry(0.15, 10, 8), m: xf(THREE, 0, -0.66, 0.5, 0, 0, 0, 1, 1.2, 0.7), c: hc });
      if (face === 'barba') {
        // Barba cheia: cobre a mandíbula e o queixo (um pouco de volume embaixo) com o bigode junto,
        // emendado nas laterais da boca (a boca continua à vista por cima).
        H.push({ geo: new THREE.SphereGeometry(HEAD_R * 1.02, seg + 4, seg, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.55, Math.PI * 0.32), m: xf(THREE, 0, 0, 0.02), c: hc });
        H.push({ geo: new THREE.SphereGeometry(1, 16, 10), m: xf(THREE, 0, -0.66, 0.36, 0.25, 0, 0, 0.42, 0.24, 0.3), c: hc });
        for (const sx of [-1, 1]) {
          H.push({ geo: new THREE.SphereGeometry(1, 14, 10), m: xf(THREE, sx * 0.13, -0.25, 0.745, 0.1, sx * -0.3, sx * 0.3, 0.2, 0.075, 0.07), c: hc });
          H.push({ geo: new THREE.SphereGeometry(1, 10, 8), m: xf(THREE, sx * 0.29, -0.36, 0.66, 0, sx * -0.6, sx * 1.2, 0.1, 0.06, 0.06), c: hc });
        }
      }
      if (look.cap && look.capFront) {
        // Boné com a aba para a frente, curvada: a copa assenta como a do boné de sempre (a frente logo
        // acima das sobrancelhas) e a aba desce um pouco, com as laterais caindo. Marca opcional na
        // frente da copa (capMark 'tres-quadrados': o símbolo do verso das cartas, branco).
        const tilt = new THREE.Matrix4().makeRotationX(CAP_TILT);
        const capM = hatFit ? (m) => fitM(CAP_TILT, m) : (m) => tilt.clone().multiply(m);
        const D = xf(THREE, 0, 0.1, -0.03, -0.12, 0, 0); // referencial da copa (base em y = 0, frente +Z)
        const RX = HEAD_R * 1.1;
        const RY = RX * 0.86;
        const RZ = RX * 1.02;
        Cp.push({ geo: new THREE.SphereGeometry(RX, seg + 4, seg, 0, Math.PI * 2, 0, Math.PI / 2), m: capM(xf(THREE, 0, 0.1, -0.03, -0.12, 0, 0, 1, 0.86, 1.02)), c: capC });
        Cp.push({ geo: capBrim(THREE, RX, RZ, low), m: capM(D), c: capC.clone().multiplyScalar(0.82) });
        Cp.push({ geo: new THREE.SphereGeometry(0.07, 8, 6), m: capM(xf(THREE, 0, 0.1 + RY * 0.99, -0.03)), c: capC });
        // Costura da frente: seis gomos sugeridos por um aro fino na base da copa.
        Cp.push({ geo: new THREE.TorusGeometry(1, 0.012, 4, seg + 10), m: capM(D.clone().multiply(xf(THREE, 0, 0.02, 0, Math.PI / 2, 0, 0, RX * 1.005, RZ * 1.005, 1))), c: capC.clone().multiplyScalar(0.7) });
        if (look.capMark === 'tres-quadrados') {
          // Na frente da copa, a meia altura: a normal do elipsoide dá a inclinação da plaquinha.
          const phi = 0.5;
          const py = RY * Math.sin(phi);
          const pz = RZ * Math.cos(phi);
          const tiltMark = -Math.atan2(py / (RY * RY), pz / (RZ * RZ));
          const side = 0.15;
          const off = side * 0.18;
          const bar = 0.022;
          const Mk = D.clone().multiply(xf(THREE, 0, py, pz + 0.004, tiltMark, 0, 0));
          for (const k of [-1, 0, 1]) {
            const cx = k * off;
            const cy = -k * off;
            for (const [bx, by, w, h] of [
              [cx, cy + side / 2, side + bar, bar],
              [cx, cy - side / 2, side + bar, bar],
              [cx - side / 2, cy, bar, side],
              [cx + side / 2, cy, bar, side],
            ]) {
              Cp.push({ geo: new THREE.BoxGeometry(w, h, 0.014), m: capM(Mk.clone().multiply(xf(THREE, bx, by, 0))), c: '#f4f1ea' });
            }
          }
        }
      } else if (look.cap) {
        // Boné jogado para trás (o conjunto gira CAP_TILT em torno do centro da cabeça): a aba sobe
        // e deixa os olhos e as sobrancelhas à vista da câmera alta.
        const tilt = new THREE.Matrix4().makeRotationX(CAP_TILT);
        const capM = hatFit ? (m) => fitM(CAP_TILT, m) : (m) => tilt.clone().multiply(m);
        Cp.push({ geo: new THREE.SphereGeometry(HEAD_R * 1.1, seg + 4, seg, 0, Math.PI * 2, 0, Math.PI / 2), m: capM(xf(THREE, 0, 0.1, -0.03, -0.12, 0, 0, 1, 0.86, 1.02)), c: capC });
        Cp.push({ geo: new THREE.CylinderGeometry(0.62, 0.62, 0.05, 20, 1, false, -Math.PI * 0.5, Math.PI), m: capM(xf(THREE, 0, 0.16, 0.5, 0.14, 0, 0, 1, 1, 0.95)), c: capC.clone().multiplyScalar(0.8) });
        Cp.push({ geo: new THREE.SphereGeometry(0.07, 8, 6), m: capM(xf(THREE, 0, 0.84, -0.12)), c: capC });
        Cp.push({ geo: new THREE.BoxGeometry(0.3, 0.14, 0.04), m: capM(xf(THREE, 0, 0.44, 0.83, -0.35, 0, 0)), c: '#f2efe6' });
      }
      if (look.earrings) for (const sx of [-1, 1]) H.push({ geo: new THREE.SphereGeometry(0.06, 8, 6), m: xf(THREE, sx * 0.8, -0.24, 0.0), c: '#d6b060' });
      if (H.length) head.add(mk(merge(THREE, H), hairMat, true));
      if (Cp.length) {
        // A aba para a frente não faz sombra da lâmpada nos olhos (o rosto precisa ler na câmera do jogo).
        capMesh = mk(merge(THREE, Cp), hairMat, !look.capFront);
        head.add(capMesh);
      }
      if (look.panama) {
        // Chapéu-panamá: copa com vinco, aba com a borda levantada e fita escura com laço do lado.
        const straw = new THREE.Color(0xe6d6ae);
        const band = new THREE.Color(0x2a211b);
        const P = [];
        const crown = [
          [0.9, 0.24],
          [0.89, 0.5],
          [0.86, 0.78],
          [0.8, 0.94],
          [0.62, 1.0],
          [0.4, 0.97],
          [0.22, 0.9],
          [0.0, 0.91],
        ];
        P.push({ geo: lathe(THREE, crown, seg + 6), m: fitM(PANAMA_TILT, new THREE.Matrix4()), c: straw });
        // Aba: laço fechado (baixo → borda → cima) para ter as duas faces.
        const brim = [
          [0.86, 0.23],
          [1.06, 0.24],
          [1.2, 0.28],
          [1.26, 0.34],
          [1.22, 0.35],
          [1.16, 0.31],
          [1.04, 0.29],
          [0.86, 0.29],
        ];
        // Aba "quebrada": a frente desce um pouco e a traseira sobe (o jeito do panamá).
        const brimGeo = lathe(THREE, brim, seg + 12);
        const bp = brimGeo.attributes.position;
        for (let i = 0; i < bp.count; i++) {
          const x = bp.getX(i);
          const z = bp.getZ(i);
          const r = Math.hypot(x, z);
          const k = clamp((r - 0.86) / 0.4, 0, 1);
          bp.setY(i, bp.getY(i) + (z / Math.max(r, 1e-6)) * -0.12 * k * k);
        }
        brimGeo.computeVertexNormals();
        P.push({ geo: brimGeo, m: fitM(PANAMA_TILT, new THREE.Matrix4()), c: straw.clone().multiplyScalar(0.94) });
        P.push({ geo: new THREE.CylinderGeometry(0.905, 0.915, 0.17, seg + 6, 1, true), m: fitM(PANAMA_TILT, xf(THREE, 0, 0.385, 0)), c: band });
        P.push({ geo: new THREE.SphereGeometry(0.1, 8, 6), m: fitM(PANAMA_TILT, xf(THREE, -0.84, 0.39, -0.28, 0, 0, 0, 0.6, 1, 1.5)), c: band });
        const hatMat = track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }));
        capMesh = mk(merge(THREE, P), hatMat, true);
        head.add(capMesh);
      }
      if (look.glasses && look.glassesThin) {
        // Óculos de aro metálico bem fino, lentes grandes arredondadas-quadradas (superelipse), um
        // pouco curvadas para acompanhar o rosto; ponte dupla fina, plaquetas e hastes que passam por
        // baixo da borda do boné. Lente de vidro quase transparente (só o brilho).
        const G = [];
        const bar = (a, b, r) => {
          const va = new THREE.Vector3().fromArray(a);
          const vb = new THREE.Vector3().fromArray(b);
          const g = new THREE.CylinderGeometry(r, r, va.distanceTo(vb), 5);
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
          g.applyMatrix4(new THREE.Matrix4().compose(va.clone().add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
          return { geo: g };
        };
        const LA = 0.215; // meia largura da lente
        const LB = 0.18; // meia altura
        const LX = 0.29;
        const LY = 0.1;
        const LZ = 0.845;
        const wire = 0.0125;
        const lensPts = (sx, k) => {
          const pts = [];
          const N = low ? 24 : 40;
          for (let i = 0; i < N; i++) {
            const t = (i / N) * Math.PI * 2;
            const c = Math.cos(t);
            const s = Math.sin(t);
            const x = LA * k * Math.sign(c) * Math.pow(Math.abs(c), 0.62);
            const y = LB * k * Math.sign(s) * Math.pow(Math.abs(s), 0.62);
            const out = (sx * x + LA) / (2 * LA); // 0 = lado do nariz, 1 = lado de fora
            pts.push(new THREE.Vector3(sx * LX + x, LY + y - 0.02 * out, LZ - 0.07 * out * out));
          }
          return pts;
        };
        const glassGeo = [];
        for (const sx of [-1, 1]) {
          const curve = new THREE.CatmullRomCurve3(lensPts(sx, 1), true);
          G.push({ geo: new THREE.TubeGeometry(curve, low ? 32 : 56, wire, 5, true) });
          // Lente: leque de triângulos a partir do centro, um tiquinho atrás do aro.
          const rim = lensPts(sx, 0.98);
          const lp = [];
          const cx = sx * LX;
          for (let i = 0; i < rim.length; i++) {
            const a = rim[i];
            const b = rim[(i + 1) % rim.length];
            lp.push(cx, LY - 0.01, LZ - 0.025, a.x, a.y, a.z - 0.004, b.x, b.y, b.z - 0.004);
          }
          const lg = new THREE.BufferGeometry();
          lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
          lg.computeVertexNormals();
          glassGeo.push({ geo: lg });
          // Haste: da dobradiça (canto de cima, de fora) até a orelha, baixando por baixo do boné.
          const hinge = [sx * (LX + LA * 0.98), LY + LB * 0.55 - 0.02, LZ - 0.07];
          G.push(bar(hinge, [sx * 0.765, LY + 0.04, 0.52], 0.011));
          G.push(bar([sx * 0.765, LY + 0.04, 0.52], [sx * 0.8, 0.03, -0.06], 0.011));
          // Plaqueta do nariz.
          G.push({ geo: new THREE.SphereGeometry(0.022, 6, 5), m: xf(THREE, sx * 0.085, LY - 0.09, 0.81, 0, 0, 0, 0.7, 1, 0.6) });
        }
        // Ponte dupla: um arco baixo entre as lentes e uma barra reta em cima.
        const arc = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-(LX - LA * 0.93), LY + 0.03, LZ), new THREE.Vector3(0, LY + 0.1, LZ + 0.03), new THREE.Vector3(LX - LA * 0.93, LY + 0.03, LZ));
        G.push({ geo: new THREE.TubeGeometry(arc, 10, wire * 0.9, 5, false) });
        G.push(bar([-(LX - LA * 0.6), LY + LB * 0.93, LZ + 0.004], [LX - LA * 0.6, LY + LB * 0.93, LZ + 0.004], wire * 0.8));
        const frames = track(new THREE.MeshStandardMaterial({ color: 0xc9c6bd, roughness: 0.28, metalness: 0.85 }));
        head.add(mk(merge(THREE, G), frames, false));
        const glassMat = track(new THREE.MeshStandardMaterial({ color: 0xe8eeff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
        const lens = mk(merge(THREE, glassGeo), glassMat, false);
        lens.renderOrder = 2;
        head.add(lens);
      } else if (look.glasses) {
        const G = [];
        const bar = (a, b, r) => {
          const va = new THREE.Vector3().fromArray(a);
          const vb = new THREE.Vector3().fromArray(b);
          const g = new THREE.CylinderGeometry(r, r, va.distanceTo(vb), 5);
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
          g.applyMatrix4(new THREE.Matrix4().compose(va.clone().add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
          return { geo: g };
        };
        for (const sx of [-1, 1]) {
          G.push({ geo: new THREE.TorusGeometry(0.2, 0.028, 6, 20), m: xf(THREE, sx * 0.28, 0.12, 0.83, 0, 0, 0, 1, 0.86, 1) });
          G.push(bar([sx * 0.48, 0.13, 0.82], [sx * 0.74, 0.13, 0.6], 0.02));
          G.push(bar([sx * 0.74, 0.13, 0.6], [sx * 0.76, 0.08, -0.02], 0.018));
        }
        G.push({ geo: new THREE.CylinderGeometry(0.02, 0.02, 0.16, 5), m: xf(THREE, 0, 0.15, 0.86, 0, 0, Math.PI / 2) });
        const frames = track(new THREE.MeshStandardMaterial({ color: 0x4a2e1c, roughness: 0.35, metalness: 0.3 }));
        head.add(mk(merge(THREE, G), frames, false));
      }
      if (look.pencil) {
        // Lápis amarelo apoiado em cima da orelha do lado da câmera: borracha para trás e para cima,
        // ponta para a frente e para baixo (no black, fica espetado no cabelo).
        const L = [];
        L.push({ geo: new THREE.CylinderGeometry(0.058, 0.058, 0.66, 6), c: '#f2c230' });
        L.push({ geo: new THREE.CylinderGeometry(0.061, 0.061, 0.08, 10), m: xf(THREE, 0, -0.37, 0), c: '#b9b6ad' });
        L.push({ geo: new THREE.CylinderGeometry(0.056, 0.056, 0.09, 10), m: xf(THREE, 0, -0.45, 0), c: '#e98b86' });
        L.push({ geo: new THREE.CylinderGeometry(0.02, 0.058, 0.16, 6), m: xf(THREE, 0, 0.41, 0), c: '#e9c793' });
        L.push({ geo: new THREE.CylinderGeometry(0.004, 0.021, 0.06, 6), m: xf(THREE, 0, 0.51, 0), c: '#2a2a2a' });
        const out = look.hair === 'black' ? 0.2 : 0;
        const dir = new THREE.Vector3(camSide * -0.1, -0.14, 1).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        const pen = mk(merge(THREE, L), propMat, false);
        pen.position.set(camSide * (0.84 + out), 0.17, -0.26);
        pen.quaternion.copy(q);
        head.add(pen);
      }
    }
    // Palito de dente no canto da boca (lado da câmera); balança devagar em update().
    let toothpick = null;
    const toothBase = { x: 0.06, y: camSide * 0.95 };
    if (look.toothpick) {
      const geo = merge(THREE, [
        { geo: new THREE.CylinderGeometry(0.026, 0.034, 0.52, 6), m: xf(THREE, 0, 0, 0.26, Math.PI / 2, 0, 0), c: '#ecd3a0' },
        { geo: new THREE.ConeGeometry(0.026, 0.07, 6), m: xf(THREE, 0, 0, 0.555, Math.PI / 2, 0, 0), c: '#d6b47a' },
      ]);
      toothpick = new THREE.Group();
      toothpick.position.set(camSide * 0.17, -0.37, 0.68);
      toothpick.rotation.set(toothBase.x, toothBase.y, 0, 'YXZ');
      toothpick.add(mk(geo, propMat, false));
      head.add(toothpick);
    }

    // ------------------------------------------------------------------ braços (IK) e mãos
    // Cada braço tem duas peças rígidas: a manga (com o punho da camisa de time) e o antebraço
    // com a mão. As duas são orientadas a cada quadro pela IK; o eixo +Y local é o do osso.
    function upperMesh() {
      const parts = [{ geo: new THREE.CapsuleGeometry(0.29, UPPER - 0.4, 4, low ? 8 : 12), c: sleeveC }];
      if (look.outfit === 'time') parts.push({ geo: new THREE.TorusGeometry(0.29, 0.05, 6, 16), m: xf(THREE, 0, UPPER * 0.28, 0, Math.PI / 2, 0, 0), c: accentC });
      // Social: manga dobrada até o cotovelo (a dobra fica no fim da peça, perto do cotovelo).
      if (look.outfit === 'social') parts.push({ geo: new THREE.CylinderGeometry(0.315, 0.315, 0.2, 16, 1, false), m: xf(THREE, 0, UPPER * 0.36, 0), c: shirtC.clone().lerp(new THREE.Color(0xffffff), 0.12) });
      const m = mk(merge(THREE, parts), sleeveMat, false);
      hips.add(m);
      return m;
    }
    function foreMesh(side) {
      const L = FORE;
      const m = mk(
        merge(THREE, [
          { geo: new THREE.CapsuleGeometry(0.21, L - 0.3, 4, low ? 8 : 12), c: skinC },
          { geo: new THREE.SphereGeometry(0.24, 14, 10), m: xf(THREE, 0, L / 2 + 0.1, 0, 0, 0, 0, 0.9, 1.15, 0.62), c: skinC },
          { geo: new THREE.CapsuleGeometry(0.075, 0.16, 3, 6), m: xf(THREE, side * -0.2, L / 2 + 0.02, 0.03, 0, 0, side * 0.6), c: skinC },
        ]),
        skinMat,
        true
      );
      hips.add(m);
      return m;
    }
    const arms = [-1, 1].map((side) => ({
      side,
      upper: upperMesh(),
      fore: foreMesh(side),
      shoulder: [side * SHOULDER[0], SHOULDER[1], SHOULDER[2]],
      target: [0, 0, 0],
      pole: [0, 0, 0],
      ik: { elbow: [0, 0, 0], wrist: [0, 0, 0] },
    }));
    // Tecido da manga sobre os ombros (esconde a junção com o tronco). A esfera fica deitada (polo no
    // eixo do braço): com a camisa listrada, as listras dão a volta no ombro como na manga, em vez de
    // formar um alvo visto de cima. Uma peça por lado (o sinal 'levantar-ombro' sobe só uma).
    const shoulderCaps = [-1, 1].map((sx) => {
      const m = mk(merge(THREE, [{ geo: new THREE.SphereGeometry(0.31, 14, 10), m: xf(THREE, sx * SHOULDER[0] * 0.94, SHOULDER[1] - 0.04, SHOULDER[2], 0, 0, Math.PI / 2), c: sleeveC }]), sleeveMat, false);
      hips.add(m);
      return m;
    });

    // ------------------------------------------------------------------ âncora do leque
    let humanYaw = 0;
    const cardAnchor = new THREE.Object3D();
    cardAnchor.name = 'cardAnchor';
    const anchorRestPos = new THREE.Vector3().fromArray(FAN);
    const anchorRestQuat = new THREE.Quaternion();
    {
      // Leque quase em pé (inclinado para o rosto), girado um pouco na direção do humano.
      const X = new THREE.Vector3(1, 0, 0);
      const zAxis = new THREE.Vector3(0, 0.42, -0.91).applyAxisAngle(X, -LEAN).normalize();
      const yAxis = new THREE.Vector3(0, 0.91, 0.42).applyAxisAngle(X, -LEAN).normalize();
      const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
      anchorRestQuat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
      const toHuman = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), -(o.facing || 0));
      humanYaw = Math.atan2(toHuman.x, toHuman.z);
      const yaw = clamp(humanYaw, -0.65, 0.65);
      anchorRestQuat.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
      anchorRestPos.x = Math.sin(yaw) * 0.25;
    }
    cardAnchor.position.copy(anchorRestPos);
    cardAnchor.quaternion.copy(anchorRestQuat);
    hips.add(cardAnchor);
    // Laterais em retrato: a câmera fica alta e o braço/leque cobria a fileira de tampinhas;
    // as mãos (e o leque) recuam PORTRAIT_PULL para perto do corpo.
    const lateral = Math.abs(Math.sin(o.facing || 0)) > 0.7;
    const PORTRAIT_PULL = 0.3;
    let pullK = -1;

    ctx.scene.add(group);

    // ------------------------------------------------------------------ pose e animação
    const pose = Object.assign({}, REST);
    const turn = { alert: 0 };
    const gaze = { yaw: 0, pitch: 0.1, tYaw: 0, tPitch: 0.1, eyeYaw: 0, eyePitch: 0 };
    let lookTarget = null;
    const phase = hash01(seat + 1) * 10;
    let blinkIn = 1.5 + hash01(seat + 7) * 3;
    let blinkT = 0;
    let doubleBlink = false;
    let glanceIn = 0.6 + hash01(seat + 3) * 1.5;
    let fidgetIn = 7 + hash01(seat + 11) * 6;
    const fidget = { v: 0 };

    const tmpV = new THREE.Vector3();
    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);
    const headLocal = new THREE.Vector3(0, 3.8, 0);
    const anchorPos = new THREE.Vector3();
    const qTmp = new THREE.Quaternion();
    const noseH = new THREE.Vector3(); // ponta do nariz no referencial do quadril (sinal 'cocar-nariz')
    let signalGaze = 0; // ≠ 0 enquanto um sinal olha para a câmera (fica com o número do sinal)
    let signalCount = 0;

    /**
     * Toca uma sequência de poses como UM tween só (linha do tempo): a duração total é exata em
     * qualquer taxa de quadros e um act novo interrompe este (a promessa resolve na hora).
     */
    function seq(steps) {
      Tween.kill(pose);
      const segs = [];
      let cur = Object.assign({}, pose);
      let total = 0;
      for (const [props, dur, ease] of steps) {
        // O primeiro trecho também devolve ao repouso o que o act interrompido tinha mexido.
        const to = Object.assign({}, segs.length ? cur : REST, props);
        segs.push({ t0: total, t1: total + dur, from: cur, to, ease: Tween.ease[ease || 'inOutSine'] || Tween.ease.inOutSine });
        cur = to;
        total += dur;
      }
      return Tween.run(
        total,
        (e, raw) => {
          const now = raw * total;
          let sg = segs[segs.length - 1];
          for (let i = 0; i < segs.length; i++) {
            if (now <= segs[i].t1) {
              sg = segs[i];
              break;
            }
          }
          const k = sg.t1 > sg.t0 ? sg.ease(clamp((now - sg.t0) / (sg.t1 - sg.t0), 0, 1)) : 1;
          // Cada trecho guarda a pose inteira: pular um trecho curto (quadro lento) não deixa resto.
          for (let i = 0; i < POSE_KEYS.length; i++) {
            const key = POSE_KEYS[i];
            pose[key] = sg.from[key] + (sg.to[key] - sg.from[key]) * k;
          }
        },
        { ease: 'linear', target: pose }
      ).then(() => undefined);
    }

    /** Sinal para o parceiro (~1 s olhando para a câmera); gesto desconhecido resolve na hora. */
    function signal(name) {
      let side = camSide;
      if (ctx.camera) {
        tmpB.copy(ctx.camera.position);
        group.worldToLocal(tmpB);
        if (Math.abs(tmpB.x) > 0.3 * Math.max(1, Math.abs(tmpB.z))) side = tmpB.x > 0 ? 1 : -1;
      }
      const steps = signalSteps(name, side);
      if (!steps) return Promise.resolve();
      const id = ++signalCount;
      signalGaze = id;
      glanceIn = 0;
      return seq(steps).then(() => {
        if (signalGaze === id) signalGaze = 0;
      });
    }

    /** act(kind): também aceita o nome de um sinal ('piscar' etc.), para quem só conhece act. */
    function act(kind) {
      signalGaze = 0;
      if (normalizeSignal(kind)) return signal(kind);
      return playAct(kind);
    }

    function playAct(kind) {
      switch (kind) {
        case 'shout':
          return seq([
            [{ jump: 0.32, lean: 1, mouth: 1, browUp: 1, browTilt: -0.3, rShout: 1, smile: 0.1, squint: 0 }, 0.14, 'outQuad'],
            [{ jump: 0 }, 0.22, 'outBounce'],
            [{ lean: 0.75, mouth: 0.85 }, 0.35],
            [REST, 0.4],
          ]);
        case 'think':
          return seq([
            [{ rThink: 1, tilt: 0.16, browTilt: -0.6, browUp: -0.1, smile: -0.05, lookUp: 1, nod: -0.06 }, 0.4],
            [{ tilt: 0.22, lookUp: 0.8 }, 1.1],
            [REST, 0.4],
          ]);
        case 'win':
          return seq([
            [{ rWin: 1, lWin: 1, jump: 0.28, mouth: 0.65, smile: 1, squint: 0.8, browUp: 0.6, browTilt: 0 }, 0.22, 'outQuad'],
            [{ jump: 0 }, 0.18, 'inQuad'],
            [{ jump: 0.2 }, 0.16, 'outQuad'],
            [{ jump: 0 }, 0.18, 'inQuad'],
            [{ rWin: 0.85, lWin: 0.85, mouth: 0.4 }, 0.35],
            [REST, 0.45],
          ]);
        case 'lose':
          return seq([
            [{ slump: 1, nod: 0.22, smile: -1, browTilt: 0.9, browUp: 0.1, mouth: 0, down: 1 }, 0.45],
            [{ shake: 0.12 }, 0.28],
            [{ shake: -0.12 }, 0.3],
            [{ shake: 0 }, 0.2],
            [REST, 0.5],
          ]);
        case 'nod':
          return seq([
            [{ nod: 0.28, smile: 0.6 }, 0.13],
            [{ nod: -0.05 }, 0.13],
            [{ nod: 0.24 }, 0.13],
            [REST, 0.18],
          ]);
        case 'shake':
          return seq([
            [{ shake: 0.3, smile: -0.25, browTilt: 0.3 }, 0.14],
            [{ shake: -0.3 }, 0.2],
            [{ shake: 0.25 }, 0.2],
            [REST, 0.16],
          ]);
        case 'play':
          return seq([
            [{ rPlay: 1, lean: 0.45 }, 0.16, 'outQuad'],
            [REST, 0.32],
          ]);
        case 'deal': {
          const steps = [[{ deal: 1, lean: 0.55, smile: 0.4 }, 0.25]];
          for (let i = 0; i < 4; i++) steps.push([{ jitter: 1 }, 0.12], [{ jitter: 0 }, 0.12]);
          for (let i = 0; i < 6; i++) steps.push([{ rPlay: 0.9, deal: 0.35 }, 0.11], [{ rPlay: 0.15 }, 0.13]);
          steps.push([REST, 0.3]);
          return seq(steps);
        }
        default:
          return seq([[REST, 0.3]]);
      }
    }

    function lookAt(point) {
      lookTarget = point ? point.clone() : null;
    }

    function setTurn(on) {
      Tween.to(turn, { alert: on ? 1 : 0 }, { duration: 0.4 });
    }

    function headWorldPos(target) {
      const out = target || new THREE.Vector3();
      head.updateWorldMatrix(true, false);
      return head.getWorldPosition(out);
    }

    /** Escolhe um alvo de olhar ocioso: o humano, as próprias cartas, a mesa ou outro jogador. */
    function idleGlance() {
      const r = Math.random();
      if (r < GAZE.camChance) {
        const cp = ctx.camera.position;
        tmpV.set(cp.x, cp.y, cp.z);
      } else if (r < 0.66) {
        tmpV.set(0, 0.2, 0);
      } else if (r < 0.84) {
        cardAnchor.getWorldPosition(tmpV);
        tmpV.y += 0.4;
      } else {
        // Outro jogador: tenta um assento ao acaso (sem alocar listas).
        let other = null;
        const start = 1 + Math.floor(Math.random() * 3);
        for (let k = 0; k < 3 && !other; k++) {
          const s = 1 + ((start - 1 + k) % 3);
          if (s !== seat && ctx.avatar) other = ctx.avatar(s);
        }
        if (other && other.headWorldPos) other.headWorldPos(tmpV);
        else tmpV.set(0, 0.2, 0);
      }
      aimAt(tmpV);
    }

    function aimAt(world) {
      tmpA.copy(world);
      group.worldToLocal(tmpA);
      tmpA.sub(headLocal);
      const yaw = Math.atan2(tmpA.x, tmpA.z);
      const pitch = -Math.atan2(tmpA.y, Math.hypot(tmpA.x, tmpA.z));
      // Direção da câmera no referencial do avatar: o lado dela pode girar mais que o outro.
      tmpB.copy(ctx.camera.position);
      group.worldToLocal(tmpB);
      tmpB.sub(headLocal);
      const camYaw = Math.atan2(tmpB.x, tmpB.z);
      let lo = -GAZE.toward;
      let hi = GAZE.toward;
      let head = yaw;
      if (camYaw > 0.25) {
        lo = -GAZE.away;
        hi = Math.max(GAZE.toward, camYaw + 0.1);
        head = yaw + (camYaw - yaw) * GAZE.camBias;
      } else if (camYaw < -0.25) {
        lo = Math.min(-GAZE.toward, camYaw - 0.1);
        hi = GAZE.away;
        head = yaw + (camYaw - yaw) * GAZE.camBias;
      }
      gaze.tYaw = clamp(head, lo, hi);
      gaze.tPitch = clamp(pitch, -GAZE.pitchUp, pitchDown);
      gaze.eyeYaw = clamp(yaw - gaze.tYaw, -0.8, 0.8);
      gaze.eyePitch = clamp(pitch - gaze.tPitch, -0.8, 0.8);
    }

    function orient(meshObj, a, b) {
      tmpA.fromArray(a);
      tmpB.fromArray(b);
      meshObj.position.addVectors(tmpA, tmpB).multiplyScalar(0.5);
      tmpB.sub(tmpA).normalize();
      meshObj.quaternion.setFromUnitVectors(Y, tmpB);
    }

    /** Aproxima o alvo T de (x, y, z) com peso w (sem alocar). */
    function pull(T, w, x, y, z) {
      if (w <= 0) return;
      T[0] += (x - T[0]) * w;
      T[1] += (y - T[1]) * w;
      T[2] += (z - T[2]) * w;
    }

    /** Alvos das mãos (referencial do quadril) a partir dos pesos da pose. */
    function armTargets(t) {
      const p = pose;
      const breathe = Math.sin(t * 1.7 + phase) * 0.02;
      for (let i = 0; i < arms.length; i++) {
        const a = arms[i];
        const T = a.target;
        const P = a.pole;
        P[0] = a.side;
        P[1] = -0.9;
        P[2] = -0.35;
        if (a.side < 0) {
          // Mão direita: ao lado do leque, pronta para puxar uma carta.
          T[0] = anchorPos.x - 0.36;
          T[1] = anchorPos.y + 0.08 + fidget.v * 0.25 + breathe;
          T[2] = anchorPos.z + 0.08 + fidget.v * 0.1;
          pull(T, p.deal, -0.4, 3.25 + p.jitter * 0.12, 2.45);
          pull(T, p.rPlay, -0.45, 3.7, 2.8);
          pull(T, p.rThink, -0.08, 5.3, 1.18);
          pull(T, p.rShout, -1.25, 7.5, 1.1);
          pull(T, p.rWin, -1.15, 8.1, 0.5);
          pull(T, p.down, -0.7, 3.0, 1.55);
          // Coçar o nariz: dedos na ponta do nariz, o punho logo abaixo e à frente.
          pull(T, p.rNose, noseH.x - 0.1 + p.scratch * 0.07, noseH.y - 0.36 + p.scratch * 0.06, noseH.z + 0.22);
          P[0] -= p.rWin + p.rShout * 0.5 - p.rNose * 0.7;
          P[1] -= p.rNose * 1.6;
          P[2] += p.rNose * 1.2;
          P[1] += p.rWin * 0.9 - p.rThink * 0.2;
          P[2] += p.rThink * 0.9;
        } else {
          // Mão esquerda: segura a base do leque.
          T[0] = anchorPos.x + 0.16;
          T[1] = anchorPos.y - 0.12 + breathe;
          T[2] = anchorPos.z + 0.05;
          pull(T, p.deal, 0.4, 3.25 - p.jitter * 0.12, 2.4);
          pull(T, p.lWin, 1.05, 8.15, 0.55);
          pull(T, p.down, 0.7, 3.0, 1.55);
          P[0] += p.lWin;
          P[1] += p.lWin * 0.9;
        }
      }
    }

    function updateArms(t) {
      armTargets(t);
      const slump = pose.slump;
      for (const a of arms) {
        const sh = a.shoulder;
        const shrug = (a.side < 0 ? pose.shrugN : pose.shrugP) * 0.5;
        sh[1] = SHOULDER[1] - slump * 0.2 + pose.rShout * (a.side < 0 ? 0.12 : 0) + shrug;
        sh[2] = SHOULDER[2] + slump * 0.12 + shrug * 0.12;
        const cap = shoulderCaps[a.side < 0 ? 0 : 1];
        cap.position.y = shrug;
        cap.position.z = shrug * 0.12;
        solveTwoBone(sh, a.target, UPPER, FORE, a.pole, a.ik);
        orient(a.upper, sh, a.ik.elbow);
        orient(a.fore, a.ik.elbow, a.ik.wrist);
        // Palma meio virada para dentro (giro em torno do próprio antebraço).
        qTmp.setFromAxisAngle(Y, a.side * 0.9);
        a.fore.quaternion.multiply(qTmp);
      }
    }

    function update(dt, t) {
      // Olhar: sinal (para a câmera), alvo explícito ou olhadas ocasionais.
      if (signalGaze && ctx.camera) aimAt(ctx.camera.position);
      else if (lookTarget) aimAt(lookTarget);
      else {
        glanceIn -= dt;
        if (glanceIn <= 0) {
          glanceIn = 2.2 + Math.random() * 3.2;
          idleGlance();
        }
      }
      let tPitch = gaze.tPitch;
      if (turn.alert > 0.01) tPitch = tPitch * (1 - turn.alert * 0.5) + pitchDown * turn.alert * 0.5;
      tPitch -= pose.lookUp * 0.35;
      const k = 1 - Math.exp(-dt * 6);
      gaze.yaw += (gaze.tYaw - gaze.yaw) * k;
      gaze.pitch += (tPitch - gaze.pitch) * k;

      // Pequenos gestos ociosos (ajeitar as cartas).
      fidgetIn -= dt;
      if (fidgetIn <= 0 && !Tween.isTweening(pose)) {
        fidgetIn = 7 + Math.random() * 8;
        Tween.to(fidget, { v: 1 }, { duration: 0.25 }).then(() => Tween.to(fidget, { v: 0 }, { duration: 0.35 }));
      }

      const reduced = Tween.prefersReducedMotion();
      const breathe = reduced ? 0 : Math.sin(t * 1.7 + phase);
      group.position.y = baseY + pose.jump;
      hips.rotation.set(
        LEAN + pose.lean * 0.3 - pose.slump * 0.1 + turn.alert * 0.05,
        gaze.yaw * 0.18,
        (reduced ? 0 : Math.sin(t * 0.6 + phase) * 0.014) + (pose.shrugP - pose.shrugN) * 0.06,
        'YXZ'
      );
      torso.scale.set(1 + breathe * 0.006, 1 + breathe * 0.01, 0.68 + breathe * 0.008);

      // Cabeça: segue o olhar (o tronco já girou um pouco), com aceno, balanço e inclinação.
      headPivot.rotation.set(
        gaze.pitch * 0.85 - LEAN * 0.8 - pose.lean * 0.2 + pose.nod + pose.slump * 0.3,
        gaze.yaw * 0.82 + pose.shake,
        pose.tilt + (reduced ? 0 : Math.sin(t * 0.45 + phase * 2) * 0.03),
        'YXZ'
      );
      // Pupilas acompanham o olhar (e fazem o resto do giro que a cabeça não faz).
      const pux = clamp(clamp(gaze.tYaw - gaze.yaw * 0.82, -0.3, 0.3) * 0.1 + gaze.eyeYaw * 0.06, -0.055, 0.055);
      const puy = clamp(clamp(-(tPitch - gaze.pitch), -0.3, 0.3) * 0.1 - gaze.eyePitch * 0.05, -0.045, 0.045) + pose.lookUp * 0.035;
      pupils[0].position.set(pux, puy, 0);
      pupils[1].position.set(pux, puy, 0);

      // Piscar (às vezes duas vezes seguidas); olhos apertados de alegria no 'win'.
      blinkIn -= dt;
      if (blinkIn <= 0) {
        blinkT = 0.12;
        if (doubleBlink) {
          doubleBlink = false;
          blinkIn = 2.4 + Math.random() * 3.6;
        } else {
          doubleBlink = Math.random() < 0.2;
          blinkIn = doubleBlink ? 0.22 : 2.4 + Math.random() * 3.6;
        }
      }
      if (blinkT > 0) blinkT -= dt;
      const lid = blinkT > 0 ? 0.08 : 1 - pose.squint * 0.65;
      eyes[0].scale.set(1, Math.max(0.06, lid * (1 - pose.winkN * 0.94)), 1);
      eyes[1].scale.set(1, Math.max(0.06, lid * (1 - pose.winkP * 0.94)), 1);

      // Sobrancelhas (browN/browP sobem ou descem uma só; a erguida também arqueia para fora).
      const up = pose.browUp * 0.09 + turn.alert * -0.02;
      brows[0].position.y = 0.4 + up + pose.browN * 0.09;
      brows[1].position.y = 0.4 + up + pose.browP * 0.09;
      // Com boné/chapéu, a peça sobe junto com a sobrancelha mais alta (nada atravessa a copa).
      // (1,5× a subida: a sobrancelha erguida também arqueia e cresce, a ponta sobe mais que o centro).
      if (capMesh) capMesh.position.y = Math.max(0, up + Math.max(pose.browN, pose.browP, 0) * 0.09) * 1.5;
      // Sobrancelha erguida engrossa um pouco (lê melhor de longe).
      brows[0].scale.set(1 + Math.max(0, pose.browN - 1) * 0.35, 1, 1);
      brows[1].scale.set(1 + Math.max(0, pose.browP - 1) * 0.35, 1, 1);
      brows[0].rotation.z = Math.PI / 2 - pose.browTilt * 0.35 - Math.max(0, pose.browN) * 0.12;
      brows[1].rotation.z = Math.PI / 2 + pose.browTilt * 0.35 + Math.max(0, pose.browP) * 0.12;

      // Bochechas estufadas e pontinha da língua.
      for (let i = 0; i < 2; i++) {
        const c = i ? pose.cheekP : pose.cheekN;
        cheeks[i].visible = c > 0.01;
        cheeks[i].scale.set(1.15 * c, 1.0 * c, 1.0 * c);
      }
      tongue.visible = pose.tongue > 0.01;
      tongue.scale.set(pose.tongue, pose.tongue * 0.75, pose.tongue * 0.9);
      tongue.position.set(pose.mouthSide * 0.08 + 0.02, -0.45 - pose.tongue * 0.03, 0.66 + pose.tongue * 0.12);

      // Boca: arco de sorriso/bico e boca aberta.
      const sm = pose.smile;
      const opened = pose.mouth;
      smile.visible = opened < 0.45;
      smile.rotation.z = sm >= 0 ? -Math.PI / 2 - smileArc / 2 : Math.PI / 2 - smileArc / 2;
      smile.scale.set(1 - opened * 0.4, 0.35 + Math.abs(sm) * 0.6, 1);
      smile.position.y = sm >= 0 ? -0.33 : -0.47;
      open.visible = opened > 0.04;
      open.scale.set(0.85 + sm * 0.2, 0.15 + opened * 0.95, 0.5);
      // Canto da boca puxado para um lado (sorriso de canto) e bico (bochechas cheias).
      const ms = pose.mouthSide;
      const pk = pose.pucker;
      smile.rotation.z += ms * 0.35;
      smile.position.x = ms * 0.08;
      open.position.x = ms * 0.08;
      if (pk > 0) {
        smile.scale.x *= 1 - pk * 0.55;
        smile.scale.y += (0.22 - smile.scale.y) * pk;
        smile.position.z = 0.7 + pk * 0.06;
      } else smile.position.z = 0.7;
      if (toothpick) {
        toothpick.rotation.x = toothBase.x + (reduced ? 0 : Math.sin(t * 2.3 + phase) * 0.09) - opened * 0.2;
        toothpick.rotation.y = toothBase.y + (reduced ? 0 : Math.sin(t * 1.1 + phase * 3) * 0.12) + ms * 0.2;
        toothpick.position.x = camSide * 0.17 + ms * 0.08;
        toothpick.position.y = -0.37 - opened * 0.06;
      }

      // Âncora do leque: sobe com a mão esquerda quando os braços levantam.
      anchorPos.copy(anchorRestPos);
      const pullTo = lateral && ctx.camera && ctx.camera.aspect > 0 && ctx.camera.aspect < 0.8 ? 1 : 0;
      pullK = pullK < 0 ? pullTo : pullK + (pullTo - pullK) * Math.min(1, dt * 4);
      anchorPos.z -= PORTRAIT_PULL * pullK;
      // No 'win' o leque sobe com a mão esquerda até acima da cabeça (não tapa o rosto).
      anchorPos.y += pose.lWin * 3.95 - pose.slump * 0.25;
      anchorPos.x += pose.lWin * 0.85;
      anchorPos.z += pose.lWin * -0.95;
      cardAnchor.position.copy(anchorPos);

      if (pose.rNose > 0.001) {
        // Nariz no referencial do quadril (a cabeça já está posada neste quadro).
        headPivot.updateMatrix();
        head.updateMatrix();
        noseH.set(0, -0.08, HEAD_R * 0.97 + 0.12).applyMatrix4(head.matrix).applyMatrix4(headPivot.matrix);
      }
      updateArms(t);
    }

    function dispose() {
      Tween.kill(pose);
      Tween.kill(turn);
      Tween.kill(fidget);
      ctx.scene.remove(group);
      disposables.forEach((d) => d.dispose && d.dispose());
    }

    // Já sai na pose de repouso: a cena enquadra a câmera logo depois de criar os avatares.
    update(0, 0);
    group.updateMatrixWorld(true);

    return { group, cardAnchor, seat, name: o.name, look, headWorldPos, act, signal, lookAt, setTurn, update, dispose };
  }

  const Avatars = {
    create,
    resolveLook,
    signalSteps,
    normalizeSignal,
    parseColor,
    solveTwoBone,
    LOOKS,
    HAIRS,
    FACES,
    OUTFITS,
    OUTFIT_ALIASES,
    ACCESSORIES,
    ACCESSORY_GROUP,
    CAP_MARKS,
    SIGNALS,
    REST,
  };
  Truco.Avatars = Avatars;
  if (typeof module === 'object' && module.exports) module.exports = Avatars;
})(typeof window !== 'undefined' ? window : globalThis);
