// Truco.HUD — overlay DOM sobre a cena 3D: placar, vira/manilha, rodadas, botões do turno,
// diálogos (resposta ao truco, mão de onze, fim de partida), balões de fala, letreiros,
// toasts, menu inicial e o modal "Como jogar". Contrato: docs/ARCHITECTURE.md §7.
// Regra de layout: nada que não seja modal cobre o terço central inferior (mão 3D do humano).
(function (root) {
  'use strict';
  const Truco = (root.Truco = root.Truco || {});

  const PREFS_KEY = 'cafeTruco.prefs';

  /**
   * Qualidade padrão sem preferência salva: 'low' em celular/tela pequena/pouca memória.
   * Tudo protegido: nos testes (Node) não há matchMedia, screen nem deviceMemory.
   */
  function deviceQuality() {
    try {
      const coarse = !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches);
      const scr = root.screen;
      const small = !!(scr && scr.width > 0 && scr.height > 0 && Math.min(scr.width, scr.height) < 500);
      const nav = root.navigator;
      const lowMemory = !!(nav && nav.deviceMemory && nav.deviceMemory <= 4);
      return coarse || small || lowMemory ? 'low' : 'high';
    } catch (_) {
      return 'high';
    }
  }

  const DEFAULT_SETTINGS = Object.freeze({
    players: 4,
    deck: 'limpo',
    format: 'single',
    difficulty: 'medio',
    speed: 1,
    sound: true,
    voice: true,
    highlightManilhas: true,
    explainSignals: true,
    quality: deviceQuality(),
    // Quem senta em cada lugar (id de personagem por assento); vazio = padrão do jogo.
    seats2: Object.freeze({}),
    seats4: Object.freeze({}),
  });

  // Opções que valem na hora no menu de pausa; as outras mudam a partida e só entram na próxima.
  const LIVE_KEYS = ['sound', 'voice', 'highlightManilhas', 'explainSignals', 'speed', 'quality'];
  const MATCH_KEYS = ['players', 'deck', 'format', 'difficulty', 'seats2', 'seats4'];

  // Lugares da mesa que o menu deixa escolher (assento → rótulo), por modo.
  const SEAT_SLOTS = {
    2: [{ seat: 1, label: 'Adversário' }],
    4: [
      { seat: 2, label: 'Parceiro(a)', sub: 'senta à sua frente' },
      { seat: 1, label: 'Adversário da direita' },
      { seat: 3, label: 'Adversário da esquerda' },
    ],
  };
  const DEFAULT_SEAT_IDS = { 2: { 1: 'tiao' }, 4: { 1: 'tiao', 2: 'vini', 3: 'bia' } };

  // Erros de miniatura já registrados (um por carta, para não inundar __truco.errors).
  const reportedCards = new Set();

  function reportError(err, where) {
    const report = Truco.reportError || (root.console && root.console.error ? root.console.error.bind(root.console) : null);
    if (report) report(err, where);
  }

  const VALUE_LADDER = [1, 3, 6, 9, 12];
  const CALL_NAMES = { 3: 'Truco', 6: 'Seis', 9: 'Nove', 12: 'Doze' };

  const RANK_NAMES = {
    '4': 'Quatro', '5': 'Cinco', '6': 'Seis', '7': 'Sete',
    Q: 'Dama', J: 'Valete', K: 'Rei', A: 'Ás', '2': 'Dois', '3': 'Três',
  };

  const SUIT_INFO = {
    clubs: { name: 'Paus', symbol: '♣', red: false, letter: 'c' },
    hearts: { name: 'Copas', symbol: '♥', red: true, letter: 'h' },
    spades: { name: 'Espadas', symbol: '♠', red: false, letter: 's' },
    diamonds: { name: 'Ouros', symbol: '♦', red: true, letter: 'd' },
  };
  const SUIT_BY_LETTER = { c: 'clubs', h: 'hearts', s: 'spades', d: 'diamonds' };
  const MANILHA_NAMES = { clubs: 'Zap', hearts: 'Copas', spades: 'Espadilha', diamonds: 'Pica-fumo' };
  // Da manilha mais forte para a mais fraca (RULES.md §4.4).
  const MANILHA_ORDER = ['clubs', 'hearts', 'spades', 'diamonds'];

  // Opções do menu. `value` é o que volta em showMenu; `aria` detalha para leitores de tela.
  const MENU_GROUPS = [
    {
      key: 'players', label: 'Modo',
      options: [
        { value: 2, title: '1×1', sub: 'mano a mano' },
        { value: 4, title: '2×2', sub: 'com parceiro' },
      ],
    },
    {
      key: 'deck', label: 'Baralho',
      options: [
        { value: 'limpo', title: 'Limpo', sub: '24 cartas · padrão', aria: 'Limpo — 24 cartas (padrão, manilha limpa)' },
        { value: 'sujo', title: 'Sujo', sub: '40 cartas', aria: 'Sujo — 40 cartas' },
      ],
    },
    {
      key: 'format', label: 'Partida',
      options: [
        { value: 'single', title: '1 jogo', sub: 'até 12 pontos' },
        { value: 'bestOf3', title: 'Melhor de 3', sub: 'quem fizer 2 jogos' },
      ],
    },
    {
      key: 'difficulty', label: 'Dificuldade',
      options: [
        { value: 'facil', title: 'Fácil' },
        { value: 'medio', title: 'Médio' },
        { value: 'dificil', title: 'Difícil' },
      ],
    },
    {
      key: 'speed', label: 'Velocidade',
      options: [
        { value: 0.7, title: 'Calma' },
        { value: 1, title: 'Normal' },
        { value: 1.5, title: 'Rápida' },
      ],
    },
    {
      key: 'quality', label: 'Qualidade gráfica',
      options: [
        { value: 'high', title: 'Alta', aria: 'Qualidade gráfica alta' },
        { value: 'low', title: 'Leve', aria: 'Qualidade gráfica leve' },
      ],
    },
  ];

  const MENU_SWITCHES = [
    { key: 'sound', label: 'Som' },
    { key: 'voice', label: 'Voz' },
    { key: 'highlightManilhas', label: 'Destacar manilhas' },
    { key: 'explainSignals', label: 'Explicar os sinais', title: 'Quando seu parceiro fizer um sinal, o jogo diz o que ele quer dizer' },
  ];

  const ADVICE_CALL = {
    accept: 'Pode aceitar, parceiro!',
    raise: 'Aumenta que a gente segura!',
    run: 'Corre dessa, tô fraco.',
  };
  const ADVICE_ONZE = {
    accept: 'Bora jogar, dá pra ganhar!',
    raise: 'Bora jogar, dá pra ganhar!',
    run: 'Melhor correr dessa.',
  };

  // Posições de reserva (fração da tela) quando não há provider da cena.
  const FALLBACK_SEATS = {
    4: [[0.5, 1], [0.86, 0.42], [0.5, 0.27], [0.14, 0.42]],
    2: [[0.5, 1], [0.5, 0.27]],
  };

  const ICONS = {
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    rules: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2.9-1.2 1.7v.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16.9" r="1.1" fill="currentColor"/></svg>',
    soundOn: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9.3h3.3L12 5.4v13.2l-4.7-3.9H4z" fill="currentColor"/><path d="M15.4 9.1a4 4 0 0 1 0 5.8M17.9 6.6a7.6 7.6 0 0 1 0 10.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    soundOff: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9.3h3.3L12 5.4v13.2l-4.7-3.9H4z" fill="currentColor"/><path d="M15.8 9.6l4.8 4.8M20.6 9.6l-4.8 4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    cardBack: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="5.5" y="3" width="13" height="18" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.6 7.2l6.8 9.6M15.4 7.2l-6.8 9.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  };

  let instanceCount = 0;

  // ---------------------------------------------------------------- utilidades

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const key of Object.keys(attrs)) {
        const v = attrs[key];
        if (v === null || v === undefined || v === false) continue;
        if (key === 'class') node.className = v;
        else if (key === 'text') node.textContent = v;
        else if (key === 'html') node.innerHTML = v;
        else if (key === 'hidden') node.hidden = true;
        else node.setAttribute(key, v === true ? '' : String(v));
      }
    }
    if (children) {
      for (const child of [].concat(children)) {
        if (child === null || child === undefined || child === false) continue;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
      }
    }
    return node;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function prefersReducedMotion() {
    try {
      return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (_) {
      return false;
    }
  }

  function readPrefs() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(PREFS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writePrefs(patch) {
    try {
      const next = Object.assign({}, readPrefs(), patch);
      root.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch (_) {
      // Armazenamento indisponível (modo privado, file:// bloqueado): segue sem lembrar.
    }
  }

  function sanitizeSettings(input) {
    const s = Object.assign({}, DEFAULT_SETTINGS, input || {});
    const out = {};
    const players = Number(s.players);
    out.players = players === 2 ? 2 : 4;
    out.deck = s.deck === 'sujo' ? 'sujo' : 'limpo';
    out.format = s.format === 'bestOf3' ? 'bestOf3' : 'single';
    out.difficulty = ['facil', 'medio', 'dificil'].indexOf(s.difficulty) >= 0 ? s.difficulty : DEFAULT_SETTINGS.difficulty;
    const speed = Number(s.speed);
    out.speed = Number.isFinite(speed) && speed > 0 ? clamp(speed, 0.1, 10) : DEFAULT_SETTINGS.speed;
    out.sound = s.sound !== false;
    out.voice = s.voice !== false;
    out.highlightManilhas = s.highlightManilhas !== false;
    out.explainSignals = s.explainSignals !== false;
    out.quality = s.quality === 'low' ? 'low' : 'high';
    out.seats2 = cleanSeats(s.seats2, [1]);
    out.seats4 = cleanSeats(s.seats4, [1, 2, 3]);
    return out;
  }

  function cleanSeats(v, seats) {
    const out = {};
    if (!v || typeof v !== 'object') return out;
    for (const seat of seats) {
      const id = v[seat];
      if (typeof id === 'string' && /^[a-z0-9-]{1,48}$/.test(id)) out[seat] = id;
    }
    return out;
  }

  function sameValue(a, b) {
    if (a && b && typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
    return a === b;
  }

  function personagensApi() {
    const P = Truco.Personagens;
    return P && typeof P.lista === 'function' ? P : null;
  }

  function parseCard(card) {
    if (!card) return null;
    if (typeof card === 'string') {
      const id = card.trim();
      if (id.length < 2) return null;
      const letter = id.slice(-1).toLowerCase();
      const rank = id.slice(0, -1).toUpperCase();
      const suit = SUIT_BY_LETTER[letter];
      if (!suit || !RANK_NAMES[rank]) return null;
      return { id: rank + letter, rank, suit, hidden: false };
    }
    if (card.hidden) return { hidden: true };
    const rank = String(card.rank || '').toUpperCase();
    if (!RANK_NAMES[rank] || !SUIT_INFO[card.suit]) return card.id ? parseCard(card.id) : null;
    return { id: card.id || rank + SUIT_INFO[card.suit].letter, rank, suit: card.suit, hidden: false };
  }

  function rankName(rank) {
    const R = Truco.Rules;
    return (R && R.RANK_NAMES && R.RANK_NAMES[rank]) || RANK_NAMES[rank] || String(rank || '');
  }

  function cardLabel(c) {
    return c && !c.hidden ? c.rank + SUIT_INFO[c.suit].symbol : '';
  }

  function cardName(c, manilhaRank) {
    if (!c) return '';
    if (c.hidden) return 'Carta virada';
    const R = Truco.Rules;
    if (R && typeof R.fullName === 'function') {
      try {
        return R.fullName({ id: c.id, rank: c.rank, suit: c.suit }, manilhaRank || undefined);
      } catch (_) {
        // cai no nome local
      }
    }
    const base = rankName(c.rank) + ' de ' + SUIT_INFO[c.suit].name;
    return manilhaRank && c.rank === manilhaRank ? MANILHA_NAMES[c.suit] + ' (' + base + ')' : base;
  }

  function nextValue(v) {
    const i = VALUE_LADDER.indexOf(Number(v));
    return i >= 0 && i < VALUE_LADDER.length - 1 ? VALUE_LADDER[i + 1] : null;
  }

  function prevValue(v) {
    const i = VALUE_LADDER.indexOf(Number(v));
    return i > 0 ? VALUE_LADDER[i - 1] : 1;
  }

  function pointsText(n) {
    return n === 1 ? '1 ponto' : n + ' pontos';
  }

  function shoutText(name) {
    const t = String(name || '').trim();
    if (!t) return '';
    return /[!?]$/.test(t) ? t.toUpperCase() : t.toUpperCase() + '!';
  }

  function overlapArea(a, b) {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? w * h : 0;
  }

  /**
   * Posiciona um balão (w×h) apontando para `anchor`: dentro da tela, nunca no terço
   * central inferior e, se der, sem cobrir painéis nem outros balões (`view.obstacles`).
   * Escolhe entre alturas candidatas a de menor custo (sobreposição + distância do falante).
   * Função pura: devolve { left, top, below, tailX } em px relativos ao HUD.
   */
  function layoutBalloon(anchor, size, view) {
    const gap = 14;
    const m = view.margin || 8;
    const minLeft = (view.insetLeft || 0) + m;
    const maxLeft = Math.max(minLeft, view.w - (view.insetRight || 0) - m - size.w);
    const minTop = (view.insetTop || 0) + m;
    const maxTop = Math.max(minTop, view.h - (view.insetBottom || 0) - m - size.h);
    const zone = { left: view.w / 3, right: (view.w * 2) / 3, top: (view.h * 2) / 3, bottom: Infinity };
    const obstacles = view.obstacles || [];
    const centered = clamp(anchor.x - size.w / 2, minLeft, maxLeft);
    const aboveTop = anchor.y - size.h - gap;
    const belowTop = anchor.y + gap;
    const desired = aboveTop >= minTop ? aboveTop : belowTop;
    // A cauda precisa alcançar o falante: o deslocamento lateral é limitado.
    const reach = view.loose ? 0 : -14;
    const tops = [aboveTop, belowTop, zone.top - size.h - 10];
    const lefts = [centered];
    for (const o of obstacles) {
      tops.push(o.top - size.h - 8, o.bottom + 8);
      lefts.push(o.left - size.w - 8, o.right + 8);
    }

    let best = null;
    for (const rawLeft of lefts) {
      const left = clamp(rawLeft, minLeft, maxLeft);
      if (left !== centered && (anchor.x < left - reach || anchor.x > left + size.w + reach)) continue;
      for (const rawTop of tops) {
        const top = clamp(rawTop, minTop, maxTop);
        const box = { left, top, right: left + size.w, bottom: top + size.h };
        let cost = overlapArea(box, zone) * 1000;
        for (const o of obstacles) cost += overlapArea(box, o) * 2;
        cost += Math.abs(top - desired) * size.w * 0.25 + Math.abs(left - centered) * size.h * 0.25;
        if (anchor.y > top && anchor.y < box.bottom && anchor.x > left && anchor.x < box.right) cost += size.w * size.h;
        if (!best || cost < best.cost) best = { left, top, cost };
      }
    }
    const tailX = clamp(anchor.x - best.left, 18, Math.max(18, size.w - 18));
    return { left: best.left, top: best.top, below: best.top + size.h / 2 > anchor.y, tailX };
  }

  function adviceKey(advice) {
    if (!advice) return null;
    if (typeof advice === 'string') return ADVICE_CALL[advice] ? advice : null;
    if (typeof advice === 'object' && ADVICE_CALL[advice.action]) return advice.action;
    return null;
  }

  function adviceText(advice, table) {
    if (!advice) return '';
    if (typeof advice === 'string') return table[advice] || advice;
    if (typeof advice === 'object') return advice.text || table[advice.action] || '';
    return '';
  }

  // Conteúdo estático do modal "Como jogar" (resumo de docs/RULES.md).
  function chip(rank, suit) {
    const info = suit ? SUIT_INFO[suit] : null;
    const cls = 'rchip' + (info ? (info.red ? ' is-red' : ' is-black') : '');
    return '<span class="' + cls + '">' + rank + (info ? '<small>' + info.symbol + '</small>' : '') + '</span>';
  }
  const ARROW = '<span class="rseq-sep" aria-hidden="true">→</span>';
  const GT = '<span class="rseq-sep" aria-hidden="true">&gt;</span>';

  const RULES_HTML = [
    '<section class="rules-sec">',
    '<h3>O jogo</h3>',
    '<p>Truco Paulista em duplas (<b>2×2</b>: você e o parceiro sentado à sua frente) ou mano a mano (<b>1×1</b>). ',
    'Cada mão vale pontos (tentos) e ganha o jogo quem chegar primeiro a <b>12 pontos</b>. ',
    'Em <b>Melhor de 3</b>, leva a partida quem vencer 2 jogos.</p>',
    '</section>',

    '<section class="rules-sec">',
    '<h3>Baralho</h3>',
    '<p><b>Limpo (padrão):</b> 24 cartas — Q, J, K, A, 2 e 3 dos quatro naipes.</p>',
    '<p><b>Sujo:</b> 40 cartas — entram também 4, 5, 6 e 7.</p>',
    '<p class="rules-note">Cada jogador recebe 3 cartas.</p>',
    '</section>',

    '<section class="rules-sec is-wide">',
    '<h3>Vira e manilha</h3>',
    '<p>Depois de dar as cartas, vira-se uma carta na mesa: a <b>vira</b>. ',
    'A manilha é o posto <b>seguinte</b> ao da vira, numa sequência que dá a volta. O naipe da vira não importa.</p>',
    '<p class="rseq" role="img" aria-label="Sequência do baralho limpo: Q, J, K, A, 2, 3 e volta para Q">',
    chip('Q'), ARROW, chip('J'), ARROW, chip('K'), ARROW, chip('A'), ARROW, chip('2'), ARROW, chip('3'), ARROW,
    '<span class="rseq-loop">volta à ' + chip('Q') + '</span></p>',
    '<ul class="rules-list">',
    '<li>Vira ' + chip('K', 'hearts') + ' → manilha <b>A</b></li>',
    '<li>Vira ' + chip('3', 'spades') + ' → manilha <b>Q</b> (dá a volta)</li>',
    '<li>No sujo: vira ' + chip('7', 'diamonds') + ' → manilha <b>Q</b>; vira ' + chip('3', 'clubs') + ' → manilha <b>4</b></li>',
    '</ul>',
    '</section>',

    '<section class="rules-sec">',
    '<h3>Força das manilhas</h3>',
    '<p>As 4 manilhas ganham de qualquer outra carta. Entre elas, vale o naipe:</p>',
    '<ol class="rules-manilhas">',
    '<li><span class="rsuit is-black">♣</span><b>Zap</b><small>paus</small></li>',
    '<li><span class="rsuit is-red">♥</span><b>Copas</b><small>copas</small></li>',
    '<li><span class="rsuit is-black">♠</span><b>Espadilha</b><small>espadas</small></li>',
    '<li><span class="rsuit is-red">♦</span><b>Pica-fumo</b><small>ouros</small></li>',
    '</ol>',
    '</section>',

    '<section class="rules-sec">',
    '<h3>Cartas comuns</h3>',
    '<p>Da maior para a menor, sem olhar o naipe:</p>',
    '<p class="rseq" role="img" aria-label="Três, Dois, Ás, Rei, Valete, Dama">',
    chip('3'), GT, chip('2'), GT, chip('A'), GT, chip('K'), GT, chip('J'), GT, chip('Q'), '</p>',
    '<p class="rules-note">No sujo a escada continua: … Q &gt; 7 &gt; 6 &gt; 5 &gt; 4. ',
    'Cartas do mesmo posto empatam (3♣ = 3♦). O posto que virou manilha sai dessa ordem.</p>',
    '</section>',

    '<section class="rules-sec">',
    '<h3>Rodadas</h3>',
    '<p>Cada mão tem até 3 rodadas. Cada um joga uma carta por rodada, em sentido anti-horário; ',
    'em dupla, vale a maior carta do time. Quem vencer <b>2 rodadas</b> leva a mão.</p>',
    '<p class="rules-note"><b>Pé:</b> quem deu as cartas · <b>Mão:</b> quem joga primeiro.</p>',
    '</section>',

    '<section class="rules-sec">',
    '<h3>Empates — “cangou!”</h3>',
    '<ul class="rules-list">',
    '<li>Empatou a 1ª: a 2ª decide (se empatar de novo, a 3ª decide).</li>',
    '<li>Alguém venceu a 1ª e depois empatou (na 2ª ou na 3ª): leva quem venceu a 1ª.</li>',
    '<li>Três empates: ninguém pontua.</li>',
    '</ul>',
    '<p class="rules-note">Depois de um empate, abre a rodada seguinte quem jogou primeiro a carta empatada mais alta.</p>',
    '</section>',

    '<section class="rules-sec is-wide">',
    '<h3>Truco, seis, nove e doze</h3>',
    '<p>Na sua vez, antes de jogar, você pode pedir <b>truco</b>. O outro time responde:</p>',
    '<ul class="rules-list">',
    '<li><b>Cai!</b> — aceita, e a mão passa a valer o novo valor;</li>',
    '<li><b>Aumentar</b> — aceita e já pede o próximo degrau;</li>',
    '<li><b>Corro</b> — desiste, e quem pediu leva o valor anterior.</li>',
    '</ul>',
    '<table class="rules-table">',
    '<thead><tr><th scope="col">Pedido</th><th scope="col">Vale se aceitar</th><th scope="col">Se correrem, quem pediu leva</th></tr></thead>',
    '<tbody>',
    '<tr><th scope="row">Truco!</th><td>3</td><td>1</td></tr>',
    '<tr><th scope="row">Seis!</th><td>6</td><td>3</td></tr>',
    '<tr><th scope="row">Nove!</th><td>9</td><td>6</td></tr>',
    '<tr><th scope="row">Doze!</th><td>12</td><td>9</td></tr>',
    '</tbody></table>',
    '<p class="rules-note">O mesmo time não aumenta duas vezes seguidas. Quem aceitou pode aumentar depois, na vez de um dos seus jogadores.</p>',
    '</section>',

    '<section class="rules-sec">',
    '<h3>Carta encoberta</h3>',
    '<p>A partir da 2ª rodada, quem não abre a rodada pode jogar a carta virada para baixo (botão <b>Encobrir</b>). ',
    'Ela não vale nada: nunca ganha nem empata — serve para esconder o jogo.</p>',
    '</section>',

    '<section class="rules-sec">',
    '<h3>Mão de onze</h3>',
    '<p>Quando só um time tem 11 pontos, ele vê as cartas do parceiro e decide: <b>jogar</b> (a mão vale 3) ',
    'ou <b>correr</b> (o adversário ganha 1). Ninguém pode pedir truco.</p>',
    '</section>',

    '<section class="rules-sec">',
    '<h3>Mão de ferro</h3>',
    '<p>Com 11 × 11, todo mundo joga às cegas, sem ver as próprias cartas e sem truco. Quem vencer a mão ganha o jogo.</p>',
    '<p class="rules-note">Três empates: nova mão de ferro.</p>',
    '</section>',

    '<section class="rules-sec rules-keys">',
    '<h3>Atalhos de teclado</h3>',
    '<ul class="rules-kbd">',
    '<li><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><span>jogar a carta</span></li>',
    '<li><kbd>T</kbd><span>pedir truco</span></li>',
    '<li><kbd>E</kbd><span>encobrir</span></li>',
    '<li><kbd>C</kbd><kbd>S</kbd><kbd>R</kbd><span>responder: cai, aumentar, corro</span></li>',
    '<li><kbd>J</kbd><kbd>R</kbd><span>mão de onze: jogar, correr</span></li>',
    '<li><kbd>Esc</kbd><span>menu</span></li>',
    '</ul>',
    '</section>',
  ].join('');

  // ---------------------------------------------------------------- HUD

  class Hud {
    constructor(rootEl) {
      if (!rootEl || typeof rootEl.appendChild !== 'function') {
        throw new Error('HUD.create: elemento raiz inválido');
      }
      this.root = rootEl;
      this.uid = 'hud' + ++instanceCount;
      this.names = ['Você', 'Tião', 'Zeca', 'Dito'];
      this.settings = sanitizeSettings(Object.assign({}, DEFAULT_SETTINGS, readPrefs()));
      this.actionCbs = [];
      this.settingsCbs = [];
      this.actions = { visible: false, canCall: false, callName: 'Truco', canFaceDown: false, faceDown: false };
      this.callLocked = false;
      this.hand = {
        value: 1, vira: null, manilhaRank: null, special: null,
        roundResults: [null, null, null], dealerName: '', maoName: '',
      };
      this.shownViraId = undefined;
      this.score = [null, null];
      this.gamesWon = null;
      this.seatPosProvider = null;
      this.balloons = new Map();
      this.balloonRaf = 0;
      this.bannerNode = null;
      this.bannerTimer = 0;
      this.dialogQueue = [];
      this.activeDialog = null;
      this.menu = null;
      this.studio = null;
      this.rules = null;
      this.timers = new Set();
      this.safe = { top: 0, right: 0, bottom: 0, left: 0 };
      this.destroyed = false;

      this.build();
      this.bind();
      this.renderSettings();
      this.renderActions();
      this.renderHandInfo();
    }

    // ------------------------------------------------------------ construção

    build() {
      const host = this.root;
      host.classList.add('hud');
      host.textContent = '';

      // Placar
      this.scoreNums = [el('span', { class: 'score-num', text: '0' }), el('span', { class: 'score-num', text: '0' })];
      this.gamesEls = [el('span', { class: 'score-games', hidden: true }), el('span', { class: 'score-games', hidden: true })];
      this.valueNum = el('span', { class: 'value-num', text: '1' });
      this.valueChip = el('span', { class: 'value-chip' }, [el('span', { class: 'hud-label', text: 'Vale' }), this.valueNum]);
      this.specialTag = el('span', { class: 'special-tag', hidden: true });
      this.scoreSr = el('span', { class: 'sr-only' });
      this.scorePanel = el('section', { class: 'hud-panel hud-score', 'aria-label': 'Placar' }, [
        this.scoreSr,
        el('div', { class: 'score-teams', 'aria-hidden': 'true' }, [
          el('div', { class: 'score-team is-us' }, [el('span', { class: 'hud-label', text: 'Nós' }), this.scoreNums[0], this.gamesEls[0]]),
          el('span', { class: 'score-x', text: '×' }),
          el('div', { class: 'score-team is-them' }, [el('span', { class: 'hud-label', text: 'Eles' }), this.scoreNums[1], this.gamesEls[1]]),
        ]),
        el('div', { class: 'score-side' }, [this.valueChip, this.specialTag]),
      ]);

      // Barra de ícones
      this.btnMenu = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Menu', title: 'Menu (Esc)', 'aria-keyshortcuts': 'Escape', html: ICONS.menu });
      this.btnRules = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Como jogar', title: 'Como jogar', html: ICONS.rules });
      this.btnSound = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Som', 'aria-pressed': 'true', title: 'Som' });
      this.toolbar = el('div', { class: 'hud-tools', role: 'toolbar', 'aria-label': 'Opções' }, [this.btnMenu, this.btnRules, this.btnSound]);

      // Vira, manilha e rodadas
      this.viraSlot = el('div', { class: 'vira-card' });
      this.manilhaRankEl = el('span', { class: 'manilha-rank', text: '—' });
      this.manilhaNameEl = el('span', { class: 'manilha-name', text: '' });
      this.roundEls = [0, 1, 2].map((i) => el('li', { class: 'round', 'data-state': 'pending', 'aria-label': (i + 1) + 'ª rodada: a jogar' }));
      this.roundNoteEl = el('p', { class: 'round-note', 'aria-live': 'polite', hidden: true });
      this.dealEl = el('p', { class: 'deal-info', title: 'Pé: quem deu as cartas · Mão: quem joga primeiro' });
      const suitsTitle = MANILHA_ORDER.map((s) => MANILHA_NAMES[s] + ' ' + SUIT_INFO[s].symbol).join(' > ');
      this.infoPanel = el('section', { class: 'hud-panel hud-info', 'aria-label': 'Vira, manilha e rodadas', 'data-empty': 'true' }, [
        el('div', { class: 'info-main' }, [
          el('div', { class: 'vira-wrap' }, [this.viraSlot, el('span', { class: 'hud-label', text: 'Vira' })]),
          el('div', { class: 'manilha' }, [
            el('span', { class: 'hud-label', text: 'Manilha' }),
            this.manilhaRankEl,
            this.manilhaNameEl,
            el('span', { class: 'manilha-suits', title: suitsTitle, 'aria-label': 'Ordem das manilhas: ' + suitsTitle.replace(/ > /g, ', ') },
              MANILHA_ORDER.map((s) => el('span', { class: SUIT_INFO[s].red ? 'is-red' : 'is-black', text: SUIT_INFO[s].symbol, 'aria-hidden': 'true' }))),
          ]),
        ]),
        el('div', { class: 'info-rounds' }, [
          el('span', { class: 'hud-label', text: 'Rodadas' }),
          el('ol', { class: 'rounds' }, this.roundEls),
        ]),
        this.roundNoteEl,
        this.dealEl,
      ]);

      this.top = el('div', { class: 'hud-top' }, [this.scorePanel, this.toolbar, this.infoPanel]);

      // Turno do humano
      this.statusText = el('span', { class: 'status-text' });
      this.statusEl = el('div', { class: 'hud-status', role: 'status', 'aria-live': 'polite', hidden: true }, [
        el('span', { class: 'status-dot', 'aria-hidden': 'true' }), this.statusText,
      ]);
      this.btnFaceDown = el('button', { type: 'button', class: 'btn-facedown', 'aria-pressed': 'false', 'aria-keyshortcuts': 'E', title: 'Jogar a próxima carta virada para baixo (E)', hidden: true }, [
        el('span', { class: 'btn-facedown-icon', html: ICONS.cardBack }),
        el('span', { class: 'btn-facedown-text', text: 'Encobrir' }),
        el('kbd', { class: 'key-hint', text: 'E', 'aria-hidden': 'true' }),
      ]);
      this.callText = el('span', { class: 'btn-truco-text', text: 'TRUCO!' });
      this.btnCall = el('button', { type: 'button', class: 'btn-truco', 'aria-keyshortcuts': 'T', hidden: true }, [
        this.callText,
        el('kbd', { class: 'key-hint', text: 'T', 'aria-hidden': 'true' }),
      ]);
      this.faceSlot = el('div', { class: 'hud-actions-face', hidden: true }, [this.btnFaceDown]);
      this.callSlot = el('div', { class: 'hud-actions-call', hidden: true }, [this.btnCall]);
      this.actionsEl = el('div', { class: 'hud-actions' }, [
        el('div', { class: 'hud-actions-status' }, [this.statusEl]),
        this.faceSlot,
        this.callSlot,
      ]);

      this.layers = {
        game: el('div', { class: 'hud-layer hud-game' }, [this.top, this.actionsEl]),
        balloons: el('div', { class: 'hud-layer hud-balloons', 'aria-hidden': 'true' }),
        banners: el('div', { class: 'hud-layer hud-banners', 'aria-hidden': 'true' }),
        toasts: el('div', { class: 'hud-layer hud-toasts', role: 'log', 'aria-live': 'polite', 'aria-label': 'Avisos' }),
        dialogs: el('div', { class: 'hud-layer hud-dialogs' }),
        menu: el('div', { class: 'hud-layer hud-menu' }),
        studio: el('div', { class: 'hud-layer hud-studio' }),
        rules: el('div', { class: 'hud-layer hud-rules' }),
      };
      this.announcer = el('div', { class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });
      this.safeProbe = el('div', { class: 'hud-safe-probe', 'aria-hidden': 'true' });

      for (const key of Object.keys(this.layers)) host.appendChild(this.layers[key]);
      host.appendChild(this.announcer);
      host.appendChild(this.safeProbe);
      this.readSafeArea();
    }

    bind() {
      this.onKeyDown = (e) => this.handleKey(e);
      this.onResize = () => {
        this.readSafeArea();
        this.positionBalloons();
      };
      root.addEventListener('keydown', this.onKeyDown);
      root.addEventListener('resize', this.onResize);

      this.btnMenu.addEventListener('click', () => this.emit('menu'));
      this.btnRules.addEventListener('click', () => {
        this.emit('rules');
        this.showRules();
      });
      this.btnSound.addEventListener('click', () => this.toggleSound());
      this.btnCall.addEventListener('click', () => this.pressCall());
      this.btnFaceDown.addEventListener('click', () => this.toggleFaceDown());
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.cancelDialogs(null);
      if (this.studio) this.studio.close();
      if (this.menu) this.menu.finish(null);
      if (this.rules) this.rules.close();
      root.removeEventListener('keydown', this.onKeyDown);
      root.removeEventListener('resize', this.onResize);
      if (this.balloonRaf) cancelAnimationFrame(this.balloonRaf);
      for (const t of this.timers) clearTimeout(t);
      this.timers.clear();
      this.balloons.clear();
      this.actionCbs = [];
      this.settingsCbs = [];
      this.root.textContent = '';
      this.root.classList.remove('hud', 'has-menu', 'has-modal', 'has-banner');
    }

    later(fn, ms) {
      const id = setTimeout(() => {
        this.timers.delete(id);
        fn();
      }, ms);
      this.timers.add(id);
      return id;
    }

    cancelLater(id) {
      if (!id) return;
      clearTimeout(id);
      this.timers.delete(id);
    }

    readSafeArea() {
      try {
        const cs = getComputedStyle(this.safeProbe);
        this.safe = {
          top: parseFloat(cs.paddingTop) || 0,
          right: parseFloat(cs.paddingRight) || 0,
          bottom: parseFloat(cs.paddingBottom) || 0,
          left: parseFloat(cs.paddingLeft) || 0,
        };
      } catch (_) {
        this.safe = { top: 0, right: 0, bottom: 0, left: 0 };
      }
    }

    // ------------------------------------------------------------ eventos

    onAction(cb) {
      if (typeof cb !== 'function') return () => {};
      this.actionCbs.push(cb);
      return () => {
        this.actionCbs = this.actionCbs.filter((f) => f !== cb);
      };
    }

    onSettings(cb) {
      if (typeof cb !== 'function') return () => {};
      this.settingsCbs.push(cb);
      return () => {
        this.settingsCbs = this.settingsCbs.filter((f) => f !== cb);
      };
    }

    emit(action, arg) {
      for (const cb of this.actionCbs.slice()) {
        try {
          if (arg === undefined) cb(action);
          else cb(action, arg);
        } catch (err) {
          setTimeout(() => {
            throw err;
          }, 0);
        }
      }
    }

    emitSettings() {
      const snapshot = Object.assign({}, this.settings);
      for (const cb of this.settingsCbs.slice()) {
        try {
          cb(Object.assign({}, snapshot));
        } catch (err) {
          setTimeout(() => {
            throw err;
          }, 0);
        }
      }
    }

    handleKey(e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key;
      if (key === 'Escape') {
        if (this.rules) {
          e.preventDefault();
          this.rules.close();
          return;
        }
        if (this.studio) {
          e.preventDefault();
          this.studio.escape();
          return;
        }
        if (this.menu && this.menu.resumable) {
          // Esc na pausa = "Continuar" (aplica som, voz, destaque, velocidade e qualidade).
          e.preventDefault();
          this.menu.resume();
          return;
        }
        if (this.menu || this.activeDialog) return;
        e.preventDefault();
        this.emit('menu');
        return;
      }
      if (this.rules || this.menu || this.studio) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
      if (e.repeat) return;
      if (this.activeDialog) {
        // Atalhos do diálogo: C/S/R no pedido, J/R na mão de onze.
        const keys = this.activeDialog.keys;
        const btn = keys && keys[String(key || '').toLowerCase()];
        if (btn && btn.isConnected && !btn.disabled) {
          e.preventDefault();
          btn.click();
        }
        return;
      }
      if (key === '1' || key === '2' || key === '3') {
        if (!this.actions.visible) return;
        e.preventDefault();
        this.emit('playIndex', Number(key) - 1);
        return;
      }
      const k = String(key || '').toLowerCase();
      if (k === 't') {
        if (this.actions.visible && this.actions.canCall && !this.callLocked) {
          e.preventDefault();
          this.pressCall();
        }
      } else if (k === 'e') {
        if (this.actions.visible && this.actions.canFaceDown) {
          e.preventDefault();
          this.toggleFaceDown();
        }
      }
    }

    pressCall() {
      if (this.callLocked || !this.actions.visible || !this.actions.canCall) return;
      // Trava até o próximo setActions para não pedir duas vezes com clique duplo.
      this.callLocked = true;
      this.btnCall.setAttribute('aria-disabled', 'true');
      this.btnCall.classList.add('is-pressed');
      this.emit('call');
    }

    toggleFaceDown() {
      if (!this.actions.visible || !this.actions.canFaceDown) return;
      this.actions.faceDown = !this.actions.faceDown;
      this.renderActions();
      this.emit('toggleFaceDown');
    }

    toggleSound() {
      this.settings.sound = !this.settings.sound;
      writePrefs({ sound: this.settings.sound });
      this.renderSettings();
      this.emitSettings();
    }

    // ------------------------------------------------------------ estado da mesa

    setNames(namesBySeat) {
      if (!namesBySeat || typeof namesBySeat !== 'object') return;
      const list = Array.isArray(namesBySeat)
        ? namesBySeat
        : Object.keys(namesBySeat).sort((a, b) => a - b).map((k) => namesBySeat[k]);
      if (!list.length) return;
      this.names = list.map((n, i) => (n ? String(n) : this.names[i] || 'Jogador ' + (i + 1)));
    }

    seatName(seat) {
      return this.names[seat] || (seat === 0 ? 'Você' : 'Jogador ' + (Number(seat) + 1));
    }

    partnerName() {
      return this.names.length >= 4 ? this.seatName(2) : 'Parceiro';
    }

    setScore(score, gamesWon) {
      const s = Array.isArray(score) ? score : [0, 0];
      for (let t = 0; t < 2; t++) {
        const shown = Math.min(Math.max(0, Number(s[t]) || 0), 12);
        const prev = this.score[t];
        this.scoreNums[t].textContent = String(shown);
        if (prev !== null && prev !== shown) this.flash(this.scoreNums[t], 'is-bump');
        this.score[t] = shown;
      }
      this.gamesWon = Array.isArray(gamesWon) ? [Number(gamesWon[0]) || 0, Number(gamesWon[1]) || 0] : null;
      for (let t = 0; t < 2; t++) {
        const g = this.gamesEls[t];
        if (!this.gamesWon) {
          g.hidden = true;
          continue;
        }
        g.hidden = false;
        g.textContent = '';
        const won = clamp(this.gamesWon[t], 0, 2);
        for (let i = 0; i < 2; i++) g.appendChild(el('i', { class: i < won ? 'is-won' : '' }));
      }
      let sr = 'Placar: nós ' + this.score[0] + ', eles ' + this.score[1] + '.';
      if (this.gamesWon) sr += ' Jogos: nós ' + this.gamesWon[0] + ', eles ' + this.gamesWon[1] + '.';
      this.scoreSr.textContent = sr;
    }

    setHandInfo(info) {
      if (!info || typeof info !== 'object') return;
      Object.assign(this.hand, info);
      this.renderHandInfo();
    }

    renderHandInfo() {
      const h = this.hand;
      const value = Number(h.value) || 1;
      const prevValue = this.valueNum.textContent;
      this.valueNum.textContent = String(value);
      this.valueChip.classList.toggle('is-raised', value > 1);
      this.valueChip.setAttribute('aria-label', 'A mão vale ' + pointsText(value));
      if (prevValue !== String(value) && this.shownViraId !== undefined) this.flash(this.valueChip, 'is-bump');

      const special = h.special === 'maoDeOnze' ? 'Mão de onze' : h.special === 'maoDeFerro' ? 'Mão de ferro' : '';
      this.specialTag.hidden = !special;
      this.specialTag.textContent = special;
      this.specialTag.dataset.kind = h.special || '';

      const vira = parseCard(h.vira);
      const viraId = vira && !vira.hidden ? vira.id : null;
      if (viraId !== this.shownViraId) {
        this.viraSlot.textContent = '';
        if (vira) {
          const card = this.renderMiniCard(vira, { manilhaRank: null });
          this.viraSlot.appendChild(card);
          if (this.shownViraId !== undefined) this.flash(card, 'is-flip');
        }
        this.shownViraId = viraId;
      }
      this.viraSlot.setAttribute('aria-label', vira ? 'Vira: ' + cardName(vira) : 'Vira: nenhuma');

      const mr = h.manilhaRank ? String(h.manilhaRank).toUpperCase() : '';
      this.manilhaRankEl.textContent = mr || '—';
      this.manilhaNameEl.textContent = mr ? rankName(mr) : '';
      this.infoPanel.dataset.empty = vira || mr ? 'false' : 'true';

      const results = Array.isArray(h.roundResults) ? h.roundResults : [];
      let currentMarked = false;
      for (let i = 0; i < 3; i++) {
        const r = results[i];
        let state = 'pending';
        let label = 'a jogar';
        if (r === 0) {
          state = 'win';
          label = 'vencemos';
        } else if (r === 1) {
          state = 'loss';
          label = 'perdemos';
        } else if (r === 'tie') {
          state = 'tie';
          label = 'empatou';
        }
        const node = this.roundEls[i];
        if (node.dataset.state !== state && state !== 'pending') this.flash(node, 'is-pop');
        node.dataset.state = state;
        const isCurrent = state === 'pending' && !currentMarked && vira !== null;
        node.classList.toggle('is-current', isCurrent);
        if (isCurrent) currentMarked = true;
        node.setAttribute('aria-label', (i + 1) + 'ª rodada: ' + label);
        node.textContent = state === 'win' ? '✓' : state === 'loss' ? '✕' : state === 'tie' ? '=' : '';
      }

      const parts = [];
      if (h.dealerName) parts.push('Pé: ' + h.dealerName);
      if (h.maoName) parts.push('Mão: ' + h.maoName);
      this.dealEl.textContent = parts.join(' · ');
      this.dealEl.hidden = parts.length === 0;
    }

    /** Resultado curto da última rodada, junto das bolinhas ('1ª: Juninho · 3♥'); null limpa. */
    setRoundNote(text) {
      const t = text ? String(text) : '';
      if (this.roundNoteEl.textContent === t && this.roundNoteEl.hidden === !t) return;
      this.roundNoteEl.textContent = t;
      this.roundNoteEl.hidden = !t;
      if (t) this.flash(this.roundNoteEl, 'is-fresh');
    }

    setActions(opts) {
      if (opts && typeof opts === 'object') Object.assign(this.actions, opts);
      this.callLocked = false;
      this.renderActions();
    }

    renderActions() {
      const a = this.actions;
      const showCall = !!(a.visible && a.canCall);
      const showFace = !!(a.visible && a.canFaceDown);
      const label = shoutText(a.callName || 'Truco') || 'TRUCO!';
      this.callText.textContent = label;
      this.btnCall.setAttribute('aria-label', 'Pedir ' + label.replace(/!$/, '').toLowerCase() + ' (T)');
      this.btnCall.classList.toggle('is-long', label.length > 6);
      this.btnCall.hidden = !showCall;
      this.callSlot.hidden = !showCall;
      this.btnCall.removeAttribute('aria-disabled');
      this.btnCall.classList.remove('is-pressed');
      this.btnFaceDown.hidden = !showFace;
      this.faceSlot.hidden = !showFace;
      this.btnFaceDown.setAttribute('aria-pressed', a.faceDown ? 'true' : 'false');
      this.btnFaceDown.classList.toggle('is-on', !!a.faceDown);
      this.statusEl.classList.toggle('is-turn', !!a.visible);
      this.actionsEl.classList.toggle('is-turn', !!a.visible);
    }

    setStatus(text) {
      const t = text ? String(text) : '';
      this.statusText.textContent = t;
      this.statusEl.hidden = !t;
    }

    setSettings(settings) {
      if (!settings || typeof settings !== 'object') return;
      this.settings = sanitizeSettings(Object.assign({}, this.settings, settings));
      this.renderSettings();
    }

    renderSettings() {
      const on = !!this.settings.sound;
      this.btnSound.innerHTML = on ? ICONS.soundOn : ICONS.soundOff;
      this.btnSound.setAttribute('aria-pressed', on ? 'true' : 'false');
      this.btnSound.setAttribute('title', on ? 'Som ligado' : 'Som desligado');
      this.btnSound.classList.toggle('is-off', !on);
    }

    // Reinicia uma animação CSS de destaque (bump, flip, pop).
    flash(node, cls) {
      if (!node) return;
      node.classList.remove(cls);
      void node.offsetWidth;
      node.classList.add(cls);
      this.later(() => node.classList.remove(cls), 700);
    }

    // ------------------------------------------------------------ cartas em miniatura

    renderMiniCard(card, opts) {
      const c = parseCard(card);
      const node = el('span', { class: 'mini-card', role: 'img' });
      if (!c) {
        node.classList.add('is-empty');
        node.setAttribute('aria-label', 'Sem carta');
        return node;
      }
      if (c.hidden) {
        node.classList.add('is-back');
        node.setAttribute('aria-label', (opts && opts.label) || 'Carta virada');
        const back = this.cardCanvas(c);
        if (back) {
          node.classList.add('has-canvas');
          node.appendChild(back);
        }
        return node;
      }
      const manilhaRank = opts && opts.manilhaRank;
      node.setAttribute('aria-label', cardName(c, manilhaRank));
      const canvas = this.cardCanvas(c);
      if (canvas) {
        node.classList.add('has-canvas');
        node.appendChild(canvas);
      } else {
        const info = SUIT_INFO[c.suit];
        node.classList.add(info.red ? 'is-red' : 'is-black');
        node.appendChild(el('span', { class: 'mc-corner', 'aria-hidden': 'true' }, [c.rank, el('br'), info.symbol]));
        node.appendChild(el('span', { class: 'mc-rank', text: c.rank, 'aria-hidden': 'true' }));
        node.appendChild(el('span', { class: 'mc-suit', text: info.symbol, 'aria-hidden': 'true' }));
      }
      if (manilhaRank && c.rank === manilhaRank && this.settings.highlightManilhas) {
        node.classList.add('is-manilha');
        node.appendChild(el('span', { class: 'mc-tag', text: MANILHA_NAMES[c.suit], 'aria-hidden': 'true' }));
      }
      return node;
    }

    // Cópia reduzida da face (ou do verso) gerada por Truco.CardTex (se o módulo existir).
    cardCanvas(c) {
      const tex = Truco.CardTex;
      const back = !!c.hidden;
      const key = back ? 'verso' : c.id;
      if (!tex || typeof (back ? tex.backCanvas : tex.faceCanvas) !== 'function') return null;
      const targetW = 176;
      const fail = (err) => {
        if (!reportedCards.has(key)) {
          reportedCards.add(key);
          reportError(err, 'HUD: miniatura ' + key);
        }
        return null;
      };
      let src;
      try {
        src = back ? tex.backCanvas({ width: targetW * 2 }) : tex.faceCanvas(c.id, { width: targetW * 2 });
      } catch (err) {
        return fail(err);
      }
      if (!src || !src.width || !src.height) return null;
      try {
        let current = src;
        while (current.width / 2 >= targetW) {
          const half = document.createElement('canvas');
          half.width = Math.round(current.width / 2);
          half.height = Math.round(current.height / 2);
          const hctx = half.getContext('2d');
          hctx.imageSmoothingQuality = 'high';
          hctx.drawImage(current, 0, 0, half.width, half.height);
          current = half;
        }
        const out = document.createElement('canvas');
        out.width = targetW;
        out.height = Math.round((targetW * src.height) / src.width);
        const ctx = out.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(current, 0, 0, out.width, out.height);
        out.setAttribute('aria-hidden', 'true');
        return out;
      } catch (err) {
        return fail(err);
      }
    }

    // ------------------------------------------------------------ balões de fala

    setSeatPosProvider(fn) {
      this.seatPosProvider = typeof fn === 'function' ? fn : null;
      this.positionBalloons();
    }

    seatAnchor(seat, w, h) {
      if (this.seatPosProvider) {
        try {
          const p = this.seatPosProvider(seat);
          if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
            const r = this.root.getBoundingClientRect();
            return { x: p.x - r.left, y: p.y - r.top };
          }
        } catch (_) {
          // usa a posição de reserva
        }
      }
      const table = FALLBACK_SEATS[this.names.length === 2 ? 2 : 4];
      const f = table[seat] || [0.5, 0.3];
      return { x: f[0] * w, y: f[1] * h };
    }

    hasModal() {
      return !!(this.menu || this.rules || this.activeDialog);
    }

    /** Some com todos os balões na hora (ex.: abriu um diálogo ou menu por cima da mesa). */
    clearBalloons() {
      for (const seat of Array.from(this.balloons.keys())) this.removeBalloon(seat, true);
    }

    speech(seat, text, opts) {
      if (text === null || text === undefined || String(text).trim() === '') return;
      // Com diálogo/menu aberto, balão nenhum: ficaria escondido atrás do modal.
      if (this.hasModal()) return;
      const o = opts || {};
      const shout = !!o.shout;
      const msg = String(text);
      const ms = o.ms > 0 ? o.ms : shout ? 1900 : clamp(1400 + msg.length * 45, 1900, 4800);
      this.removeBalloon(seat, true);

      const bubble = el('div', { class: 'balloon' });
      if (!shout) bubble.appendChild(el('span', { class: 'balloon-name', text: this.seatName(seat) }));
      bubble.appendChild(el('span', { class: 'balloon-text', text: msg }));
      const wrap = el('div', { class: 'balloon-wrap' + (shout ? ' is-shout' : ''), 'data-seat': String(seat) }, [bubble]);
      this.layers.balloons.appendChild(wrap);

      const b = { seat, wrap, shout, timer: 0 };
      this.balloons.set(seat, b);
      this.positionBalloons();
      b.timer = this.later(() => {
        if (this.balloons.get(seat) === b) this.removeBalloon(seat, false);
      }, ms);
      this.announce(this.seatName(seat) + ': ' + msg);
      this.ensureBalloonLoop();
    }

    removeBalloon(seat, immediate) {
      const b = this.balloons.get(seat);
      if (!b) return;
      this.balloons.delete(seat);
      this.cancelLater(b.timer);
      if (immediate || prefersReducedMotion()) {
        b.wrap.remove();
        return;
      }
      b.wrap.classList.add('is-leaving');
      this.later(() => b.wrap.remove(), 240);
    }

    ensureBalloonLoop() {
      if (this.balloonRaf || !this.balloons.size) return;
      const tick = () => {
        this.balloonRaf = 0;
        if (this.destroyed || !this.balloons.size) return;
        this.positionBalloons();
        this.balloonRaf = requestAnimationFrame(tick);
      };
      this.balloonRaf = requestAnimationFrame(tick);
    }

    positionBalloons() {
      if (!this.balloons.size) return;
      const rect = this.root.getBoundingClientRect();
      // Lê todos os tamanhos antes de escrever posições (evita layout repetido).
      const obstacles = [];
      for (const node of [this.scorePanel, this.toolbar, this.infoPanel, this.statusEl, this.btnFaceDown, this.btnCall]) {
        if (!node.offsetParent) continue;
        const b = node.getBoundingClientRect();
        if (b.width && b.height) {
          obstacles.push({ left: b.left - rect.left, top: b.top - rect.top, right: b.right - rect.left, bottom: b.bottom - rect.top });
        }
      }
      const view = {
        w: rect.width,
        h: rect.height,
        margin: 8,
        insetTop: this.safe.top,
        insetRight: this.safe.right,
        insetBottom: this.safe.bottom,
        insetLeft: this.safe.left,
        obstacles,
      };
      // Ordem de encaixe: o humano primeiro (mais restrito), depois gritos, depois o resto.
      const items = [];
      for (const b of this.balloons.values()) {
        items.push({ b, w: b.wrap.offsetWidth, h: b.wrap.offsetHeight, rank: b.seat === 0 ? 0 : b.shout ? 1 : 2 });
      }
      items.sort((a, b) => a.rank - b.rank);
      for (const it of items) {
        const anchor = this.seatAnchor(it.b.seat, view.w, view.h);
        view.loose = !!it.b.shout;
        const pos = layoutBalloon(anchor, { w: it.w, h: it.h }, view);
        // Os balões seguintes desviam deste.
        obstacles.push({ left: pos.left, top: pos.top, right: pos.left + it.w, bottom: pos.top + it.h });
        const wrap = it.b.wrap;
        wrap.style.transform = 'translate3d(' + Math.round(pos.left) + 'px,' + Math.round(pos.top) + 'px,0)';
        wrap.style.setProperty('--tail-x', Math.round(pos.tailX) + 'px');
        wrap.classList.toggle('is-below', pos.below);
      }
    }

    announce(text) {
      this.announcer.textContent = '';
      this.later(() => {
        this.announcer.textContent = text;
      }, 30);
    }

    // ------------------------------------------------------------ letreiros e toasts

    banner(text, opts) {
      if (!text) return;
      const o = opts || {};
      const kind = ['truco', 'onze', 'ferro', 'info'].indexOf(o.kind) >= 0 ? o.kind : 'info';
      const ms = o.ms > 0 ? o.ms : kind === 'truco' ? 1500 : 2100;
      if (this.bannerNode) this.dismissBanner(true);
      const node = el('div', { class: 'banner banner--' + kind + (String(text).length > 8 ? ' is-long' : '') }, [
        el('div', { class: 'banner-text', text: String(text) }),
        o.sub ? el('div', { class: 'banner-sub', text: String(o.sub) }) : null,
      ]);
      this.layers.banners.appendChild(node);
      this.bannerNode = node;
      this.root.classList.add('has-banner');
      this.bannerTimer = this.later(() => this.dismissBanner(false), ms);
      this.announce(String(text) + (o.sub ? '. ' + o.sub : ''));
    }

    dismissBanner(fast) {
      const node = this.bannerNode;
      if (!node) return;
      this.bannerNode = null;
      this.root.classList.remove('has-banner');
      this.cancelLater(this.bannerTimer);
      if (prefersReducedMotion()) {
        node.remove();
        return;
      }
      node.classList.add(fast ? 'is-cut' : 'is-leaving');
      this.later(() => node.remove(), fast ? 160 : 420);
    }

    toast(text, opts) {
      if (!text) return;
      const o = opts || {};
      const kind = ['good', 'bad', 'neutral'].indexOf(o.kind) >= 0 ? o.kind : 'neutral';
      const ms = o.ms > 0 ? o.ms : 2800;
      const node = el('div', { class: 'toast toast--' + kind }, [
        el('span', { class: 'toast-icon', 'aria-hidden': 'true' }),
        el('span', { class: 'toast-text', text: String(text) }),
      ]);
      const layer = this.layers.toasts;
      layer.appendChild(node);
      const live = Array.prototype.filter.call(layer.children, (n) => !n.classList.contains('is-leaving'));
      while (live.length > 3) this.dropToast(live.shift());
      this.later(() => this.dropToast(node), ms);
    }

    dropToast(node) {
      if (!node || !node.parentNode || node.classList.contains('is-leaving')) return;
      if (prefersReducedMotion()) {
        node.remove();
        return;
      }
      node.classList.add('is-leaving');
      this.later(() => node.remove(), 260);
    }

    // ------------------------------------------------------------ diálogos de decisão

    // Fila: um diálogo por vez; cada Promise resolve exatamente uma vez.
    enqueueDialog(build) {
      return new Promise((resolve) => {
        this.dialogQueue.push({ build, resolve });
        this.pumpDialogs();
      });
    }

    pumpDialogs() {
      if (this.activeDialog || !this.dialogQueue.length || this.destroyed) return;
      const item = this.dialogQueue.shift();
      const prevFocus = document.activeElement;
      let settled = false;
      let view = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (this.activeDialog && this.activeDialog.finish === finish) this.activeDialog = null;
        if (view) this.dismissOverlay(view.node);
        this.syncModalState();
        if (!this.activeDialog && !this.menu && !this.rules && !this.studio) {
          // A tela final não devolve o foco (ele cairia num ícone da partida nova com o anel aceso).
          if (view && view.restoreFocus === false) this.blurInside();
          else this.restoreFocus(prevFocus);
        }
        item.resolve(value);
        this.pumpDialogs();
      };
      try {
        view = item.build(finish);
      } catch (err) {
        settled = true;
        item.resolve(null);
        setTimeout(() => {
          throw err;
        }, 0);
        this.pumpDialogs();
        return;
      }
      this.activeDialog = { finish, node: view.node, keys: view.keys || null, focus: view.focus || null };
      // Nada por trás do diálogo: letreiro e balões saem na hora.
      if (this.bannerNode) this.dismissBanner(true);
      this.layers.dialogs.appendChild(view.node);
      this.syncModalState();
      if (!this.menu && !this.rules && !this.studio) this.focusSoon(view.focus);
    }

    blurInside() {
      const active = document.activeElement;
      if (active && active !== document.body && this.root.contains(active) && typeof active.blur === 'function') active.blur();
    }

    /** Fecha diálogos pendentes (ex.: partida abandonada), resolvendo-os com `value`. */
    cancelDialogs(value) {
      const v = value === undefined ? null : value;
      const queued = this.dialogQueue.splice(0);
      for (const q of queued) q.resolve(v);
      if (this.activeDialog) this.activeDialog.finish(v);
    }

    dismissOverlay(node) {
      if (!node) return;
      node.inert = true;
      if (prefersReducedMotion()) {
        node.remove();
        return;
      }
      node.classList.add('is-leaving');
      this.later(() => node.remove(), 220);
    }

    focusSoon(target) {
      if (!target) return;
      requestAnimationFrame(() => {
        if (target.isConnected) {
          try {
            target.focus({ preventScroll: true });
          } catch (_) {
            target.focus();
          }
        }
      });
    }

    restoreFocus(prev) {
      if (prev && prev.isConnected && typeof prev.focus === 'function' && prev !== document.body && !prev.closest('[inert]')) {
        try {
          prev.focus({ preventScroll: true });
        } catch (_) {
          // sem foco anterior válido
        }
      } else if (document.activeElement && this.root.contains(document.activeElement)) {
        document.activeElement.blur();
      }
    }

    // Camadas abaixo do modal do topo ficam inertes (sem clique nem foco).
    syncModalState() {
      const top = this.rules ? 'rules' : this.studio ? 'studio' : this.menu ? 'menu' : this.activeDialog ? 'dialogs' : null;
      const order = ['game', 'dialogs', 'menu', 'studio', 'rules'];
      const topIdx = top ? order.indexOf(top) : -1;
      for (let i = 0; i < order.length; i++) this.layers[order[i]].inert = i < topIdx;
      this.root.classList.toggle('has-modal', !!top);
      this.root.classList.toggle('has-menu', !!this.menu);
      if (top) this.clearBalloons();
    }

    makeOverlay(kind, labelId, descId) {
      const card = el('div', {
        class: 'dialog dialog--' + kind,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': labelId,
        'aria-describedby': descId || null,
      });
      const overlay = el('div', { class: 'dialog-overlay dialog-overlay--' + kind }, [card]);
      return { overlay, card };
    }

    choiceButton(kind, title, sub, onClick, key) {
      const btn = el('button', { type: 'button', class: 'choice choice--' + kind, 'aria-keyshortcuts': key ? key.toUpperCase() : null }, [
        el('span', { class: 'choice-title', text: title }),
        sub ? el('span', { class: 'choice-sub', text: sub }) : null,
        key ? el('kbd', { class: 'key-hint', text: key.toUpperCase(), 'aria-hidden': 'true' }) : null,
      ]);
      btn.addEventListener('click', onClick);
      return btn;
    }

    /** Rodapé "Como funciona?" dos diálogos: abre as regras por cima; o foco volta ao diálogo. */
    helpFooter() {
      const link = el('button', { type: 'button', class: 'dialog-help', text: 'Como funciona?' });
      link.addEventListener('click', () => this.showRules());
      return el('div', { class: 'dialog-foot' }, [link]);
    }

    /**
     * Linha "Na mesa" do diálogo de resposta: as cartas já jogadas na mão, por rodada, com quem jogou,
     * a vencedora de cada rodada com contorno dourado, encobertas de verso, e a vira/manilha.
     * `table` = { rounds: [{ plays: [{ seat, name, card|null, faceDown }], winnerSeat, tie }], vira, manilhaRank }.
     */
    tableRecapNode(table) {
      if (!table || !Array.isArray(table.rounds)) return null;
      const rounds = table.rounds.filter((r) => r && Array.isArray(r.plays) && r.plays.length);
      if (!rounds.length) return null;
      const manilhaRank = table.manilhaRank ? String(table.manilhaRank).toUpperCase() : null;
      const items = rounds.map((r, i) => {
        const plays = r.plays.map((p) => {
          const hidden = p.faceDown || !p.card;
          const label = (p.name || this.seatName(p.seat)) + ': ' + (hidden ? 'encoberta' : cardName(parseCard(p.card) || {}, manilhaRank));
          const card = this.renderMiniCard(hidden ? { hidden: true } : p.card, { manilhaRank: null, label });
          if (!hidden) card.setAttribute('aria-label', label);
          const won = !r.tie && r.winnerSeat !== null && r.winnerSeat !== undefined && r.winnerSeat === p.seat;
          return el('li', { class: 'recap-play' + (won ? ' is-winner' : '') + (hidden ? ' is-hidden' : '') }, [
            card,
            el('span', { class: 'recap-name', text: p.name || this.seatName(p.seat), 'aria-hidden': 'true' }),
          ]);
        });
        const state = r.tie ? 'cangou' : r.winnerSeat === null || r.winnerSeat === undefined ? 'na mesa' : '';
        return el('li', { class: 'recap-round' + (r.tie ? ' is-tie' : '') }, [
          el('span', { class: 'recap-idx', text: i + 1 + 'ª' + (state ? ' · ' + state : '') }),
          el('ol', { class: 'recap-plays' }, plays),
        ]);
      });
      const vira = parseCard(table.vira);
      const viraItem = vira
        ? el('li', { class: 'recap-round recap-vira' }, [
            el('span', { class: 'recap-idx', text: 'Vira' }),
            el('div', { class: 'recap-plays' }, [
              el('div', { class: 'recap-play' }, [
                this.renderMiniCard(vira, { manilhaRank: null }),
                el('span', { class: 'recap-name', text: manilhaRank ? 'manilha ' + manilhaRank : '' }),
              ]),
            ]),
          ])
        : null;
      return el('section', { class: 'recap', 'aria-label': 'Na mesa' }, [
        el('span', { class: 'hud-label recap-title', text: 'Na mesa' }),
        el('ol', { class: 'recap-rounds' }, items.concat(viraItem ? [viraItem] : [])),
      ]);
    }

    adviceNode(advice, table) {
      const text = adviceText(advice, table);
      if (!text) return null;
      const name = (advice && typeof advice === 'object' && advice.name) || this.partnerName();
      return el('div', { class: 'advice' }, [
        el('span', { class: 'advice-avatar', text: String(name).charAt(0).toUpperCase(), 'aria-hidden': 'true' }),
        el('p', { class: 'advice-bubble' }, [
          el('span', { class: 'advice-name', text: name + ' sugere' }),
          el('span', { class: 'advice-text', text: '“' + text + '”' }),
        ]),
      ]);
    }

    askCallResponse(opts) {
      const o = opts || {};
      return this.enqueueDialog((finish) => {
        const id = this.uid + '-call';
        const proposed = Number(o.proposedValue) || nextValue(o.currentValue) || 3;
        const current = Number(o.currentValue) || prevValue(proposed);
        const callName = o.callName || CALL_NAMES[proposed] || 'Truco';
        const raiseValue = nextValue(proposed);
        const canRaise = !!o.canRaise && raiseValue !== null;
        const raiseName = o.raiseName || CALL_NAMES[raiseValue] || '';
        const caller = o.callerName || 'Eles';
        const suggested = adviceKey(o.advice);
        // 1×1: "o Tião leva 1"; 2×2: "eles levam 1".
        const opp = o.opponentLabel ? String(o.opponentLabel) : '';
        const quote = o.quote && o.quote.text ? o.quote : null;

        const { overlay, card } = this.makeOverlay('call', id + '-t', id + '-d');
        const accept = this.choiceButton('accept', 'Cai!', 'aceitar · vale ' + proposed, () => finish('accept'), 'c');
        const raise = canRaise
          ? this.choiceButton('raise', shoutText(raiseName), 'pede ' + String(raiseName).toLowerCase() + ' · vale ' + raiseValue, () => finish('raise'), 's')
          : null;
        const run = this.choiceButton('run', 'Corro', (opp ? opp + ' leva ' : 'eles levam ') + current, () => finish('run'), 'r');
        const byKey = { accept, raise, run };
        const suggestedBtn = suggested && byKey[suggested] ? byKey[suggested] : null;
        if (suggestedBtn) {
          suggestedBtn.classList.add('is-suggested');
          suggestedBtn.appendChild(el('span', { class: 'choice-flag', text: 'sugestão' }));
        }
        card.appendChild(el('p', {
          class: 'dialog-kicker' + (quote ? ' is-quote' : ''),
          text: quote ? (quote.name || caller) + ': “' + quote.text + '”' : caller + ' pediu',
        }));
        card.appendChild(el('h2', { class: 'dialog-shout', id: id + '-t', text: shoutText(callName) }));
        card.appendChild(el('p', { class: 'dialog-desc', id: id + '-d' }, [
          el('span', { class: 'desc-main', text: 'Aceitando, a mão passa a valer ' + proposed + '.' }),
          el('span', { class: 'desc-sub', text: 'Agora vale ' + pointsText(current) + '.' }),
        ]));
        const recap = this.tableRecapNode(o.table);
        if (recap) card.appendChild(recap);
        const advice = this.adviceNode(o.advice, ADVICE_CALL);
        if (advice) card.appendChild(advice);
        card.appendChild(el('div', { class: 'choices' + (raise ? ' has-3' : '') }, [accept, raise, run]));
        card.appendChild(this.helpFooter());
        const keys = { c: accept, r: run };
        if (raise) keys.s = raise;
        return { node: overlay, focus: suggestedBtn || accept, keys };
      });
    }

    askMaoDeOnze(opts) {
      const o = opts || {};
      return this.enqueueDialog((finish) => {
        const id = this.uid + '-onze';
        const solo = !Array.isArray(o.partnerCards) || o.partnerCards.length === 0;
        const opp = o.opponentLabel ? String(o.opponentLabel) : '';
        const { overlay, card } = this.makeOverlay('onze', id + '-t', id + '-d');
        const manilhaRank = this.hand.manilhaRank ? String(this.hand.manilhaRank).toUpperCase() : null;
        const hand = (cards, title) => el('div', { class: 'onze-hand' }, [
          el('span', { class: 'hud-label', text: title }),
          el('div', { class: 'onze-cards' }, (cards || []).map((c) => this.renderMiniCard(c, { manilhaRank }))),
        ]);
        card.appendChild(el('p', { class: 'dialog-kicker', text: solo ? 'Você está com 11 pontos' : 'Vocês estão com 11 pontos' }));
        card.appendChild(el('h2', { class: 'dialog-shout dialog-shout--onze', id: id + '-t', text: 'Mão de onze' }));
        card.appendChild(el('p', {
          class: 'dialog-desc',
          id: id + '-d',
          text: 'Jogando, a mão vale 3. Correndo, ' + (opp ? opp + ' ganha' : 'eles ganham') + ' 1 ponto. Ninguém pede truco.',
        }));
        card.appendChild(el('div', { class: 'onze-hands' + (solo ? ' is-solo' : '') }, [
          hand(o.myCards, 'Suas cartas'),
          solo ? null : hand(o.partnerCards, 'Cartas de ' + this.partnerName()),
        ]));
        const advice = solo ? null : this.adviceNode(o.advice, ADVICE_ONZE);
        if (advice) card.appendChild(advice);
        const play = this.choiceButton('accept', 'Jogar', 'a mão vale 3', () => finish(true), 'j');
        const run = this.choiceButton('run', 'Correr', (opp ? opp + ' leva' : 'eles levam') + ' 1', () => finish(false), 'r');
        const suggested = adviceKey(o.advice);
        const target = suggested === 'run' ? run : suggested ? play : null;
        if (target && !solo) {
          target.classList.add('is-suggested');
          target.appendChild(el('span', { class: 'choice-flag', text: 'sugestão' }));
        }
        card.appendChild(el('div', { class: 'choices' }, [play, run]));
        card.appendChild(this.helpFooter());
        return { node: overlay, focus: target && !solo ? target : play, keys: { j: play, r: run } };
      });
    }

    showMatchEnd(opts) {
      const o = opts || {};
      return this.enqueueDialog((finish) => {
        const id = this.uid + '-end';
        const win = Number(o.winnerTeam) === 0;
        const score = Array.isArray(o.score) ? o.score : this.score;
        const s0 = Math.min(Number(score[0]) || 0, 12);
        const s1 = Math.min(Number(score[1]) || 0, 12);
        const solo = this.names.length === 2;
        const { overlay, card } = this.makeOverlay('end', id + '-t', id + '-d');
        card.classList.add(win ? 'is-win' : 'is-loss');
        overlay.classList.add(win ? 'is-win' : 'is-loss');
        const sub = win
          ? solo
            ? 'Você fechou a partida. Cafezinho por conta ' + (o.opponentLabel ? 'd' + String(o.opponentLabel) : 'do ' + (this.names[1] || 'adversário')) + '!'
            : 'Vocês fecharam a partida. Cafezinho por conta deles!'
          : solo ? 'Não foi dessa vez. Bora a revanche?' : 'Eles levaram essa. Bora a revanche?';
        card.appendChild(el('p', { class: 'dialog-kicker', text: 'Fim de partida' }));
        card.appendChild(el('h2', { class: 'end-title', id: id + '-t', text: win ? 'Vitória!' : 'Derrota' }));
        // Como acabou ("Vocês venceram a mão de ferro", "O Tião correu do doze"…).
        if (o.how) card.appendChild(el('p', { class: 'end-how', text: String(o.how) }));
        card.appendChild(el('p', { class: 'dialog-desc', id: id + '-d', text: sub }));
        // No 1×1 o placar final fala de você e do adversário pelo nome.
        const usLabel = solo ? this.seatName(0) : 'Nós';
        const themLabel = solo ? this.seatName(1) : 'Eles';
        card.appendChild(el('div', { class: 'end-score', role: 'img', 'aria-label': 'Placar final: ' + usLabel.toLowerCase() + ' ' + s0 + ', ' + (solo ? themLabel : 'eles') + ' ' + s1 }, [
          el('span', { class: 'end-team' }, [el('span', { class: 'hud-label', text: usLabel }), el('span', { class: 'end-num', text: String(s0) })]),
          el('span', { class: 'end-x', text: '×', 'aria-hidden': 'true' }),
          el('span', { class: 'end-team' }, [el('span', { class: 'hud-label', text: themLabel }), el('span', { class: 'end-num', text: String(s1) })]),
        ]));
        const games = Array.isArray(o.gamesWon) ? o.gamesWon : null;
        if (games) card.appendChild(el('p', { class: 'end-games', text: 'Jogos: ' + (Number(games[0]) || 0) + ' × ' + (Number(games[1]) || 0) }));
        const summary = this.matchSummaryText(o.summary);
        if (summary) card.appendChild(el('p', { class: 'end-summary', text: summary }));
        const quote = o.quote && o.quote.text ? o.quote : null;
        if (quote) {
          card.appendChild(el('figure', { class: 'end-quote' }, [
            el('blockquote', { text: '“' + String(quote.text) + '”' }),
            el('figcaption', { text: String(quote.name || '') }),
          ]));
        }
        const again = el('button', { type: 'button', class: 'btn btn-primary', text: 'Jogar de novo' });
        const menu = el('button', { type: 'button', class: 'btn btn-ghost', text: 'Menu' });
        again.addEventListener('click', () => finish('again'));
        menu.addEventListener('click', () => finish('menu'));
        card.appendChild(el('div', { class: 'end-actions' }, [menu, again]));
        return { node: overlay, focus: again, restoreFocus: false };
      });
    }

    /** 'Mãos: 7 × 5 · 4 pedidos aceitos · 2 corridas' (partes vazias saem). */
    matchSummaryText(summary) {
      if (!summary || typeof summary !== 'object') return '';
      const parts = [];
      const hands = Array.isArray(summary.hands) ? summary.hands : null;
      if (hands) parts.push('Mãos: ' + (Number(hands[0]) || 0) + ' × ' + (Number(hands[1]) || 0));
      const acc = Number(summary.accepted) || 0;
      const runs = Number(summary.runs) || 0;
      if (acc) parts.push(acc + (acc === 1 ? ' pedido aceito' : ' pedidos aceitos'));
      if (runs) parts.push(runs + (runs === 1 ? ' corrida' : ' corridas'));
      return parts.join(' · ');
    }

    // ------------------------------------------------------------ menu inicial

    // opts.resumable: menu aberto no meio da partida. "Continuar" (ou Esc) aplica na hora o que pode
    // mudar no meio (som, voz, destaque, velocidade, qualidade: grava e emite onSettings) e resolve null.
    // Modo, baralho, partida e dificuldade só valem numa partida nova: se mudarem, o botão principal vira
    // "Nova partida com essas opções" (resolve com as opções, como "Nova partida").
    showMenu(defaults, opts) {
      if (this.menu) return this.menu.promise;
      const resumable = !!(opts && opts.resumable);
      // O que o jogo passa (preferências + parâmetros da URL + partida atual) vale por cima do salvo.
      const initial = sanitizeSettings(Object.assign({}, DEFAULT_SETTINGS, readPrefs(), defaults || {}));
      const id = this.uid + '-menu';
      let resolveMenu;
      const promise = new Promise((resolve) => {
        resolveMenu = resolve;
      });
      const prevFocus = document.activeElement;

      const groups = MENU_GROUPS.map((g) => {
        let selected = g.options.findIndex((opt) => opt.value === initial[g.key]);
        if (selected < 0 && g.key === 'speed') {
          let best = Infinity;
          g.options.forEach((opt, i) => {
            const d = Math.abs(opt.value - initial.speed);
            if (d < best) {
              best = d;
              selected = i;
            }
          });
        }
        if (selected < 0) selected = 0;
        const name = id + '-' + g.key;
        const opts = g.options.map((opt, i) => el('label', { class: 'seg-opt' }, [
          el('input', { type: 'radio', name, value: String(i), checked: i === selected, 'aria-label': opt.aria || null }),
          el('span', { class: 'seg-face' }, [
            el('span', { class: 'seg-title', text: opt.title }),
            opt.sub ? el('span', { class: 'seg-sub', text: opt.sub }) : null,
          ]),
        ]));
        return el('fieldset', { class: 'menu-group', 'data-key': g.key }, [
          el('legend', { class: 'hud-label', text: g.label }),
          el('div', { class: 'seg seg--' + g.options.length }, opts),
        ]);
      });
      const switches = MENU_SWITCHES.map((sw) => el('label', { class: 'switch', 'data-key': sw.key, title: sw.title || null }, [
        el('input', { type: 'checkbox', role: 'switch', name: id + '-' + sw.key, checked: !!initial[sw.key] }),
        el('span', { class: 'switch-track', 'aria-hidden': 'true' }, [el('span', { class: 'switch-thumb' })]),
        el('span', { class: 'switch-label', text: sw.label }),
      ]));
      const seatsUi = this.buildSeatPickers(id, initial);
      const castBtn = seatsUi ? el('button', { type: 'button', class: 'btn btn-ghost btn-cast', text: 'Personagens' }) : null;
      const rulesBtn = el('button', { type: 'button', class: 'btn btn-ghost', text: 'Como jogar' });
      const playBtn = resumable
        ? el('button', { type: 'submit', class: 'btn btn-ghost btn-new', text: 'Nova partida' })
        : el('button', { type: 'submit', class: 'btn btn-primary btn-play', text: 'Jogar' });
      const resumeBtn = resumable
        ? el('button', { type: 'button', class: 'btn btn-primary btn-play btn-resume', text: 'Continuar' })
        : null;
      const note = resumable
        ? el('p', {
            class: 'menu-note',
            id: id + '-note',
            text: 'Som, voz, destaque, sinais, velocidade e qualidade valem na hora. Modo, baralho, partida, dificuldade e quem senta à mesa valem na próxima partida.',
          })
        : null;
      if (resumeBtn) resumeBtn.setAttribute('aria-describedby', id + '-note');
      const form = el('form', { class: 'menu-form', 'aria-labelledby': id + '-t', novalidate: true }, [
        el('div', { class: 'menu-grid' }, groups),
        seatsUi ? seatsUi.node : null,
        el('fieldset', { class: 'menu-switches' }, [el('legend', { class: 'sr-only', text: 'Opções' })].concat(switches)),
        note,
        el('div', { class: 'menu-actions' + (resumable ? ' has-resume' : '') + (castBtn ? ' has-cast' : '') }, [resumeBtn, castBtn, rulesBtn, playBtn]),
      ]);
      const card = el('div', { class: 'menu-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id + '-t' }, [
        el('header', { class: 'menu-head' }, [
          resumable ? el('p', { class: 'menu-kicker', text: 'Partida pausada' }) : null,
          el('h1', { class: 'menu-title', id: id + '-t', text: 'TrucAÍ' }),
        ].filter(Boolean)),
        form,
      ]);
      const overlay = el('div', { class: 'menu-overlay' }, [card]);

      const collect = () => {
        const out = Object.assign({}, initial);
        MENU_GROUPS.forEach((g) => {
          const checked = form.querySelector('input[name="' + id + '-' + g.key + '"]:checked');
          const idx = checked ? Number(checked.value) : 0;
          out[g.key] = g.options[idx] ? g.options[idx].value : initial[g.key];
        });
        MENU_SWITCHES.forEach((sw) => {
          const input = form.querySelector('input[name="' + id + '-' + sw.key + '"]');
          out[sw.key] = !!(input && input.checked);
        });
        if (seatsUi) {
          out.seats2 = seatsUi.value(2);
          out.seats4 = seatsUi.value(4);
        }
        return sanitizeSettings(out);
      };
      const playersNow = () => {
        const checked = form.querySelector('input[name="' + id + '-players"]:checked');
        const g = MENU_GROUPS.find((x) => x.key === 'players');
        return checked && g.options[Number(checked.value)] ? g.options[Number(checked.value)].value : initial.players;
      };
      if (seatsUi) {
        seatsUi.show(playersNow());
        form.addEventListener('change', (e) => {
          if (e.target && e.target.name === id + '-players') seatsUi.show(playersNow());
        });
      }
      // Como o menu abriu (a velocidade pode ter sido arredondada para a opção mais próxima).
      const baseline = collect();
      const matchChanged = () => {
        const now = collect();
        return MATCH_KEYS.some((k) => !sameValue(now[k], baseline[k]));
      };

      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        this.menu = null;
        this.dismissOverlay(overlay);
        this.syncModalState();
        if (result) {
          this.settings = result;
          writePrefs(result);
          this.renderSettings();
          this.emitSettings();
        }
        if (this.activeDialog) this.focusSoon(this.activeDialog.focus || this.activeDialog.node.querySelector('button'));
        else this.restoreFocus(prevFocus);
        resolveMenu(result ? Object.assign({}, result) : null);
      };

      // Pausa → "Continuar"/Esc: aplica o que vale no meio da partida e volta ao jogo.
      const resume = () => {
        if (settled) return;
        const now = collect();
        const live = {};
        const changed = {};
        LIVE_KEYS.forEach((k) => {
          live[k] = now[k];
          if (!sameValue(now[k], baseline[k])) changed[k] = now[k];
        });
        this.settings = sanitizeSettings(Object.assign({}, this.settings, live));
        if (Object.keys(changed).length) writePrefs(changed);
        this.renderSettings();
        this.emitSettings();
        finish(null);
      };

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        finish(collect());
      });
      rulesBtn.addEventListener('click', () => this.showRules());
      if (castBtn) {
        castBtn.addEventListener('click', () => {
          Promise.resolve(this.showPersonagens()).then(() => {
            if (!settled) {
              seatsUi.refresh();
              form.dispatchEvent(new Event('change'));
              this.focusSoon(castBtn);
            }
          });
        });
      }
      if (resumeBtn) {
        resumeBtn.addEventListener('click', () => {
          if (matchChanged()) finish(collect());
          else resume();
        });
        form.addEventListener('change', () => {
          const changed = matchChanged();
          resumeBtn.textContent = changed ? 'Nova partida com essas opções' : 'Continuar';
          resumeBtn.classList.toggle('is-new', changed);
        });
      }

      this.menu = { promise, finish, resume: resumable ? resume : () => finish(null), node: overlay, resumable };
      this.layers.menu.appendChild(overlay);
      this.syncModalState();
      this.focusSoon(resumeBtn || playBtn);
      return promise;
    }

    /**
     * "Quem senta à mesa" no menu: um seletor por lugar (1×1: adversário; 2×2: parceiro(a) e os dois
     * adversários), com todos os personagens (do jogo + meus). Escolher alguém que já está noutro lugar
     * troca os dois de lugar, então ninguém senta duas vezes. Sem Truco.Personagens, devolve null.
     */
    buildSeatPickers(id, initial) {
      const P = personagensApi();
      if (!P) return null;
      const node = el('fieldset', { class: 'menu-seats' }, [el('legend', { class: 'hud-label', text: 'Quem senta à mesa' })]);
      const blocks = {};
      const selects = { 2: {}, 4: {} };
      const hints = { 2: {}, 4: {} };
      let list = [];

      const hintFor = (p) => {
        if (!p) return '';
        const est = P.ESTILOS[p.jogo && p.jogo.estilo];
        const parts = [];
        if (p.origem === 'meu') parts.push('Meu personagem');
        if (est) parts.push(est.rotulo);
        if (p.historia) parts.push(p.historia);
        return parts.join(' · ');
      };
      const setHint = (players, seat) => {
        const sel = selects[players][seat];
        hints[players][seat].textContent = hintFor(list.find((p) => p.id === sel.value));
      };

      [2, 4].forEach((players) => {
        const wrap = el('div', { class: 'seat-grid seat-grid--' + players, 'data-players': String(players) });
        SEAT_SLOTS[players].forEach((slot) => {
          const selId = id + '-seat' + players + '-' + slot.seat;
          const sel = el('select', { id: selId, class: 'seat-select', 'data-seat': String(slot.seat), 'aria-describedby': selId + '-h' });
          const hint = el('span', { class: 'seat-hint', id: selId + '-h' });
          selects[players][slot.seat] = sel;
          hints[players][slot.seat] = hint;
          sel.addEventListener('change', () => {
            const v = sel.value;
            const prev = sel.getAttribute('data-prev');
            // Ninguém senta duas vezes: quem estava com esse personagem fica com o anterior deste lugar.
            Object.keys(selects[players]).forEach((k) => {
              const other = selects[players][k];
              if (other !== sel && other.value === v && prev) {
                other.value = prev;
                other.setAttribute('data-prev', prev);
                setHint(players, Number(k));
              }
            });
            sel.setAttribute('data-prev', v);
            setHint(players, slot.seat);
          });
          wrap.appendChild(el('div', { class: 'seat-pick' }, [
            el('label', { class: 'seat-label', for: selId }, [
              el('span', { text: slot.label }),
              slot.sub ? el('span', { class: 'seat-sub', text: ' · ' + slot.sub }) : null,
            ]),
            sel,
            hint,
          ]));
        });
        blocks[players] = wrap;
        node.appendChild(wrap);
      });

      const current = { 2: Object.assign({}, initial.seats2 || {}), 4: Object.assign({}, initial.seats4 || {}) };
      const refresh = () => {
        try {
          list = P.lista();
        } catch (err) {
          reportError(err, 'lista de personagens');
          list = [];
        }
        const has = (idv) => list.some((p) => p.id === idv);
        [2, 4].forEach((players) => {
          const seats = Object.keys(selects[players]).map(Number).sort((a, b) => a - b);
          // Valor atual do seletor (se já montado) > escolha salva > padrão; sem repetir.
          const want = {};
          seats.forEach((seat) => {
            const sel = selects[players][seat];
            want[seat] = sel.value || current[players][seat] || DEFAULT_SEAT_IDS[players][seat];
          });
          const used = new Set();
          const pick = {};
          seats.forEach((seat) => {
            let v = want[seat];
            if (!has(v) || used.has(v)) v = DEFAULT_SEAT_IDS[players][seat];
            if (!has(v) || used.has(v)) v = (list.find((p) => !used.has(p.id)) || {}).id || '';
            used.add(v);
            pick[seat] = v;
          });
          seats.forEach((seat) => {
            const sel = selects[players][seat];
            sel.textContent = '';
            const groups = [
              ['Do jogo', list.filter((p) => p.origem !== 'meu')],
              ['Meus personagens', list.filter((p) => p.origem === 'meu')],
            ];
            groups.forEach(([label, items]) => {
              if (!items.length) return;
              const og = el('optgroup', { label });
              items.forEach((p) => og.appendChild(el('option', { value: p.id, text: p.nome })));
              sel.appendChild(og);
            });
            sel.value = pick[seat];
            sel.setAttribute('data-prev', pick[seat]);
            setHint(players, seat);
          });
        });
      };
      refresh();

      return {
        node,
        refresh,
        show(players) {
          blocks[2].hidden = players !== 2;
          blocks[4].hidden = players !== 4;
        },
        value(players) {
          const out = {};
          Object.keys(selects[players]).forEach((seat) => {
            if (selects[players][seat].value) out[seat] = selects[players][seat].value;
          });
          return out;
        },
      };
    }

    // ------------------------------------------------------------ tela "Personagens"

    /** Abre a tela de personagens (lista + editor com prévia 3D). Resolve quando fecha. */
    showPersonagens() {
      if (this.studio) return this.studio.promise;
      const P = personagensApi();
      if (!P) {
        this.toast('Os personagens não carregaram. Recarregue a página.', { kind: 'bad' });
        return Promise.resolve();
      }
      const studio = new Studio(this, P);
      this.studio = studio;
      this.layers.studio.appendChild(studio.overlay);
      this.syncModalState();
      studio.start();
      return studio.promise;
    }

    // ------------------------------------------------------------ como jogar

    showRules() {
      if (this.rules) {
        this.focusSoon(this.rules.focus);
        return this.rules.promise;
      }
      const id = this.uid + '-rules';
      const prevFocus = document.activeElement;
      let resolveRules;
      const promise = new Promise((resolve) => {
        resolveRules = resolve;
      });
      const closeX = el('button', { type: 'button', class: 'icon-btn rules-close', 'aria-label': 'Fechar', html: ICONS.close });
      const body = el('div', { class: 'rules-body', tabindex: '0', 'aria-label': 'Regras', html: RULES_HTML });
      const ok = el('button', { type: 'button', class: 'btn btn-primary', text: 'Entendi' });
      const card = el('div', { class: 'rules-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id + '-t' }, [
        el('header', { class: 'rules-head' }, [
          el('div', {}, [
            el('p', { class: 'menu-kicker', text: 'Truco paulista · manilha limpa' }),
            el('h2', { class: 'rules-title', id: id + '-t', text: 'Como jogar' }),
          ]),
          closeX,
        ]),
        body,
        el('footer', { class: 'rules-foot' }, [ok]),
      ]);
      const overlay = el('div', { class: 'rules-overlay' }, [card]);
      let settled = false;
      const close = () => {
        if (settled) return;
        settled = true;
        this.rules = null;
        this.dismissOverlay(overlay);
        this.syncModalState();
        this.restoreFocus(prevFocus);
        resolveRules();
      };
      closeX.addEventListener('click', close);
      ok.addEventListener('click', close);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
      this.rules = { promise, close, node: overlay, focus: body };
      this.layers.rules.appendChild(overlay);
      this.syncModalState();
      this.focusSoon(body);
      return promise;
    }
  }

  // ---------------------------------------------------------------- tela "Personagens"
  //
  // Lista (do jogo: ver/duplicar; meus: editar/apagar) e editor da ficha com prévia 3D ao vivo
  // (Truco.AvatarPreview, se existir). Tudo passa por Truco.Personagens.normalizar: os avisos aparecem
  // na hora e a ficha salva é sempre válida. Guardar: Personagens.salvarMeu (localStorage).

  const BLEFE_FAIXAS = [[2, 'quase nunca blefa'], [4, 'blefa pouco'], [6, 'blefa de vez em quando'], [8, 'blefa bastante'], [Infinity, 'blefa sempre que pode']];
  const CAUTELA_FAIXAS = [[2, 'aceita qualquer pedido'], [4, 'aceita fácil'], [6, 'pensa antes de aceitar'], [8, 'desconfia de tudo'], [Infinity, 'só aceita com a mão feita']];
  const AMOSTRA_VOZ = 'Truco, ladrão! Vai correr ou vai cair?';

  function faixa(tabela, v) {
    for (const [lim, t] of tabela) if (v < lim) return t;
    return tabela[tabela.length - 1][1];
  }

  function numeroBr(v) {
    return String(Math.round(Number(v) * 10) / 10).replace('.', ',');
  }

  function copiaFicha(v) {
    return JSON.parse(JSON.stringify(v));
  }

  /** Ficha editável (tudo explícito) a partir de um personagem normalizado. */
  function rascunhoDe(p) {
    const r = p.relacoes || {};
    return {
      nome: p.nome,
      apelido: p.apelido && p.apelido !== p.nome ? p.apelido : '',
      historia: p.historia || '',
      genero: p.genero || 'ele',
      visual: Object.assign({}, p.visual, {
        acessorio: Array.isArray(p.visual.acessorio) ? p.visual.acessorio.slice() : p.visual.acessorio || 'nenhum',
        corSecundaria: p.visual.corSecundaria || '',
        corAcessorio: p.visual.corAcessorio || '',
        marcaNoBone: p.visual.marcaNoBone || 'nenhuma',
        brincos: p.visual.brincos === true,
      }),
      jogo: { estilo: p.jogo.estilo, blefe: p.jogo.blefe, cautela: p.jogo.cautela },
      voz: Object.assign({}, p.voz),
      falas: copiaFicha(p.falas || {}),
      sinais: Object.assign({}, p.sinais),
      relacoes: { parceiro: r.parceiro || '', rival: r.rival || '', falasPara: copiaFicha(r.falasPara || {}) },
    };
  }

  /** Ficha limpa para normalizar (sem campos vazios que viram aviso). */
  function fichaDe(d) {
    const f = copiaFicha(d);
    if (!f.apelido) delete f.apelido;
    if (!f.historia) delete f.historia;
    if (f.visual && !f.visual.corSecundaria) delete f.visual.corSecundaria;
    if (f.visual && !f.visual.corAcessorio) delete f.visual.corAcessorio;
    if (f.visual && (!f.visual.marcaNoBone || f.visual.marcaNoBone === 'nenhuma')) delete f.visual.marcaNoBone;
    if (f.visual && f.visual.brincos !== true) delete f.visual.brincos;
    const r = f.relacoes || {};
    if (!r.parceiro) delete r.parceiro;
    if (!r.rival) delete r.rival;
    Object.keys(r.falasPara || {}).forEach((k) => {
      const b = r.falasPara[k];
      Object.keys(b).forEach((m) => {
        if (!b[m] || !b[m].length) delete b[m];
      });
      if (!Object.keys(b).length) delete r.falasPara[k];
    });
    Object.keys(f.falas || {}).forEach((m) => {
      if (!f.falas[m] || !f.falas[m].length) delete f.falas[m];
    });
    return f;
  }

  class Studio {
    constructor(hud, P) {
      this.hud = hud;
      this.P = P;
      this.uid = hud.uid + '-studio';
      this.seq = 0;
      this.prevFocus = document.activeElement;
      this.promise = new Promise((resolve) => {
        this.resolveClose = resolve;
      });
      this.closed = false;
      this.preview = null;
      this.timer = 0;
      this.view = 'list';
      this.mode = null;
      this.draft = null;
      this.editingId = null;
      this.dirty = false;
      this.sheet = null;
      this.pasteAvisos = [];
      this.build();
    }

    nextId(tag) {
      this.seq += 1;
      return this.uid + '-' + tag + '-' + this.seq;
    }

    build() {
      this.titleEl = el('h2', { class: 'studio-title', id: this.uid + '-t', text: 'Personagens' });
      this.kickerEl = el('p', { class: 'menu-kicker', text: 'Quem senta à mesa' });
      this.closeBtn = el('button', { type: 'button', class: 'icon-btn studio-close', 'aria-label': 'Fechar personagens', html: ICONS.close });
      this.bodyEl = el('div', { class: 'studio-body' });
      this.card = el('div', { class: 'studio-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': this.uid + '-t' }, [
        el('header', { class: 'studio-head' }, [el('div', { class: 'studio-head-text' }, [this.kickerEl, this.titleEl]), this.closeBtn]),
        this.bodyEl,
      ]);
      this.overlay = el('div', { class: 'studio-overlay' }, [this.card]);
      this.closeBtn.addEventListener('click', () => this.requestClose());
    }

    start() {
      this.renderList();
    }

    lista() {
      try {
        return this.P.lista();
      } catch (err) {
        reportError(err, 'lista de personagens');
        return [];
      }
    }

    // ---------------------------------------------------------- fechar / Esc

    escape() {
      if (this.sheet) this.closeSheet();
      else if (this.view === 'editor') this.leaveEditor();
      else this.close();
    }

    requestClose() {
      if (this.view === 'editor' && this.dirty && this.mode !== 'view') {
        this.confirmLeave(() => this.close());
        return;
      }
      this.close();
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      this.disposePreview();
      clearTimeout(this.timer);
      const hud = this.hud;
      if (hud.studio === this) hud.studio = null;
      hud.dismissOverlay(this.overlay);
      hud.syncModalState();
      if (!hud.menu) hud.restoreFocus(this.prevFocus);
      this.resolveClose();
    }

    disposePreview() {
      if (this.preview && typeof this.preview.dispose === 'function') {
        try {
          this.preview.dispose();
        } catch (err) {
          reportError(err, 'prévia do personagem');
        }
      }
      this.preview = null;
    }

    setTitle(kicker, title) {
      this.kickerEl.textContent = kicker;
      this.titleEl.textContent = title;
    }

    // ---------------------------------------------------------- lista

    renderList(focusSel) {
      this.view = 'list';
      this.mode = null;
      this.dirty = false;
      this.disposePreview();
      this.card.classList.remove('is-editor');
      this.setTitle('Quem senta à mesa', 'Personagens');
      const list = this.lista();
      const jogo = list.filter((p) => p.origem !== 'meu');
      const meus = list.filter((p) => p.origem === 'meu');

      const createBtn = el('button', { type: 'button', class: 'btn btn-primary st-create', text: 'Criar personagem' });
      const pasteBtn = el('button', { type: 'button', class: 'btn btn-ghost', text: 'Colar ficha' });
      createBtn.addEventListener('click', () => this.openNew());
      pasteBtn.addEventListener('click', () => this.openPaste());

      const cards = (items, kind) => el('ul', { class: 'st-cards', role: 'list' }, items.map((p) => this.cardFor(p, kind)));
      this.listStatus = el('p', { class: 'st-status', role: 'status', 'aria-live': 'polite' });
      const scroll = el('div', { class: 'st-list' }, [
        el('p', { class: 'st-intro', text: 'Todo mundo que senta à mesa tem uma ficha: aparência, jeito de jogar, voz, falas e sinais. Os personagens do jogo servem de modelo: veja como são feitos ou duplique para mudar.' }),
        el('div', { class: 'st-list-actions' }, [createBtn, pasteBtn]),
        this.listStatus,
        el('section', { class: 'st-list-sec', 'aria-labelledby': this.uid + '-meus' }, [
          el('h3', { class: 'st-h3', id: this.uid + '-meus', text: 'Meus personagens' }),
          meus.length
            ? cards(meus, 'meu')
            : el('p', { class: 'st-empty', text: 'Nenhum ainda. Crie um, duplique um do jogo ou cole a ficha que alguém mandou.' }),
        ]),
        el('section', { class: 'st-list-sec', 'aria-labelledby': this.uid + '-jogo' }, [
          el('h3', { class: 'st-h3', id: this.uid + '-jogo', text: 'Do jogo' }),
          cards(jogo, 'jogo'),
        ]),
      ]);
      this.bodyEl.textContent = '';
      this.bodyEl.appendChild(scroll);
      const target = (focusSel && scroll.querySelector(focusSel)) || createBtn;
      this.hud.focusSoon(target);
    }

    face(p) {
      const spec = this.safeSpec(p);
      return el('span', {
        class: 'st-face',
        'aria-hidden': 'true',
        style: '--skin:' + spec.skin + ';--hair:' + spec.hair + ';--shirt:' + spec.shirt + ';--accent:' + spec.accent,
        'data-hair': spec.hairStyle || 'curto',
      }, [el('span', { class: 'st-face-shirt' }), el('span', { class: 'st-face-head' }), el('span', { class: 'st-face-hair' })]);
    }

    safeSpec(p) {
      try {
        return this.P.avatarSpec(p, 1);
      } catch (_) {
        return { skin: '#e0b48e', hair: '#5a3a24', shirt: '#6c6863', accent: '#b9b2a6', hairStyle: 'curto' };
      }
    }

    metaFor(p) {
      const P = this.P;
      const est = P.ESTILOS[p.jogo.estilo];
      const tom = P.CATALOGO.tom.find((o) => o.id === p.voz.tom);
      return (est ? est.rotulo : '') + ' · blefe ' + numeroBr(p.jogo.blefe) + ' · cautela ' + numeroBr(p.jogo.cautela) + (tom ? ' · voz ' + tom.rotulo.toLowerCase() : '');
    }

    cardFor(p, kind) {
      const actions = el('div', { class: 'st-card-actions' });
      const li = el('li', { class: 'st-card', 'data-id': p.id }, [
        this.face(p),
        el('div', { class: 'st-card-text' }, [
          el('strong', { class: 'st-card-name', text: p.nome }),
          el('span', { class: 'st-card-meta', text: this.metaFor(p) }),
          p.historia ? el('span', { class: 'st-card-story', text: p.historia }) : null,
        ]),
        actions,
      ]);
      const btn = (text, cls, fn, label) => {
        const b = el('button', { type: 'button', class: 'btn btn-small ' + cls, text, 'aria-label': label ? text + ' ' + label : null });
        b.addEventListener('click', fn);
        return b;
      };
      const normal = () => {
        actions.textContent = '';
        if (kind === 'jogo') {
          actions.appendChild(btn('Ver', 'btn-ghost st-view', () => this.openEditor(p, 'view'), p.nome));
          actions.appendChild(btn('Duplicar', 'btn-ghost st-dup', () => this.openDuplicate(p), p.nome));
        } else {
          actions.appendChild(btn('Editar', 'btn-ghost st-edit', () => this.openEditor(p, 'edit'), p.nome));
          actions.appendChild(btn('Apagar', 'btn-ghost st-del', () => confirm(), p.nome));
        }
      };
      const confirm = () => {
        actions.textContent = '';
        const cancel = btn('Cancelar', 'btn-ghost st-del-no', () => {
          normal();
          this.hud.focusSoon(actions.querySelector('.st-del'));
        });
        const yes = btn('Apagar', 'btn-danger st-del-yes', () => {
          const ok = this.P.removerMeu(p.id);
          this.renderList();
          this.say(ok ? p.nome + (p.genero === 'ela' ? ' foi apagada.' : ' foi apagado.') : 'Não deu para apagar (armazenamento do navegador bloqueado).');
        }, p.nome + ' de vez');
        actions.appendChild(el('p', { class: 'st-confirm', role: 'alert', text: 'Apagar ' + p.nome + '? Não dá para desfazer.' }));
        actions.appendChild(yes);
        actions.appendChild(cancel);
        this.hud.focusSoon(cancel);
      };
      normal();
      return li;
    }

    /** Aviso curto na lista (lido pelos leitores de tela). */
    say(text) {
      if (this.listStatus) this.listStatus.textContent = text || '';
    }

    // ---------------------------------------------------------- abrir o editor

    uniqueName(base) {
      const ids = this.lista().map((p) => p.id);
      const max = this.P.LIMITES.nome;
      for (let n = 2; n < 99; n++) {
        const suf = ' ' + n;
        const nome = base.slice(0, max - suf.length).trim() + suf;
        if (ids.indexOf(this.P.slug(nome)) < 0) return nome;
      }
      return base;
    }

    uniqueId(id) {
      const ids = this.lista().map((p) => p.id);
      let out = id;
      for (let n = 2; ids.indexOf(out) >= 0; n++) out = id + '-' + n;
      return out;
    }

    openNew() {
      const base = this.P.normalizar({ nome: 'Novo' }).personagem;
      const d = rascunhoDe(base);
      d.nome = '';
      d.falas = {};
      this.openEditor(null, 'new', d);
    }

    openDuplicate(p) {
      const d = rascunhoDe(p);
      d.nome = this.uniqueName(p.nome);
      this.openEditor(null, 'new', d);
      this.dirty = true;
    }

    leaveEditor() {
      if (this.dirty && this.mode !== 'view') this.confirmLeave(() => this.renderList());
      else this.renderList();
    }

    openEditor(p, mode, draft) {
      this.view = 'editor';
      this.mode = mode;
      this.editingId = mode === 'edit' && p ? p.id : null;
      this.draft = draft || rascunhoDe(p);
      this.source = p || null;
      this.dirty = false;
      this.card.classList.add('is-editor');
      this.bodyEl.textContent = '';
      this.disposePreview();

      const readOnly = mode === 'view';
      this.setTitle(
        readOnly ? 'Personagem do jogo · só para ver' : mode === 'edit' ? 'Meus personagens' : 'Novo personagem',
        readOnly ? this.draft.nome : mode === 'edit' ? 'Editar ' + this.draft.nome : 'Criar personagem'
      );

      const stage = this.buildStage();
      const sections = [
        this.secIdentidade(),
        this.secVisual(),
        this.secJogo(),
        this.secVoz(),
        this.secFalas(),
        this.secSinais(),
        this.secRelacoes(),
      ];
      const form = el('fieldset', { class: 'st-form-fields', disabled: readOnly }, [el('legend', { class: 'sr-only', text: 'Ficha do personagem' })].concat(sections));
      this.formScroll = el('div', { class: 'st-form', tabindex: '-1' }, [
        readOnly ? el('p', { class: 'st-readonly', text: 'Este personagem vem com o jogo e serve de modelo. Para mudar alguma coisa, use “Duplicar e editar”.' }) : null,
        form,
      ]);
      this.avisosEl = el('div', { class: 'st-avisos', role: 'status', 'aria-live': 'polite' });
      this.statusEl = el('p', { class: 'st-status', role: 'status', 'aria-live': 'polite' });
      const foot = this.buildFoot(readOnly);
      const main = el('div', { class: 'st-editor' }, [
        stage,
        el('div', { class: 'st-form-col' }, [this.formScroll, this.avisosEl, el('div', { class: 'st-foot' }, [this.statusEl, foot])]),
      ]);
      this.bodyEl.appendChild(main);
      this.setupPreview();
      this.refresh(true);
      this.hud.focusSoon(readOnly ? foot.querySelector('.st-dup-edit') : this.nomeInput);
    }

    buildFoot(readOnly) {
      const btn = (text, cls, fn) => {
        const b = el('button', { type: 'button', class: 'btn ' + cls, text });
        b.addEventListener('click', fn);
        return b;
      };
      const back = btn('Voltar', 'btn-ghost st-back', () => this.leaveEditor());
      const copy = btn('Copiar ficha', 'btn-ghost st-copy', () => this.copy());
      if (readOnly) {
        const dup = btn('Duplicar e editar', 'btn-primary st-dup-edit', () => this.openDuplicate(this.source));
        return el('div', { class: 'st-foot-buttons' }, [back, copy, dup]);
      }
      const paste = btn('Colar ficha', 'btn-ghost st-paste', () => this.openPaste());
      const save = btn('Salvar', 'btn-primary st-save', () => this.save());
      this.saveBtn = save;
      return el('div', { class: 'st-foot-buttons' }, [back, paste, copy, save]);
    }

    // ---------------------------------------------------------- prévia

    buildStage() {
      this.stageView = el('div', { class: 'st-stage-view', 'aria-hidden': 'true' });
      this.stageName = el('p', { class: 'st-stage-name' });
      this.stageNote = el('p', { class: 'st-stage-note', 'aria-live': 'polite' });
      const shout = el('button', { type: 'button', class: 'btn btn-small btn-ghost st-shout', text: 'Gritar truco' });
      const sign = el('button', { type: 'button', class: 'btn btn-small btn-ghost st-sign', text: 'Fazer sinal' });
      shout.addEventListener('click', () => this.shout());
      sign.addEventListener('click', () => this.signal('zap'));
      return el('div', { class: 'st-stage' }, [
        this.stageView,
        el('div', { class: 'st-stage-bar' }, [this.stageName, el('div', { class: 'st-stage-actions' }, [shout, sign]), this.stageNote]),
      ]);
    }

    setupPreview() {
      const AP = Truco.AvatarPreview;
      if (AP && typeof AP.create === 'function') {
        try {
          this.preview = AP.create(this.stageView, { quality: this.hud.settings.quality });
        } catch (err) {
          reportError(err, 'prévia do personagem');
          this.preview = null;
        }
      }
      if (!this.preview) {
        this.fallbackFace = el('div', { class: 'st-stage-fallback' }, [
          el('div', { class: 'st-face st-face--big' }, [el('span', { class: 'st-face-shirt' }), el('span', { class: 'st-face-head' }), el('span', { class: 'st-face-hair' })]),
          el('p', { class: 'st-stage-missing', text: 'A prévia 3D não carregou aqui; as cores já valem.' }),
        ]);
        this.stageView.appendChild(this.fallbackFace);
      }
    }

    note(text) {
      this.stageNote.textContent = text || '';
    }

    current() {
      const r = this.P.normalizar(fichaDe(this.draft));
      if (r.personagem) return r;
      // Sem nome ainda: a prévia e a voz funcionam com um nome provisório.
      const tmp = this.P.normalizar(Object.assign(fichaDe(this.draft), { nome: 'Sem nome' }));
      return { personagem: tmp.personagem, avisos: r.avisos, semNome: true };
    }

    shout() {
      const p = this.current().personagem;
      const text = this.P.fala(p, 'truco', Math.random) || 'Truco!';
      if (this.preview && typeof this.preview.act === 'function') {
        try {
          Promise.resolve(this.preview.act('shout')).catch(() => {});
        } catch (err) {
          reportError(err, 'prévia do personagem');
        }
      }
      this.note('“' + text + '”');
      this.speak(text, true);
    }

    signal(carta) {
      const p = this.current().personagem;
      const gesto = this.P.sinal(p, carta);
      const g = this.P.CATALOGO.gesto.find((o) => o.id === gesto);
      const c = this.P.CATALOGO.carta.find((o) => o.id === carta);
      if (this.preview && typeof this.preview.signal === 'function') {
        try {
          Promise.resolve(this.preview.signal(gesto)).catch(() => {});
        } catch (err) {
          reportError(err, 'prévia do personagem');
        }
      }
      this.note('Sinal de ' + (c ? c.nome : carta) + ': ' + (g ? g.rotulo.toLowerCase() : gesto) + (this.preview ? '' : ' (sem a prévia 3D)'));
    }

    /** Fala com a voz da ficha. Explica quando não sai som. */
    speak(text, shout) {
      const Audio = Truco.Audio;
      const p = this.current().personagem;
      if (!Audio || typeof Audio.say !== 'function') return Promise.resolve(false);
      if (!this.hud.settings.voice || !this.hud.settings.sound) {
        this.note((this.stageNote.textContent ? this.stageNote.textContent + ' · ' : '') + 'Som ou voz desligados no menu.');
        return Promise.resolve(false);
      }
      let voice;
      try {
        voice = this.P.voz(p);
      } catch (_) {
        voice = undefined;
      }
      return Promise.resolve(Audio.say(text, { seat: 1, shout: !!shout, voice })).then(
        (ok) => {
          if (!ok && !this.closed) this.voiceNote('Não saiu som: o navegador pode não ter voz em português.');
          return ok;
        },
        () => false
      );
    }

    voiceNote(text) {
      if (this.voiceStatus) this.voiceStatus.textContent = text;
      else this.note(text);
    }

    // ---------------------------------------------------------- componentes do formulário

    section(title, children, opts) {
      const id = this.nextId('sec');
      const o = opts || {};
      if (o.collapsible) {
        return el('details', { class: 'st-sec st-sec--details', open: !!o.open }, [
          el('summary', { class: 'st-sec-summary' }, [el('span', { class: 'st-h3', id, text: title }), o.sub ? el('span', { class: 'st-sec-sub', text: o.sub }) : null]),
          el('div', { class: 'st-sec-body' }, children),
        ]);
      }
      return el('section', { class: 'st-sec', 'aria-labelledby': id }, [
        el('h3', { class: 'st-h3', id, text: title }),
        o.sub ? el('p', { class: 'st-sec-sub', text: o.sub }) : null,
      ].concat(children));
    }

    textField(label, value, opts) {
      const o = opts || {};
      const id = this.nextId('f');
      const input = o.multiline
        ? el('textarea', { id, class: 'st-input st-textarea', rows: '3', maxlength: o.max ? String(o.max) : null, spellcheck: 'true' })
        : el('input', { id, class: 'st-input', type: 'text', maxlength: o.max ? String(o.max) : null, autocomplete: 'off', spellcheck: 'false', placeholder: o.placeholder || null });
      input.value = value || '';
      const counter = o.max ? el('span', { class: 'st-count', 'aria-hidden': 'true' }) : null;
      const hint = o.hint ? el('span', { class: 'st-hint', id: id + '-h', text: o.hint }) : null;
      if (hint) input.setAttribute('aria-describedby', id + '-h');
      const upd = () => {
        if (counter) counter.textContent = input.value.length + '/' + o.max;
      };
      input.addEventListener('input', () => {
        upd();
        o.onInput(input.value);
      });
      upd();
      const node = el('div', { class: 'st-field' + (o.multiline ? ' is-wide' : '') }, [
        el('div', { class: 'st-field-top' }, [el('label', { class: 'st-label', for: id, text: label }), counter]),
        input,
        hint,
      ]);
      return { node, input };
    }

    chips(label, options, value, onChange, cls) {
      const name = this.nextId('g');
      const row = el('div', { class: 'chips' + (cls ? ' ' + cls : '') });
      const inputs = [];
      options.forEach((o) => {
        const input = el('input', { type: 'radio', name, value: o.id, checked: o.id === value });
        input.addEventListener('change', () => {
          if (input.checked) onChange(o.id);
        });
        inputs.push(input);
        row.appendChild(el('label', { class: 'chip' }, [input, el('span', { class: 'chip-face', text: o.rotulo })]));
      });
      const node = el('fieldset', { class: 'st-group' }, [el('legend', { class: 'st-label', text: label }), row]);
      return {
        node,
        set(v) {
          inputs.forEach((i) => {
            i.checked = i.value === v;
          });
        },
      };
    }

    /**
     * Cor: amostras (as do catálogo) + campo de código (#RRGGBB) + seletor livre do navegador.
     * `guardaId`: para pele e cor do cabelo, a amostra grava o nome ('morena'); nas outras, o código.
     */
    colorPicker(label, catalog, value, onChange, opts) {
      const o = opts || {};
      const P = this.P;
      const options = P.CATALOGO[catalog];
      const name = this.nextId('c');
      const idHex = this.nextId('hex');
      const resolve = (v) => {
        if (!v) return '';
        const op = options.find((x) => x.id === v);
        if (op) return op.cor;
        return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '';
      };
      const swatches = (o.auto ? [{ id: '', rotulo: 'Automática', auto: true }] : []).concat(options);
      const inputs = [];
      let cur = value || '';
      const commit = (v) => {
        cur = v;
        onChange(v);
      };
      const row = el('div', { class: 'swatches' });
      swatches.forEach((sw) => {
        const input = el('input', { type: 'radio', name, value: sw.id, 'aria-label': sw.rotulo });
        input.addEventListener('change', () => {
          if (!input.checked) return;
          const v = sw.auto ? '' : o.guardaId ? sw.id : sw.cor;
          commit(v);
          sync(v, false);
        });
        inputs.push({ input, sw });
        row.appendChild(el('label', { class: 'swatch' + (sw.auto ? ' swatch--auto' : ''), title: sw.rotulo }, [
          input,
          el('span', { class: 'swatch-face', style: sw.auto ? null : 'background:' + sw.cor }, sw.auto ? [el('span', { class: 'swatch-auto-text', text: 'Auto' })] : null),
        ]));
      });
      const hexInput = el('input', { id: idHex, class: 'st-input hex-input', type: 'text', maxlength: '7', autocomplete: 'off', spellcheck: 'false', placeholder: '#2F5D8A', 'aria-describedby': idHex + '-h' });
      const colorInput = el('input', { class: 'color-input', type: 'color', 'aria-label': label + ': escolher qualquer cor' });
      const hexHint = el('span', { class: 'st-hint', id: idHex + '-h', text: 'Código de cor, como #2F5D8A' });
      const sync = (v, keepText) => {
        const h = resolve(v);
        inputs.forEach(({ input, sw }) => {
          input.checked = sw.auto ? !v : !!v && (sw.id === v || sw.cor === h);
        });
        if (!keepText || document.activeElement !== hexInput) hexInput.value = h ? h.toUpperCase() : '';
        hexInput.removeAttribute('aria-invalid');
        hexHint.textContent = 'Código de cor, como #2F5D8A';
        colorInput.value = h || '#000000';
      };
      hexInput.addEventListener('input', () => {
        let t = hexInput.value.trim();
        if (t && t[0] !== '#') t = '#' + t;
        if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t)) {
          const full = t.length === 4 ? '#' + t.slice(1).split('').map((c) => c + c).join('') : t;
          commit(full.toLowerCase());
          sync(full.toLowerCase(), true);
        } else if (!t && o.auto) {
          commit('');
          sync('', true);
        } else {
          hexInput.setAttribute('aria-invalid', 'true');
          hexHint.textContent = 'Use # e 6 letras ou números, como #2F5D8A';
        }
      });
      hexInput.addEventListener('blur', () => sync(cur, false));
      colorInput.addEventListener('input', () => {
        commit(colorInput.value.toLowerCase());
        sync(colorInput.value.toLowerCase(), false);
      });
      sync(cur, false);
      const node = el('fieldset', { class: 'st-group st-color' }, [
        el('legend', { class: 'st-label', text: label }),
        row,
        el('div', { class: 'hex-row' }, [
          el('label', { class: 'sr-only', for: idHex, text: label + ' em código' }),
          hexInput,
          colorInput,
          hexHint,
        ]),
      ]);
      return { node };
    }

    // ---------------------------------------------------------- seções

    secIdentidade() {
      const d = this.draft;
      const L = this.P.LIMITES;
      const nome = this.textField('Nome', d.nome, {
        max: L.nome,
        placeholder: 'Ex.: Rosa',
        hint: 'Obrigatório. Aparece na mesa e no placar.',
        onInput: (v) => this.set(() => {
          d.nome = v;
        }),
      });
      this.nomeInput = nome.input;
      nome.input.setAttribute('aria-required', 'true');
      const apelido = this.textField('Apelido', d.apelido, {
        max: L.apelido,
        placeholder: 'Opcional',
        hint: 'Como os outros chamam. Se ficar vazio, vale o nome.',
        onInput: (v) => this.set(() => {
          d.apelido = v;
        }),
      });
      const genero = this.chips('Tratar como', this.P.CATALOGO.genero, d.genero, (v) => this.set(() => {
        d.genero = v;
      }));
      const historia = this.textField('História', d.historia, {
        max: L.historia,
        multiline: true,
        hint: 'Uma ou duas frases. Aparece na escolha de quem senta à mesa.',
        onInput: (v) => this.set(() => {
          d.historia = v;
        }),
      });
      return this.section('Identidade', [el('div', { class: 'st-grid' }, [nome.node, apelido.node]), genero.node, historia.node]);
    }

    secVisual() {
      const v = this.draft.visual;
      const C = this.P.CATALOGO;
      const setV = (k) => (val) => this.set(() => {
        v[k] = val;
      });
      return this.section('Visual', [
        this.chips('Cabelo', C.cabelo, v.cabelo, setV('cabelo')).node,
        this.colorPicker('Cor do cabelo', 'corCabelo', v.corCabelo, setV('corCabelo'), { guardaId: true }).node,
        this.colorPicker('Pele', 'pele', v.pele, setV('pele'), { guardaId: true }).node,
        this.chips('Rosto', C.rosto, v.rosto, setV('rosto')).node,
        this.acessoriosPicker(v),
        this.colorPicker('Cor do boné ou do chapéu', 'cor', v.corAcessorio, setV('corAcessorio'), { auto: true }).node,
        C.marcaNoBone ? this.chips('Marca no boné', C.marcaNoBone, v.marcaNoBone || 'nenhuma', setV('marcaNoBone')).node : null,
        this.chips('Brincos', [{ id: 'nao', rotulo: 'Sem brincos' }, { id: 'sim', rotulo: 'Com brincos' }], v.brincos ? 'sim' : 'nao', (val) => this.set(() => {
          v.brincos = val === 'sim';
        })).node,
        this.chips('Roupa', C.roupa, v.roupa, setV('roupa')).node,
        this.colorPicker('Cor da roupa', 'cor', v.cor, setV('cor')).node,
        this.colorPicker('Cor dos detalhes (listras, gola, boné)', 'cor', v.corSecundaria, setV('corSecundaria'), { auto: true }).node,
      ], { sub: 'Peças prontas: qualquer combinação fica bem na mesa.' });
    }

    /**
     * Acessórios: um por lugar (cabeça, olhos, boca ou orelha), cada lugar com "Nada" + as opções dele.
     * Grava texto com 0 ou 1 acessório e lista com 2 ou mais (como a ficha).
     */
    acessoriosPicker(v) {
      const C = this.P.CATALOGO;
      const lugares = C.lugarAcessorio || [{ id: 'cabeca', rotulo: 'Cabeça' }];
      const lugarDe = (id) => (C.acessorio.find((o) => o.id === id) || {}).lugar || null;
      const escolha = {};
      (Array.isArray(v.acessorio) ? v.acessorio : [v.acessorio]).forEach((id) => {
        const lg = lugarDe(id);
        if (lg && !escolha[lg]) escolha[lg] = id;
      });
      const gravar = () => {
        const l = lugares.map((lg) => escolha[lg.id]).filter(Boolean);
        v.acessorio = !l.length ? 'nenhum' : l.length === 1 ? l[0] : l;
      };
      const rows = lugares.map((lg) => {
        const opts = [{ id: '', rotulo: 'Nada' }].concat(C.acessorio.filter((o) => o.lugar === lg.id));
        return this.chips(lg.rotulo, opts, escolha[lg.id] || '', (val) => this.set(() => {
          escolha[lg.id] = val || null;
          gravar();
        }), 'chips--acc').node;
      });
      return el('fieldset', { class: 'st-group st-acc' }, [
        el('legend', { class: 'st-label', text: 'Acessórios' }),
        el('p', { class: 'st-hint', text: 'Um por lugar: dá para usar boné e óculos juntos, por exemplo.' }),
      ].concat(rows));
    }

    secJogo() {
      const j = this.draft.jogo;
      const P = this.P;
      const name = this.nextId('estilo');
      const styleInputs = [];
      const cards = Object.keys(P.ESTILOS).map((id) => {
        const e = P.ESTILOS[id];
        const input = el('input', { type: 'radio', name, value: id, checked: j.estilo === id });
        input.addEventListener('change', () => {
          if (!input.checked) return;
          this.set(() => {
            j.estilo = id;
            j.blefe = e.blefe;
            j.cautela = e.cautela;
          });
          blefe.set(e.blefe);
          cautela.set(e.cautela);
        });
        styleInputs.push(input);
        return el('label', { class: 'st-style' }, [
          input,
          el('span', { class: 'st-style-face' }, [
            el('strong', { class: 'st-style-name', text: e.rotulo }),
            el('span', { class: 'st-style-desc', text: e.descricao }),
            el('span', { class: 'st-style-nums', text: 'Blefe ' + e.blefe + ' · Cautela ' + e.cautela }),
          ]),
        ]);
      });
      const slider = (key, label, help, low, high, faixas) => {
        const id = this.nextId('r');
        const input = el('input', { id, type: 'range', class: 'st-range', min: '0', max: '10', step: '0.1', 'aria-describedby': id + '-h' });
        const out = el('output', { class: 'st-range-out', for: id });
        const upd = (val) => {
          out.textContent = numeroBr(val) + ' — ' + faixa(faixas, val);
          input.setAttribute('aria-valuetext', numeroBr(val) + ', ' + faixa(faixas, val));
        };
        input.value = String(j[key]);
        upd(j[key]);
        input.addEventListener('input', () => {
          const val = Math.round(Number(input.value) * 10) / 10;
          this.set(() => {
            j[key] = val;
          });
          upd(val);
        });
        return {
          node: el('div', { class: 'st-slider' }, [
            el('div', { class: 'st-field-top' }, [el('label', { class: 'st-label', for: id, text: label }), out]),
            el('p', { class: 'st-hint', id: id + '-h', text: help }),
            input,
            el('div', { class: 'st-range-ends', 'aria-hidden': 'true' }, [el('span', { text: low }), el('span', { text: high })]),
          ]),
          set(val) {
            input.value = String(val);
            upd(val);
          },
        };
      };
      const blefe = slider('blefe', 'Blefe', 'Quanto pede truco sem ter mão para isso.', 'nunca blefa', 'blefa sempre', BLEFE_FAIXAS);
      const cautela = slider('cautela', 'Cautela', 'Quanto medo tem de aceitar um pedido.', 'aceita tudo', 'só com a mão feita', CAUTELA_FAIXAS);
      const reset = el('button', { type: 'button', class: 'btn btn-small btn-ghost st-reset', text: 'Voltar aos números do estilo' });
      reset.addEventListener('click', () => {
        const e = P.ESTILOS[j.estilo] || P.ESTILOS.equilibrado;
        this.set(() => {
          j.blefe = e.blefe;
          j.cautela = e.cautela;
        });
        blefe.set(e.blefe);
        cautela.set(e.cautela);
      });
      return this.section('Jeito de jogar', [
        el('fieldset', { class: 'st-group' }, [el('legend', { class: 'st-label', text: 'Estilo' }), el('div', { class: 'st-styles' }, cards)]),
        el('div', { class: 'st-grid' }, [blefe.node, cautela.node]),
        reset,
      ], { sub: 'A ficha diz como o personagem joga; a dificuldade do menu diz quão bem.' });
    }

    secVoz() {
      const vz = this.draft.voz;
      const C = this.P.CATALOGO;
      const listen = el('button', { type: 'button', class: 'btn btn-small btn-ghost st-listen', text: 'Ouvir' });
      this.voiceStatus = el('span', { class: 'st-hint st-voice-status', 'aria-live': 'polite' });
      listen.addEventListener('click', () => {
        this.voiceStatus.textContent = '';
        const p = this.current().personagem;
        const text = this.P.fala(p, 'aceitar', Math.random) || this.P.fala(p, 'truco', Math.random) || AMOSTRA_VOZ;
        this.speak(text, false);
      });
      return this.section('Voz', [
        el('div', { class: 'st-grid' }, [
          this.chips('Tom', C.tom, vz.tom, (v) => this.set(() => {
            vz.tom = v;
          })).node,
          this.chips('Velocidade', C.velocidade, vz.velocidade, (v) => this.set(() => {
            vz.velocidade = v;
          })).node,
        ]),
        el('div', { class: 'st-row' }, [listen, this.voiceStatus]),
      ], { sub: 'Usa a voz em português do navegador; o timbre muda de um computador para outro.' });
    }

    /** Editor de falas por momento (reusado nas relações). get(m) → lista; set(m, lista). */
    linesEditor(get, set, opts) {
      const P = this.P;
      const o = opts || {};
      const selId = this.nextId('m');
      const sel = el('select', { id: selId, class: 'st-select' });
      const when = el('p', { class: 'st-hint' });
      const list = el('ul', { class: 'st-lines', role: 'list' });
      const inputId = this.nextId('nf');
      const input = el('input', { id: inputId, class: 'st-input', type: 'text', maxlength: String(P.LIMITES.fala), autocomplete: 'off', placeholder: 'Escreva uma fala' });
      const add = el('button', { type: 'button', class: 'btn btn-small btn-ghost st-add', text: 'Adicionar' });
      const sugg = el('div', { class: 'st-suggest' });
      const fill = () => {
        const cur = sel.value || P.MOMENTOS[0].id;
        sel.textContent = '';
        P.MOMENTOS.forEach((m) => {
          const n = (get(m.id) || []).length;
          sel.appendChild(el('option', { value: m.id, text: m.rotulo + (n ? ' (' + n + ')' : '') }));
        });
        sel.value = cur;
      };
      const render = () => {
        const m = sel.value;
        const meta = P.MOMENTOS.find((x) => x.id === m);
        when.textContent = meta ? meta.quando + '.' : '';
        const items = get(m) || [];
        list.textContent = '';
        if (!items.length) list.appendChild(el('li', { class: 'st-line st-line--empty', text: o.empty || 'Sem falas próprias: vale o que o jogo já fala.' }));
        items.forEach((t, i) => {
          const rm = el('button', { type: 'button', class: 'icon-btn st-line-rm', 'aria-label': 'Tirar a fala ' + t, html: ICONS.close });
          rm.addEventListener('click', () => {
            const next = items.slice();
            next.splice(i, 1);
            set(m, next);
            fill();
            render();
            this.hud.focusSoon(list.querySelector('.st-line-rm') || input);
          });
          list.appendChild(el('li', { class: 'st-line' }, [el('span', { class: 'st-line-text', text: '“' + t + '”' }), rm]));
        });
        sugg.textContent = '';
        const ideas = (P.SUGESTOES[m] || []).filter((t) => items.indexOf(t) < 0);
        if (ideas.length) {
          sugg.appendChild(el('span', { class: 'st-hint', text: 'Sugestões:' }));
          ideas.forEach((t) => {
            const b = el('button', { type: 'button', class: 'chip-btn', text: '+ ' + t, 'aria-label': 'Adicionar a fala ' + t });
            b.addEventListener('click', () => {
              push(t);
              this.hud.focusSoon(input);
            });
            sugg.appendChild(b);
          });
        }
      };
      const addErr = el('p', { class: 'st-error', role: 'alert' });
      const push = (t) => {
        const text = String(t || '').trim();
        addErr.textContent = '';
        if (!text) return;
        const m = sel.value;
        // Fala que a ficha recusaria (palavra que atrapalha a mesa) nem entra: explica na hora.
        const test = P.normalizar({ nome: 'x', falas: { [m]: [text] } });
        if (!test.personagem || !test.personagem.falas[m]) {
          const why = (test.avisos[0] || '').replace(/^x: /, '').replace('Tirei essa fala.', 'Essa não entra.');
          addErr.textContent = why ? why.charAt(0).toUpperCase() + why.slice(1) : 'Essa fala não serve.';
          return false;
        }
        const items = (get(m) || []).slice();
        if (items.indexOf(text) < 0) items.push(text);
        set(m, items);
        fill();
        render();
      };
      add.addEventListener('click', () => {
        if (push(input.value) !== false) input.value = '';
        this.hud.focusSoon(input);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (push(input.value) !== false) input.value = '';
        }
      });
      input.addEventListener('input', () => {
        addErr.textContent = '';
      });
      sel.addEventListener('change', render);
      fill();
      render();
      const node = el('div', { class: 'st-lines-editor' }, [
        el('div', { class: 'st-field' }, [el('label', { class: 'st-label', for: selId, text: o.label || 'Momento' }), sel, when]),
        list,
        el('div', { class: 'st-add-row' }, [el('label', { class: 'sr-only', for: inputId, text: 'Nova fala' }), input, add]),
        addErr,
        sugg,
      ]);
      return { node, refresh: () => { fill(); render(); } };
    }

    secFalas() {
      const d = this.draft;
      const ed = this.linesEditor(
        (m) => d.falas[m],
        (m, l) => this.set(() => {
          d.falas[m] = l;
        })
      );
      return this.section('Falas', [ed.node], {
        collapsible: true,
        open: this.mode !== 'view' || Object.keys(d.falas).length > 0,
        sub: 'O jogo sorteia uma por vez. Até 40 letras cabem melhor no balão. Evite “Troco”, “Truca”, “Jorge” e ordens ao parceiro (“Mata!”).',
      });
    }

    secSinais() {
      const s = this.draft.sinais;
      const P = this.P;
      const rows = P.CATALOGO.carta.map((c) => {
        const id = this.nextId('s');
        const sel = el('select', { id, class: 'st-select' });
        P.CATALOGO.gesto.forEach((g) => sel.appendChild(el('option', { value: g.id, text: g.rotulo })));
        sel.value = s[c.id];
        sel.addEventListener('change', () => this.set(() => {
          s[c.id] = sel.value;
        }));
        const test = el('button', { type: 'button', class: 'btn btn-small btn-ghost st-test-sign', text: 'Testar', 'aria-label': 'Testar o sinal de ' + c.rotulo });
        test.addEventListener('click', () => this.signal(c.id));
        return el('div', { class: 'st-sign-row' }, [el('label', { class: 'st-label', for: id, text: c.rotulo }), sel, test]);
      });
      return this.section('Sinais', rows, {
        collapsible: true,
        open: false,
        sub: 'O gesto que faz para você quando é seu parceiro no 2×2 e tem essa carta. Os adversários não sinalizam.',
      });
    }

    secRelacoes() {
      const r = this.draft.relacoes;
      const P = this.P;
      const others = () => this.lista().filter((p) => p.id !== this.editingId && p.nome !== this.draft.nome);
      const pick = (label, key) => {
        const id = this.nextId('rel');
        const sel = el('select', { id, class: 'st-select' });
        sel.appendChild(el('option', { value: '', text: 'Ninguém' }));
        others().forEach((p) => sel.appendChild(el('option', { value: p.id, text: p.nome })));
        if (r[key] && !others().some((p) => p.id === r[key])) sel.appendChild(el('option', { value: r[key], text: r[key] }));
        sel.value = r[key] || '';
        sel.addEventListener('change', () => this.set(() => {
          r[key] = sel.value;
        }));
        return el('div', { class: 'st-field' }, [el('label', { class: 'st-label', for: id, text: label }), sel]);
      };
      const whoId = this.nextId('who');
      const who = el('select', { id: whoId, class: 'st-select' });
      const people = others();
      Object.keys(r.falasPara || {}).forEach((k) => {
        if (!people.some((p) => p.id === k)) people.push({ id: k, nome: k });
      });
      people.forEach((p) => who.appendChild(el('option', { value: p.id, text: p.nome + ((r.falasPara[p.id] && Object.keys(r.falasPara[p.id]).length) ? ' (tem falas)' : '') })));
      const ed = this.linesEditor(
        (m) => (r.falasPara[who.value] || {})[m],
        (m, l) => this.set(() => {
          r.falasPara[who.value] = r.falasPara[who.value] || {};
          r.falasPara[who.value][m] = l;
        }),
        { empty: 'Nada especial para essa pessoa neste momento.' }
      );
      who.addEventListener('change', () => ed.refresh());
      const firstWith = people.find((p) => r.falasPara[p.id]);
      if (firstWith) who.value = firstWith.id;
      ed.refresh();
      return this.section('Relações', [
        el('div', { class: 'st-grid' }, [pick('Parceiro de dupla', 'parceiro'), pick('Rival', 'rival')]),
        el('div', { class: 'st-field' }, [el('label', { class: 'st-label', for: whoId, text: 'Falas para alguém' }), who,
          el('p', { class: 'st-hint', text: 'Quando essa pessoa está na mesa (ex.: pediu o truco que ele aceita), estas falas têm prioridade.' })]),
        ed.node,
      ], { collapsible: true, open: false, sub: 'Opcional: rivalidades e falas para personagens específicos.' });
    }

    // ---------------------------------------------------------- mudanças e validação

    set(fn) {
      fn();
      this.dirty = true;
      this.pasteAvisos = [];
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.refresh(false), 90);
    }

    refresh() {
      if (this.closed || this.view !== 'editor') return;
      const r = this.current();
      const p = r.personagem;
      const spec = this.safeSpec(p);
      if (this.preview && typeof this.preview.setSpec === 'function') {
        try {
          this.preview.setSpec(spec);
        } catch (err) {
          reportError(err, 'prévia do personagem');
        }
      }
      if (this.fallbackFace) {
        const f = this.fallbackFace.querySelector('.st-face');
        f.setAttribute('style', '--skin:' + spec.skin + ';--hair:' + spec.hair + ';--shirt:' + spec.shirt + ';--accent:' + spec.accent);
        f.setAttribute('data-hair', spec.hairStyle || 'curto');
      }
      this.stageName.textContent = r.semNome ? 'Sem nome' : p.nome;
      // Avisos: tira o "Nome: " do começo (aqui já se sabe de quem é).
      const pref = p.nome + ': ';
      const avisos = this.pasteAvisos.concat(r.avisos.map((a) => (a.indexOf(pref) === 0 ? a.slice(pref.length) : a)));
      this.avisosEl.textContent = '';
      this.avisosEl.classList.toggle('is-ok', !avisos.length);
      if (!avisos.length) {
        this.avisosEl.appendChild(el('p', { class: 'st-ok', text: this.mode === 'view' ? 'Ficha de exemplo, sem avisos.' : 'Ficha em ordem.' }));
      } else {
        this.avisosEl.appendChild(el('p', { class: 'st-avisos-title', text: avisos.length === 1 ? '1 aviso' : avisos.length + ' avisos' }));
        this.avisosEl.appendChild(el('ul', { class: 'st-avisos-list' }, avisos.map((a) => el('li', { text: a.charAt(0).toUpperCase() + a.slice(1) }))));
      }
      if (this.saveBtn) this.saveBtn.setAttribute('aria-disabled', r.semNome ? 'true' : 'false');
    }

    status(text, kind) {
      if (!this.statusEl) return;
      this.statusEl.textContent = text || '';
      this.statusEl.setAttribute('data-kind', kind || 'neutral');
    }

    save() {
      const r = this.P.normalizar(fichaDe(this.draft));
      if (!r.personagem) {
        this.status('Falta o nome: escreva como o personagem se chama.', 'bad');
        this.hud.focusSoon(this.nomeInput);
        return;
      }
      const ficha = fichaDe(this.draft);
      ficha.id = this.editingId || this.uniqueId(r.personagem.id);
      const res = this.P.salvarMeu(ficha);
      if (!res.salvo) {
        this.status(res.avisos[res.avisos.length - 1] || 'Não deu para salvar.', 'bad');
        return;
      }
      this.editingId = res.personagem.id;
      this.mode = 'edit';
      this.dirty = false;
      this.pasteAvisos = [];
      this.setTitle('Meus personagens', 'Editar ' + res.personagem.nome);
      const salvo = res.personagem.genero === 'ela' ? ' está salva' : ' está salvo';
      this.status(res.personagem.nome + salvo + ' em Meus personagens e já pode sentar à mesa (menu → Quem senta à mesa).', 'good');
      this.refresh();
    }

    // ---------------------------------------------------------- copiar / colar

    copy() {
      const r = this.current();
      if (r.semNome) {
        this.status('Dê um nome antes de copiar a ficha.', 'bad');
        return;
      }
      const text = this.P.paraTexto(r.personagem);
      const done = () => this.status('Ficha copiada. Mande para alguém ou salve como personagens/' + r.personagem.id + '.js.', 'good');
      const nav = root.navigator;
      let p = null;
      try {
        if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') p = nav.clipboard.writeText(text);
      } catch (_) {
        p = null;
      }
      if (!p) {
        this.openCopySheet(text);
        return;
      }
      let settledCopy = false;
      const fallback = () => {
        if (settledCopy) return;
        settledCopy = true;
        this.openCopySheet(text);
      };
      // Alguns navegadores deixam a promessa pendurada (permissão): depois de 1,5 s, mostra o texto.
      const t = setTimeout(fallback, 1500);
      Promise.resolve(p).then(
        () => {
          clearTimeout(t);
          if (settledCopy) return;
          settledCopy = true;
          done();
        },
        () => {
          clearTimeout(t);
          fallback();
        }
      );
    }

    openSheet(title, content, buttons, focus) {
      this.closeSheet();
      const id = this.nextId('sheet');
      const box = el('div', { class: 'st-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id }, [
        el('h3', { class: 'st-h3', id, text: title }),
      ].concat(content, [el('div', { class: 'st-sheet-buttons' }, buttons)]));
      const wrap = el('div', { class: 'st-sheet-wrap' }, [box]);
      wrap.addEventListener('click', (e) => {
        if (e.target === wrap) this.closeSheet();
      });
      this.bodyEl.inert = true;
      this.card.querySelector('.studio-head').inert = true;
      this.card.appendChild(wrap);
      this.sheet = { node: wrap, prev: document.activeElement };
      this.hud.focusSoon(focus || box.querySelector('button'));
      return box;
    }

    closeSheet() {
      if (!this.sheet) return;
      const s = this.sheet;
      this.sheet = null;
      s.node.remove();
      this.bodyEl.inert = false;
      this.card.querySelector('.studio-head').inert = false;
      if (s.prev && s.prev.isConnected) this.hud.focusSoon(s.prev);
    }

    openCopySheet(text) {
      const ta = el('textarea', { class: 'st-input st-code', rows: '12', readonly: true, spellcheck: 'false', 'aria-label': 'Texto da ficha' });
      ta.value = text;
      const msg = el('p', { class: 'st-hint', role: 'status' });
      const close = el('button', { type: 'button', class: 'btn btn-primary', text: 'Pronto' });
      close.addEventListener('click', () => this.closeSheet());
      this.openSheet('Copiar ficha', [
        el('p', { class: 'st-hint', text: 'O texto já está selecionado: copie com Ctrl+C (ou Cmd+C), ou toque e segure no celular.' }),
        ta,
        msg,
      ], [close], ta);
      requestAnimationFrame(() => {
        try {
          ta.focus();
          ta.select();
          if (document.execCommand && document.execCommand('copy')) msg.textContent = 'Copiado!';
        } catch (_) {
          // sem cópia automática: fica o texto selecionado
        }
      });
    }

    openPaste() {
      const id = this.nextId('paste');
      const ta = el('textarea', { id, class: 'st-input st-code', rows: '12', spellcheck: 'false', placeholder: "Truco.personagem({\n  nome: 'Rosa',\n})", 'aria-describedby': id + '-e' });
      const err = el('p', { class: 'st-error', id: id + '-e', role: 'alert' });
      const cancel = el('button', { type: 'button', class: 'btn btn-ghost', text: 'Cancelar' });
      const use = el('button', { type: 'button', class: 'btn btn-primary st-use', text: 'Usar esta ficha' });
      cancel.addEventListener('click', () => this.closeSheet());
      use.addEventListener('click', () => {
        const r = this.P.deTexto(ta.value);
        if (r.erro) {
          err.textContent = r.erro;
          ta.setAttribute('aria-invalid', 'true');
          if (r.linha > 0) {
            const lines = ta.value.split('\n');
            let at = 0;
            for (let i = 0; i < r.linha - 1 && i < lines.length; i++) at += lines[i].length + 1;
            at += Math.max(0, r.coluna - 1);
            try {
              ta.focus();
              ta.setSelectionRange(at, Math.min(ta.value.length, at + 1));
            } catch (_) {
              // seleção não suportada
            }
          }
          return;
        }
        const n = this.P.normalizar(r.ficha);
        if (!n.personagem) {
          err.textContent = n.avisos.join(' ');
          ta.setAttribute('aria-invalid', 'true');
          return;
        }
        this.closeSheet();
        const d = rascunhoDe(n.personagem);
        this.openEditor(null, 'new', d);
        const pref = n.personagem.nome + ': ';
        this.pasteAvisos = n.avisos.map((a) => 'Ao colar: ' + (a.indexOf(pref) === 0 ? a.slice(pref.length) : a));
        this.dirty = true;
        this.refresh();
        this.status('Ficha colada. Confira e toque em Salvar para guardar em Meus personagens.', 'good');
      });
      this.openSheet('Colar ficha', [
        el('label', { class: 'st-hint', for: id, text: 'Cole aqui o texto da ficha (começa com Truco.personagem({ ou com {).' }),
        ta,
        err,
      ], [cancel, use], ta);
    }

    confirmLeave(then) {
      const stay = el('button', { type: 'button', class: 'btn btn-ghost', text: 'Continuar editando' });
      const leave = el('button', { type: 'button', class: 'btn btn-danger st-leave', text: 'Sair sem salvar' });
      stay.addEventListener('click', () => this.closeSheet());
      leave.addEventListener('click', () => {
        this.closeSheet();
        this.dirty = false;
        then();
      });
      this.openSheet('Sair sem salvar?', [el('p', { class: 'st-hint', text: 'As mudanças desta ficha ainda não foram salvas.' })], [stay, leave], stay);
    }
  }

  const HUD = {
    create(hudEl) {
      return new Hud(hudEl);
    },
    DEFAULT_SETTINGS,
    layoutBalloon,
    parseCard,
    sanitizeSettings,
  };

  Truco.HUD = HUD;
  if (typeof module === 'object' && module.exports) module.exports = HUD;
})(typeof window !== 'undefined' ? window : globalThis);
