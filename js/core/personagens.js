/*
 * TrucAÍ — Truco.Personagens: as fichas de quem senta à mesa (docs/PERSONAGENS.md).
 *
 * Puro e testável em Node. Uma ficha é um objeto simples (nome, visual, jogo, voz, falas, sinais,
 * relacoes); `normalizar` transforma qualquer coisa num personagem completo, com padrões e avisos em
 * português, e só recusa ficha sem nome. Nada aqui lança para quem chama.
 *
 *   Truco.personagem(ficha)          registra uma ficha do jogo (usado pelos arquivos personagens/*.js)
 *   Personagens.normalizar(ficha)    -> { personagem, avisos }
 *   Personagens.registrar(ficha)     -> { personagem, avisos }   (id único entre os do jogo)
 *   Personagens.lista()              -> personagens do jogo + "Meus personagens" (localStorage)
 *   Personagens.salvarMeu(ficha) / removerMeu(id)
 *   Personagens.paraTexto(p) / deTexto(texto)   ficha em texto e de volta (parser seguro, sem eval)
 *   Personagens.avatarSpec(p, seat) / personalidade(p) / voz(p) / fala(p, momento, rng, ctx) / sinal(p, carta)
 */
(function (root) {
  'use strict';
  const Truco = (root.Truco = root.Truco || {});

  const STORAGE_KEY = 'cafe-truco:personagens';
  const LIMITES = Object.freeze({ nome: 16, apelido: 20, historia: 200, fala: 80, falasPorMomento: 12, meus: 60 });

  // ------------------------------------------------------------------ catálogo

  function opcoes(list) {
    return Object.freeze(list.map((o) => Object.freeze(o)));
  }

  const CATALOGO = Object.freeze({
    pele: opcoes([
      { id: 'clara', rotulo: 'Clara', cor: '#f0c8a4' },
      { id: 'morena-clara', rotulo: 'Morena clara', cor: '#e0b48e' },
      { id: 'morena', rotulo: 'Morena', cor: '#b5835a' },
      { id: 'negra', rotulo: 'Negra', cor: '#6e4630' },
    ]),
    cabelo: opcoes([
      { id: 'careca', rotulo: 'Careca' },
      { id: 'curto', rotulo: 'Curto' },
      { id: 'topete', rotulo: 'Topete' },
      { id: 'coque', rotulo: 'Coque' },
      { id: 'comprido', rotulo: 'Comprido' },
      { id: 'rabo-de-cavalo', rotulo: 'Rabo de cavalo' },
      { id: 'black', rotulo: 'Black' },
      { id: 'laterais', rotulo: 'Só dos lados' },
    ]),
    corCabelo: opcoes([
      { id: 'preto', rotulo: 'Preto', cor: '#1c1512' },
      { id: 'castanho', rotulo: 'Castanho', cor: '#5a3a24' },
      { id: 'loiro', rotulo: 'Loiro', cor: '#c9a05a' },
      { id: 'ruivo', rotulo: 'Ruivo', cor: '#a0482a' },
      { id: 'grisalho', rotulo: 'Grisalho', cor: '#8a8580' },
      { id: 'branco', rotulo: 'Branco', cor: '#e4e0d8' },
    ]),
    rosto: opcoes([
      { id: 'nenhum', rotulo: 'Liso' },
      { id: 'bigode', rotulo: 'Bigode' },
      { id: 'bigodao', rotulo: 'Bigodão' },
      { id: 'cavanhaque', rotulo: 'Cavanhaque' },
      { id: 'barba', rotulo: 'Barba' },
    ]),
    // Cada acessório ocupa um lugar do corpo; a ficha aceita um por lugar (lista: ['bone-frente', 'oculos-fino']).
    acessorio: opcoes([
      { id: 'nenhum', rotulo: 'Nenhum', lugar: null },
      { id: 'bone', rotulo: 'Boné', lugar: 'cabeca' },
      { id: 'bone-frente', rotulo: 'Boné (aba pra frente)', lugar: 'cabeca' },
      { id: 'chapeu-panama', rotulo: 'Chapéu-panamá', lugar: 'cabeca' },
      { id: 'oculos', rotulo: 'Óculos', lugar: 'olhos' },
      { id: 'oculos-fino', rotulo: 'Óculos fininho', lugar: 'olhos' },
      { id: 'lapis-na-orelha', rotulo: 'Lápis na orelha', lugar: 'boca-orelha' },
      { id: 'palito-na-boca', rotulo: 'Palito na boca', lugar: 'boca-orelha' },
    ]),
    lugarAcessorio: opcoes([
      { id: 'cabeca', rotulo: 'Cabeça' },
      { id: 'olhos', rotulo: 'Olhos' },
      { id: 'boca-orelha', rotulo: 'Boca ou orelha' },
    ]),
    // Desenho na frente do boné (só aparece com boné).
    marcaNoBone: opcoes([
      { id: 'nenhuma', rotulo: 'Nenhuma' },
      { id: 'tres-quadrados', rotulo: 'Três quadradinhos' },
    ]),
    roupa: opcoes([
      { id: 'camisa-lisa', rotulo: 'Camisa lisa' },
      { id: 'camisa-listrada', rotulo: 'Listrada' },
      { id: 'camisa-de-time', rotulo: 'Camisa de time' },
      { id: 'regata', rotulo: 'Regata' },
      { id: 'camisa-social', rotulo: 'Social' },
      { id: 'avental', rotulo: 'Avental' },
    ]),
    // Cores com nome para a roupa (também aceita código '#rrggbb').
    cor: opcoes([
      { id: 'azul', rotulo: 'Azul', cor: '#2f5d8a' },
      { id: 'vermelho', rotulo: 'Vermelho', cor: '#9b3b2e' },
      { id: 'verde', rotulo: 'Verde', cor: '#3e6b45' },
      { id: 'amarelo', rotulo: 'Amarelo', cor: '#d3a13a' },
      { id: 'laranja', rotulo: 'Laranja', cor: '#c8672f' },
      { id: 'vinho', rotulo: 'Vinho', cor: '#6b2433' },
      { id: 'roxo', rotulo: 'Roxo', cor: '#5b4275' },
      { id: 'rosa', rotulo: 'Rosa', cor: '#c46a86' },
      { id: 'cinza', rotulo: 'Cinza', cor: '#6c6863' },
      { id: 'preto', rotulo: 'Preto', cor: '#2a2522' },
      { id: 'branco', rotulo: 'Branco', cor: '#e8e2d4' },
      { id: 'caqui', rotulo: 'Cáqui', cor: '#9a8660' },
    ]),
    genero: opcoes([
      { id: 'ele', rotulo: 'Ele (o Tião)' },
      { id: 'ela', rotulo: 'Ela (a Cida)' },
    ]),
    tom: opcoes([
      { id: 'grave', rotulo: 'Grave', pitch: 0.78 },
      { id: 'medio', rotulo: 'Médio', pitch: 1 },
      { id: 'agudo', rotulo: 'Agudo', pitch: 1.22 },
    ]),
    velocidade: opcoes([
      { id: 'devagar', rotulo: 'Devagar', rate: 0.9 },
      { id: 'normal', rotulo: 'Normal', rate: 1 },
      { id: 'rapido', rotulo: 'Rápida', rate: 1.12 },
    ]),
    gesto: opcoes([
      { id: 'piscar', rotulo: 'Piscar', feito: 'piscou' },
      { id: 'levantar-sobrancelha', rotulo: 'Levantar a sobrancelha', feito: 'levantou a sobrancelha' },
      { id: 'bochecha-com-lingua', rotulo: 'Bochecha com a língua', feito: 'empurrou a bochecha com a língua' },
      { id: 'ponta-da-lingua', rotulo: 'Ponta da língua', feito: 'mostrou a ponta da língua' },
      { id: 'levantar-ombro', rotulo: 'Levantar o ombro', feito: 'levantou o ombro' },
      { id: 'encher-bochechas', rotulo: 'Encher as bochechas', feito: 'encheu as bochechas' },
      { id: 'cocar-nariz', rotulo: 'Coçar o nariz', feito: 'coçou o nariz' },
    ]),
    carta: opcoes([
      { id: 'zap', rotulo: 'Zap', nome: 'o Zap' },
      { id: 'copas', rotulo: 'Copas', nome: 'o Copas' },
      { id: 'espadilha', rotulo: 'Espadilha', nome: 'a Espadilha' },
      { id: 'picafumo', rotulo: 'Pica-fumo', nome: 'o Pica-fumo' },
      { id: 'tres', rotulo: 'Um 3', nome: 'um 3' },
    ]),
  });

  const VISUAL_PADRAO = Object.freeze({
    pele: 'morena-clara', cabelo: 'curto', corCabelo: 'castanho', rosto: 'nenhum', acessorio: 'nenhum', roupa: 'camisa-lisa',
  });

  // Nome do campo nos avisos ("não conheço o cabelo …").
  const ROTULO_CAMPO = Object.freeze({
    pele: 'a pele', cabelo: 'o cabelo', corCabelo: 'a cor de cabelo', rosto: 'o rosto', acessorio: 'o acessório',
    roupa: 'a roupa', cor: 'a cor', corSecundaria: 'a cor secundária', estilo: 'o estilo', tom: 'o tom de voz',
    velocidade: 'a velocidade da voz', genero: 'o gênero', corAcessorio: 'a cor do boné/chapéu', marcaNoBone: 'a marca no boné',
  });

  const ESTILOS = Object.freeze({
    blefador: Object.freeze({ blefe: 8, cautela: 3, rotulo: 'Blefador', descricao: 'Pede truco com mão fraca para assustar; gosta de trucar de mão.' }),
    cauteloso: Object.freeze({ blefe: 2, cautela: 8, rotulo: 'Cauteloso', descricao: 'Só pede truco com mão boa; corre fácil.' }),
    equilibrado: Object.freeze({ blefe: 5, cautela: 5, rotulo: 'Equilibrado', descricao: 'Joga pelo livro; blefa de vez em quando.' }),
    marreco: Object.freeze({ blefe: 4, cautela: 2, rotulo: 'Marreco', descricao: 'Novato: aceita tudo e esquece quais manilhas já saíram.' }),
  });

  /** Momentos de fala, na ordem da tela, com quando acontecem. */
  const MOMENTOS = opcoes([
    { id: 'truco', rotulo: 'Pedir truco', quando: 'Ao pedir truco (vale 3)' },
    { id: 'seis', rotulo: 'Pedir seis', quando: 'Ao pedir ou aumentar para seis' },
    { id: 'nove', rotulo: 'Pedir nove', quando: 'Ao pedir ou aumentar para nove' },
    { id: 'doze', rotulo: 'Pedir doze', quando: 'Ao pedir ou aumentar para doze' },
    { id: 'aceitar', rotulo: 'Aceitar', quando: 'Quando aceita um pedido' },
    { id: 'correr', rotulo: 'Correr', quando: 'Quando corre de um pedido' },
    { id: 'ganhouRodada', rotulo: 'Ganhou a rodada', quando: 'Fim de uma rodada que o time dela ganhou' },
    { id: 'perdeuRodada', rotulo: 'Perdeu a rodada', quando: 'Fim de uma rodada que o time dela perdeu' },
    { id: 'cangou', rotulo: 'Cangou', quando: 'Rodada empatada' },
    { id: 'ganhouMao', rotulo: 'Ganhou a mão', quando: 'Fim de uma mão ganha' },
    { id: 'perdeuMao', rotulo: 'Perdeu a mão', quando: 'Fim de uma mão perdida' },
    { id: 'maoDeOnzeJoga', rotulo: 'Joga a mão de onze', quando: 'Decide jogar a mão de onze' },
    { id: 'maoDeOnzeCorre', rotulo: 'Corre da mão de onze', quando: 'Decide correr da mão de onze' },
    { id: 'pensando', rotulo: 'Pensando', quando: 'Enquanto decide a jogada (use pouco)' },
    { id: 'ganhouPartida', rotulo: 'Ganhou a partida', quando: 'Fim da partida, ganhando' },
    { id: 'perdeuPartida', rotulo: 'Perdeu a partida', quando: 'Fim da partida, perdendo' },
  ]);
  const MOMENTO_IDS = MOMENTOS.map((m) => m.id);

  /** Sugestões para a tela (todas passam pela lista de palavras proibidas). */
  const SUGESTOES = Object.freeze({
    truco: ['Truco!', 'Truco, ladrão!', 'Truco! E aí, vem?', 'Truco nessa mesa!'],
    seis: ['Seis!', 'Meio-pau!', 'É seis, ladrão!'],
    nove: ['Nove!', 'Nove neles!', 'É nove!'],
    doze: ['Doze!', 'Queda!', 'Doze, e seja o que Deus quiser!'],
    aceitar: ['Cai!', 'Manda que eu gosto.', 'Pode vir!', 'Venha!'],
    correr: ['Corro... dessa vez.', 'Essa eu corro.', 'Fica pra próxima.'],
    ganhouRodada: ['A primeira vai à missa!', 'Tá no papo!', 'Levei essa!'],
    perdeuRodada: ['Foi sorte!', 'Deixa estar...', 'Calma, que a mão não acabou.'],
    cangou: ['Cangou!', 'Melou!', 'Embuchou!'],
    ganhouMao: ['Pode marcar!', 'Mais tampinha pra cá!', 'Tento nosso!'],
    perdeuMao: ['Essa passou.', 'A próxima é nossa.', 'Pé frio!'],
    maoDeOnzeJoga: ['Vamos jogar!', 'Essa dá pra jogar!'],
    maoDeOnzeCorre: ['Essa não dá.', 'Melhor correr dessa.'],
    pensando: ['Hmm...', 'Deixa eu pensar...', 'Traz mais um pingado aí!'],
    ganhouPartida: ['Quem perdeu paga o café!', 'É assim que se joga!'],
    perdeuPartida: ['Amanhã tem revanche.', 'Hoje não foi dia.'],
  });

  /** Palavras que atrapalham a mesa (soam como pedido de truco ou mandam no parceiro). */
  const PROIBIDAS = Object.freeze([
    { re: /\btroco\b/, palavra: 'Troco', motivo: 'soa como pedido de truco' },
    { re: /\btruca\b/, palavra: 'Truca', motivo: 'soa como pedido de truco' },
    { re: /\bjorge\b/, palavra: 'Jorge', motivo: 'soa como pedido de truco' },
    { re: /\bmata\b/, palavra: 'Mata', motivo: 'é ordem para o parceiro' },
    { re: /\bdeixa (?:pra|para) mim\b/, palavra: 'Deixa pra mim', motivo: 'é ordem para o parceiro' },
    { re: /\bdeixa comigo\b/, palavra: 'Deixa comigo', motivo: 'é ordem para o parceiro' },
  ]);

  const SINAIS_PADRAO = Object.freeze({
    zap: 'piscar', copas: 'levantar-sobrancelha', espadilha: 'bochecha-com-lingua', picafumo: 'ponta-da-lingua', tres: 'levantar-ombro',
  });
  const CARTAS_SINAL = Object.keys(SINAIS_PADRAO);
  const APELIDOS_CARTA = Object.freeze({ 'pica-fumo': 'picafumo', 3: 'tres', 'tres': 'tres', 'um-3': 'tres' });

  const CAMPOS = ['nome', 'apelido', 'historia', 'genero', 'visual', 'jogo', 'voz', 'falas', 'sinais', 'relacoes', 'id'];
  const CAMPOS_VISUAL = ['pele', 'cabelo', 'corCabelo', 'rosto', 'acessorio', 'roupa', 'cor', 'corSecundaria', 'corAcessorio', 'marcaNoBone', 'brincos'];

  // ------------------------------------------------------------------ utilidades

  const hasOwn = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  /** Minúsculas, sem acento, espaços e sublinhados viram hífen: 'Morena Clara' → 'morena-clara'. */
  function chave(v) {
    return String(v)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[\s_]+/g, '-');
  }

  function semAcento(v) {
    return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function slug(nome) {
    const s = semAcento(nome).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s || 'personagem';
  }

  function hash(text) {
    let h = 2166136261;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mostrar(v) {
    if (typeof v === 'string') return '“' + (v.length > 30 ? v.slice(0, 30) + '…' : v) + '”';
    try {
      const t = JSON.stringify(v);
      return t && t.length > 30 ? t.slice(0, 30) + '…' : String(t);
    } catch (_) {
      return String(v);
    }
  }

  function limpaTexto(v) {
    return String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function hex(v) {
    if (typeof v !== 'string') return null;
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
    if (!m) return null;
    let h = m[1].toLowerCase();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return '#' + h;
  }

  function misturar(a, b, t) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const ch = (p, s) => (p >> s) & 255;
    const out = [16, 8, 0].map((s) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t));
    return '#' + out.map((c) => c.toString(16).padStart(2, '0')).join('');
  }

  function luminancia(c) {
    const p = parseInt(c.slice(1), 16);
    return (0.299 * ((p >> 16) & 255) + 0.587 * ((p >> 8) & 255) + 0.114 * (p & 255)) / 255;
  }

  /** Cor secundária (listras, gola, boné) a partir da principal. */
  function corSecundariaDe(cor) {
    return luminancia(cor) < 0.45 ? misturar(cor, '#ebddbf', 0.62) : misturar(cor, '#17110d', 0.45);
  }

  /** Cópia com os nomes de campo acertados sem ligar para acento e maiúscula ("História" → historia). */
  function canonico(obj, campos) {
    const out = {};
    for (const k of Object.keys(obj)) {
      const alvo = campos.find((c) => semAcento(c) === semAcento(k)) || k;
      if (!hasOwn(out, alvo) || alvo === k) out[alvo] = obj[k];
    }
    return out;
  }

  function acharOpcao(campo, v) {
    const id = chave(v);
    return CATALOGO[campo].find((o) => o.id === id || chave(o.rotulo) === id) || null;
  }

  // ------------------------------------------------------------------ normalizar

  /**
   * Transforma uma ficha em personagem completo. Nunca lança.
   * -> { personagem | null, avisos: string[] }  (personagem null só quando falta o nome)
   */
  function normalizar(ficha) {
    const avisos = [];
    if (!isObj(ficha)) {
      return { personagem: null, avisos: ['A ficha precisa ser um objeto entre { }, com pelo menos o nome.'] };
    }
    ficha = canonico(ficha, CAMPOS);
    if (isObj(ficha.visual)) ficha.visual = canonico(ficha.visual, CAMPOS_VISUAL);
    if (isObj(ficha.jogo)) ficha.jogo = canonico(ficha.jogo, ['estilo', 'blefe', 'cautela']);
    if (isObj(ficha.voz)) ficha.voz = canonico(ficha.voz, ['tom', 'velocidade']);
    let nomeBruto = ficha.nome;
    if (typeof nomeBruto === 'number' && Number.isFinite(nomeBruto)) nomeBruto = String(nomeBruto);
    let nome = typeof nomeBruto === 'string' ? limpaTexto(nomeBruto) : '';
    if (!nome) {
      return {
        personagem: null,
        avisos: [hasOwn(ficha, 'nome') ? 'O nome está vazio: todo personagem precisa de um nome.' : 'Falta o nome: todo personagem precisa de um nome.'],
      };
    }
    if (nome.length > LIMITES.nome) {
      const cortado = nome.slice(0, LIMITES.nome).trim();
      avisos.push('o nome tem ' + nome.length + ' letras; cabem ' + LIMITES.nome + '. Usei ' + mostrar(cortado) + '.');
      nome = cortado;
    }
    const avisar = (t) => avisos.push(t);

    for (const k of Object.keys(ficha)) {
      if (CAMPOS.indexOf(k) < 0) avisar('não conheço o campo ' + mostrar(k) + '; ignorei. Campos: ' + CAMPOS.filter((c) => c !== 'id').join(', ') + '.');
    }

    const texto = (campo, limite) => {
      const v = ficha[campo];
      if (v === undefined || v === null || v === '') return '';
      if (typeof v !== 'string') {
        avisar(campo + ' precisa ser um texto entre aspas; ignorei.');
        return '';
      }
      let t = limpaTexto(v);
      if (t.length > limite) {
        avisar(campo + ' tem ' + t.length + ' letras; cabem ' + limite + '. Cortei o final.');
        t = t.slice(0, limite).trim();
      }
      return t;
    };

    const escolha = (campo, v, padrao, dono) => {
      if (v === undefined || v === null || v === '') return padrao;
      const op = typeof v === 'string' ? acharOpcao(campo, v) : null;
      if (op) return op.id;
      avisar(
        'não conheço ' + ROTULO_CAMPO[campo] + ' ' + mostrar(v) + (dono ? ' em ' + dono : '') + '. Opções: ' +
          CATALOGO[campo].map((o) => o.id).join(', ') + '. Usei ' + mostrar(padrao) + '.'
      );
      return padrao;
    };

    const apelido = texto('apelido', LIMITES.apelido);
    const historia = texto('historia', LIMITES.historia);
    const genero = escolha('genero', ficha.genero, 'ele');
    const id = ficha.id !== undefined && ficha.id !== null && ficha.id !== '' ? slug(ficha.id) : slug(nome);

    // Visual
    let visualIn = ficha.visual;
    if (visualIn !== undefined && !isObj(visualIn)) {
      avisar('visual precisa ser um grupo entre { }; usei a aparência padrão.');
      visualIn = {};
    }
    visualIn = visualIn || {};
    for (const k of Object.keys(visualIn)) {
      if (CAMPOS_VISUAL.indexOf(k) < 0) avisar('não conheço a peça ' + mostrar(k) + ' no visual; ignorei. Peças: ' + CAMPOS_VISUAL.join(', ') + '.');
    }
    const cor = (campo, v, padrao, lista) => {
      if (v === undefined || v === null || v === '') return padrao;
      const h = hex(v);
      if (h) {
        // Código igual a uma cor do catálogo vira o nome dela (a ficha fica igual na ida e na volta).
        const igual = lista === campo ? CATALOGO[lista].find((o) => o.cor === h) : null;
        return igual ? igual.id : h;
      }
      const op = typeof v === 'string' ? acharOpcao(lista, v) : null;
      if (op) return lista === campo ? op.id : op.cor;
      avisar(
        'não conheço ' + ROTULO_CAMPO[campo] + ' ' + mostrar(v) + '. Use um código como “#2F5D8A” ou uma das opções: ' +
          CATALOGO[lista].map((o) => o.id).join(', ') + '. Usei ' + mostrar(padrao) + '.'
      );
      return padrao;
    };
    // Acessório: um id ou uma lista de ids, no máximo um por lugar (cabeça, olhos, boca/orelha).
    // Guarda texto quando há 0 ou 1 ('nenhum', 'oculos') e lista quando há 2 ou mais.
    function acessorios(v) {
      if (v === undefined || v === null || v === '') return VISUAL_PADRAO.acessorio;
      if (typeof v !== 'string' && !Array.isArray(v)) {
        avisar('acessorio precisa ser um texto (“oculos”) ou uma lista ([“bone-frente”, “oculos-fino”]); usei “nenhum”.');
        return VISUAL_PADRAO.acessorio;
      }
      const out = [];
      const porLugar = {};
      for (const item of Array.isArray(v) ? v : [v]) {
        if (typeof item !== 'string' || !item.trim()) {
          if (typeof item !== 'string') avisar('na lista de acessórios, ' + mostrar(item) + ' não é um texto entre aspas; ignorei.');
          continue;
        }
        const op = acharOpcao('acessorio', item);
        if (!op) {
          avisar('não conheço o acessório ' + mostrar(item) + '. Opções: ' + CATALOGO.acessorio.map((o) => o.id).join(', ') + '. Ignorei esse.');
          continue;
        }
        if (op.id === 'nenhum' || out.indexOf(op.id) >= 0) continue;
        if (porLugar[op.lugar]) {
          const lugar = (CATALOGO.lugarAcessorio.find((l) => l.id === op.lugar) || {}).rotulo || op.lugar;
          avisar('“' + porLugar[op.lugar] + '” e “' + op.id + '” vão no mesmo lugar (' + lugar.toLowerCase() + '): cabe um por lugar. Fiquei com “' + porLugar[op.lugar] + '”.');
          continue;
        }
        porLugar[op.lugar] = op.id;
        out.push(op.id);
      }
      if (out.length > 1) {
        const ordem = CATALOGO.lugarAcessorio.map((l) => l.id);
        out.sort((a, b) => ordem.indexOf(acharOpcao('acessorio', a).lugar) - ordem.indexOf(acharOpcao('acessorio', b).lugar));
      }
      return !out.length ? 'nenhum' : out.length === 1 ? out[0] : out;
    }

    const paleta = CATALOGO.cor;
    const corPadrao = paleta[hash(id) % 9].cor; // só as cores vivas do começo da paleta
    const visual = {
      pele: cor('pele', visualIn.pele, VISUAL_PADRAO.pele, 'pele'),
      cabelo: escolha('cabelo', visualIn.cabelo, VISUAL_PADRAO.cabelo),
      corCabelo: cor('corCabelo', visualIn.corCabelo, VISUAL_PADRAO.corCabelo, 'corCabelo'),
      rosto: escolha('rosto', visualIn.rosto, VISUAL_PADRAO.rosto),
      acessorio: acessorios(visualIn.acessorio),
      roupa: escolha('roupa', visualIn.roupa, VISUAL_PADRAO.roupa),
      cor: null,
      corSecundaria: null,
      corAcessorio: null,
      marcaNoBone: escolha('marcaNoBone', visualIn.marcaNoBone, 'nenhuma'),
      brincos: false,
    };
    if (visualIn.corAcessorio !== undefined && visualIn.corAcessorio !== null && visualIn.corAcessorio !== '') {
      const c3 = cor('corAcessorio', visualIn.corAcessorio, '', 'cor');
      visual.corAcessorio = c3 ? hex(c3) || (acharOpcao('cor', c3) || {}).cor || null : null;
    }
    if (visualIn.brincos !== undefined && visualIn.brincos !== null && visualIn.brincos !== '') {
      if (typeof visualIn.brincos === 'boolean') visual.brincos = visualIn.brincos;
      else avisar('brincos precisa ser true (com brincos) ou false (sem); veio ' + mostrar(visualIn.brincos) + '. Usei false.');
    }
    const lista = Array.isArray(visual.acessorio) ? visual.acessorio : [visual.acessorio];
    if (visual.marcaNoBone !== 'nenhuma' && !lista.some((a) => a === 'bone' || a === 'bone-frente')) {
      avisar('a marca no boné só aparece com boné (acessório “bone” ou “bone-frente”).');
    }
    const c1 = cor('cor', visualIn.cor, corPadrao, 'cor');
    visual.cor = hex(c1) || (acharOpcao('cor', c1) || {}).cor || corPadrao;
    if (visualIn.corSecundaria !== undefined && visualIn.corSecundaria !== null && visualIn.corSecundaria !== '') {
      const c2 = cor('corSecundaria', visualIn.corSecundaria, '', 'cor');
      visual.corSecundaria = c2 ? hex(c2) || (acharOpcao('cor', c2) || {}).cor || null : null;
    }

    // Jeito de jogar
    let jogoIn = ficha.jogo;
    if (jogoIn !== undefined && !isObj(jogoIn)) {
      avisar('jogo precisa ser um grupo entre { }; usei o estilo equilibrado.');
      jogoIn = {};
    }
    jogoIn = jogoIn || {};
    for (const k of Object.keys(jogoIn)) {
      if (['estilo', 'blefe', 'cautela'].indexOf(k) < 0) avisar('não conheço ' + mostrar(k) + ' em jogo; ignorei. Use estilo, blefe e cautela.');
    }
    let estilo = 'equilibrado';
    if (jogoIn.estilo !== undefined && jogoIn.estilo !== null && jogoIn.estilo !== '') {
      const e = typeof jogoIn.estilo === 'string' ? chave(jogoIn.estilo) : '';
      if (hasOwn(ESTILOS, e)) estilo = e;
      else avisar('não conheço o estilo ' + mostrar(jogoIn.estilo) + '. Opções: ' + Object.keys(ESTILOS).join(', ') + '. Usei “equilibrado”.');
    }
    const numero = (campo) => {
      const base = ESTILOS[estilo][campo];
      const v = jogoIn[campo];
      if (v === undefined || v === null || v === '') return base;
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN;
      if (!Number.isFinite(n)) {
        avisar(campo + ' precisa ser um número de 0 a 10 e veio ' + mostrar(v) + '. Usei ' + base + ' (do estilo ' + estilo + ').');
        return base;
      }
      const r = Math.round(n * 10) / 10;
      if (r < 0 || r > 10) {
        const c = r < 0 ? 0 : 10;
        avisar(campo + ' precisa ser um número de 0 a 10 e veio ' + String(v).trim() + '. Usei ' + c + '.');
        return c;
      }
      return r;
    };
    const jogo = { estilo, blefe: numero('blefe'), cautela: numero('cautela') };

    // Voz
    let vozIn = ficha.voz;
    if (vozIn !== undefined && !isObj(vozIn)) {
      avisar('voz precisa ser um grupo entre { }; usei a voz padrão.');
      vozIn = {};
    }
    vozIn = vozIn || {};
    for (const k of Object.keys(vozIn)) {
      if (k !== 'tom' && k !== 'velocidade') avisar('não conheço ' + mostrar(k) + ' em voz; ignorei. Use tom e velocidade.');
    }
    const voz = { tom: escolha('tom', vozIn.tom, 'medio'), velocidade: escolha('velocidade', vozIn.velocidade, 'normal') };

    // Falas
    const listaFalas = (v, onde) => {
      const lista = typeof v === 'string' ? [v] : Array.isArray(v) ? v : null;
      if (!lista) {
        if (v !== undefined && v !== null) avisar(onde + ' precisa ser uma lista de frases entre [ ]; ignorei.');
        return [];
      }
      const out = [];
      for (const item of lista) {
        if (typeof item !== 'string') {
          avisar('em ' + onde + ', ' + mostrar(item) + ' não é uma frase entre aspas; ignorei.');
          continue;
        }
        let t = limpaTexto(item);
        if (!t) continue;
        const ruim = PROIBIDAS.find((p) => p.re.test(semAcento(t)));
        if (ruim) {
          avisar('a fala ' + mostrar(t) + ' (' + onde + ') tem “' + ruim.palavra + '”, que ' + ruim.motivo + '. Tirei essa fala.');
          continue;
        }
        if (t.length > LIMITES.fala) {
          avisar('a fala ' + mostrar(t) + ' (' + onde + ') passa de ' + LIMITES.fala + ' letras. Cortei o final.');
          t = t.slice(0, LIMITES.fala).trim();
        }
        if (out.indexOf(t) < 0) out.push(t);
      }
      if (out.length > LIMITES.falasPorMomento) {
        avisar(onde + ' tem ' + out.length + ' falas; guardei as ' + LIMITES.falasPorMomento + ' primeiras.');
        out.length = LIMITES.falasPorMomento;
      }
      return out;
    };
    const blocoFalas = (obj, onde) => {
      const out = {};
      if (obj === undefined || obj === null) return out;
      if (!isObj(obj)) {
        avisar(onde + ' precisa ser um grupo entre { }; ignorei.');
        return out;
      }
      for (const k of Object.keys(obj)) {
        if (MOMENTO_IDS.indexOf(k) < 0) {
          avisar('não conheço o momento ' + mostrar(k) + ' em ' + onde + '; ignorei. Momentos: ' + MOMENTO_IDS.join(', ') + '.');
          continue;
        }
        const l = listaFalas(obj[k], k);
        if (l.length) out[k] = l;
      }
      return out;
    };
    const falas = blocoFalas(ficha.falas, 'falas');

    // Sinais
    const sinais = Object.assign({}, SINAIS_PADRAO);
    if (ficha.sinais !== undefined && ficha.sinais !== null) {
      if (!isObj(ficha.sinais)) avisar('sinais precisa ser um grupo entre { }; usei os sinais de sempre.');
      else {
        for (const k of Object.keys(ficha.sinais)) {
          const ck = chave(k);
          const carta = CARTAS_SINAL.indexOf(ck) >= 0 ? ck : APELIDOS_CARTA[ck];
          if (!carta) {
            avisar('não conheço a carta ' + mostrar(k) + ' nos sinais; ignorei. Cartas: ' + CARTAS_SINAL.join(', ') + '.');
            continue;
          }
          const v = ficha.sinais[k];
          const g = typeof v === 'string' ? acharOpcao('gesto', v) : null;
          if (g) sinais[carta] = g.id;
          else avisar('não conheço o gesto ' + mostrar(v) + ' para ' + carta + '. Opções: ' + CATALOGO.gesto.map((o) => o.id).join(', ') + '. Usei ' + mostrar(SINAIS_PADRAO[carta]) + '.');
        }
      }
    }

    // Relações (opcional)
    const relacoes = { parceiro: null, rival: null, falasPara: {} };
    if (ficha.relacoes !== undefined && ficha.relacoes !== null) {
      if (!isObj(ficha.relacoes)) avisar('relacoes precisa ser um grupo entre { }; ignorei.');
      else {
        const r = ficha.relacoes;
        for (const k of Object.keys(r)) {
          if (['parceiro', 'rival', 'falasPara'].indexOf(k) < 0) avisar('não conheço ' + mostrar(k) + ' em relacoes; ignorei. Use parceiro, rival e falasPara.');
        }
        ['parceiro', 'rival'].forEach((k) => {
          if (r[k] === undefined || r[k] === null || r[k] === '') return;
          if (typeof r[k] !== 'string') avisar(k + ' precisa ser o nome de outro personagem entre aspas; ignorei.');
          else relacoes[k] = slug(r[k]);
        });
        if (r.falasPara !== undefined && r.falasPara !== null) {
          if (!isObj(r.falasPara)) avisar('falasPara precisa ser um grupo entre { }; ignorei.');
          else {
            for (const outro of Object.keys(r.falasPara)) {
              const b = blocoFalas(r.falasPara[outro], 'falasPara ' + outro);
              if (Object.keys(b).length) relacoes.falasPara[slug(outro)] = b;
            }
          }
        }
      }
    }

    const personagem = {
      id,
      nome,
      apelido: apelido || nome,
      historia,
      genero,
      visual,
      jogo,
      voz,
      falas,
      sinais,
      relacoes,
    };
    return { personagem, avisos: avisos.map((a) => nome + ': ' + a) };
  }

  // ------------------------------------------------------------------ registro e armazenamento

  const doJogo = [];

  /** Registra um personagem do jogo (arquivos personagens/*.js). Ids repetidos ganham sufixo. */
  function registrar(ficha) {
    const r = normalizar(ficha);
    if (!r.personagem) {
      aviso(r.avisos);
      return r;
    }
    const p = r.personagem;
    let id = p.id;
    for (let n = 2; doJogo.some((q) => q.id === id); n++) id = p.id + '-' + n;
    p.id = id;
    p.origem = 'jogo';
    doJogo.push(deepFreeze(p));
    if (r.avisos.length) aviso(r.avisos);
    return r;
  }

  function aviso(lista) {
    if (!lista || !lista.length) return;
    const c = root.console;
    if (c && typeof c.warn === 'function') c.warn('TrucAÍ — ficha de personagem:\n  ' + lista.join('\n  '));
  }

  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.keys(o).forEach((k) => deepFreeze(o[k]));
    }
    return o;
  }

  // Armazenamento: o localStorage do navegador (os testes trocam por um falso com _usarArmazenamento).
  let armazenamento;

  function storage() {
    if (armazenamento !== undefined) return armazenamento;
    try {
      return typeof root.document !== 'undefined' ? root.localStorage || null : null;
    } catch (_) {
      return null;
    }
  }

  function lerMeus() {
    try {
      const s = storage();
      const raw = s ? s.getItem(STORAGE_KEY) : null;
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(isObj) : [];
    } catch (_) {
      return [];
    }
  }

  function gravarMeus(lista) {
    try {
      const s = storage();
      if (!s) return false;
      s.setItem(STORAGE_KEY, JSON.stringify(lista));
      return true;
    } catch (_) {
      return false;
    }
  }

  function meus() {
    const out = [];
    for (const f of lerMeus()) {
      const r = normalizar(f);
      if (!r.personagem || out.some((q) => q.id === r.personagem.id)) continue;
      r.personagem.origem = 'meu';
      out.push(r.personagem);
    }
    return out;
  }

  /** Personagens do jogo + "Meus personagens" (cópias; mexer nelas não muda o registro). */
  function lista() {
    return doJogo.map(copia).concat(meus());
  }

  function buscar(id) {
    const k = typeof id === 'string' ? id : '';
    return lista().find((p) => p.id === k) || null;
  }

  function copia(p) {
    return JSON.parse(JSON.stringify(p));
  }

  /**
   * Salva (ou atualiza, pelo id) em "Meus personagens". O id não pode ser o de um personagem do jogo.
   * -> { personagem, avisos, salvo: boolean }
   */
  function salvarMeu(ficha) {
    const f = isObj(ficha) ? Object.assign({}, ficha) : ficha;
    const r = normalizar(f);
    if (!r.personagem) return { personagem: null, avisos: r.avisos, salvo: false };
    const p = r.personagem;
    let id = p.id;
    for (let n = 2; doJogo.some((q) => q.id === id); n++) id = p.id + '-' + n;
    p.id = id;
    p.origem = 'meu';
    const atuais = lerMeus().filter((q) => {
      const n = normalizar(q).personagem;
      return n && n.id !== id;
    });
    if (atuais.length >= LIMITES.meus) {
      return { personagem: p, avisos: r.avisos.concat('Já há ' + LIMITES.meus + ' personagens guardados: apague algum para salvar outro.'), salvo: false };
    }
    const guardar = paraFicha(p);
    guardar.id = id;
    atuais.push(guardar);
    const salvo = gravarMeus(atuais);
    const avisos = salvo ? r.avisos : r.avisos.concat('Não deu para guardar no navegador (modo privado ou armazenamento bloqueado).');
    return { personagem: p, avisos, salvo };
  }

  function removerMeu(id) {
    const atuais = lerMeus();
    const resto = atuais.filter((q) => {
      const n = normalizar(q).personagem;
      return n && n.id !== id;
    });
    if (resto.length === atuais.length) return false;
    return gravarMeus(resto);
  }

  // ------------------------------------------------------------------ ficha de volta (compacta)

  /** Personagem → ficha simples, só com o que difere dos padrões (sem id). */
  function paraFicha(p) {
    const f = { nome: p.nome };
    if (p.apelido && p.apelido !== p.nome) f.apelido = p.apelido;
    if (p.historia) f.historia = p.historia;
    if (p.genero && p.genero !== 'ele') f.genero = p.genero;
    const v = p.visual || {};
    const visual = {};
    const nomeCor = (campo, c) => {
      const op = CATALOGO[campo].find((o) => o.cor === c);
      return op ? op.id : c;
    };
    visual.pele = nomeCor('pele', v.pele);
    visual.cabelo = v.cabelo;
    visual.corCabelo = nomeCor('corCabelo', v.corCabelo);
    visual.rosto = v.rosto;
    visual.acessorio = Array.isArray(v.acessorio) ? v.acessorio.slice() : v.acessorio;
    visual.roupa = v.roupa;
    visual.cor = v.cor;
    if (v.corSecundaria) visual.corSecundaria = v.corSecundaria;
    if (v.corAcessorio) visual.corAcessorio = v.corAcessorio;
    if (v.marcaNoBone && v.marcaNoBone !== 'nenhuma') visual.marcaNoBone = v.marcaNoBone;
    if (v.brincos === true) visual.brincos = true;
    f.visual = visual;
    const j = p.jogo || {};
    const est = ESTILOS[j.estilo] || ESTILOS.equilibrado;
    f.jogo = { estilo: j.estilo || 'equilibrado' };
    if (j.blefe !== est.blefe) f.jogo.blefe = j.blefe;
    if (j.cautela !== est.cautela) f.jogo.cautela = j.cautela;
    f.voz = { tom: (p.voz && p.voz.tom) || 'medio', velocidade: (p.voz && p.voz.velocidade) || 'normal' };
    const falas = {};
    MOMENTO_IDS.forEach((m) => {
      if (p.falas && p.falas[m] && p.falas[m].length) falas[m] = p.falas[m].slice();
    });
    if (Object.keys(falas).length) f.falas = falas;
    const sinais = {};
    CARTAS_SINAL.forEach((c) => {
      if (p.sinais && p.sinais[c] && p.sinais[c] !== SINAIS_PADRAO[c]) sinais[c] = p.sinais[c];
    });
    if (Object.keys(sinais).length) f.sinais = sinais;
    const r = p.relacoes || {};
    const rel = {};
    if (r.parceiro) rel.parceiro = r.parceiro;
    if (r.rival) rel.rival = r.rival;
    if (r.falasPara && Object.keys(r.falasPara).length) rel.falasPara = copia(r.falasPara);
    if (Object.keys(rel).length) f.relacoes = rel;
    return f;
  }

  // ------------------------------------------------------------------ texto: paraTexto

  const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

  function aspas(s) {
    return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + "'";
  }

  function formatar(v, nivel) {
    const pad = '  '.repeat(nivel + 1);
    const fim = '  '.repeat(nivel);
    if (typeof v === 'string') return aspas(v);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (v === null || v === undefined) return 'null';
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      const itens = v.map((x) => formatar(x, nivel + 1));
      const linha = '[' + itens.join(', ') + ']';
      if (linha.length + pad.length < 76 && itens.every((i) => i.indexOf('\n') < 0)) return linha;
      return '[\n' + itens.map((i) => pad + i + ',\n').join('') + fim + ']';
    }
    const keys = Object.keys(v);
    if (!keys.length) return '{}';
    const simples = keys.every((k) => v[k] === null || typeof v[k] !== 'object');
    if (simples) {
      const linha = '{ ' + keys.map((k) => (IDENT.test(k) ? k : aspas(k)) + ': ' + formatar(v[k], nivel + 1)).join(', ') + ' }';
      if (linha.length + pad.length < 64) return linha;
    }
    return '{\n' + keys.map((k) => pad + (IDENT.test(k) ? k : aspas(k)) + ': ' + formatar(v[k], nivel + 1) + ',\n').join('') + fim + '}';
  }

  /** Ficha formatada como no guia: Truco.personagem({ ... }). Aceita personagem ou ficha. */
  function paraTexto(p) {
    const r = isObj(p) && p.visual && p.jogo && p.voz && p.sinais ? { personagem: p } : normalizar(p);
    if (!r.personagem) return '';
    return 'Truco.personagem(' + formatar(paraFicha(r.personagem), 0) + ')\n';
  }

  // ------------------------------------------------------------------ texto: deTexto (parser seguro)

  /**
   * Lê o subconjunto de JavaScript usado nas fichas: `Truco.personagem({...})` ou só `{...}`; textos
   * com aspas simples ou duplas, chaves sem aspas, vírgula final, comentários // e /* *\/, listas,
   * números, true/false/null. Não executa nada (sem eval/Function): qualquer outra coisa é erro.
   * -> { ficha, erro: null } | { ficha: null, erro: 'Linha L, coluna C: …', linha, coluna }
   */
  function deTexto(entrada) {
    if (typeof entrada !== 'string') return { ficha: null, erro: 'Cole o texto da ficha.', linha: 0, coluna: 0 };
    if (entrada.length > 60000) return { ficha: null, erro: 'A ficha é grande demais (mais de 60 mil letras).', linha: 0, coluna: 0 };
    const src = entrada.replace(/^\ufeff/, '');
    let i = 0;

    function pos(at) {
      let linha = 1;
      let coluna = 1;
      for (let k = 0; k < at && k < src.length; k++) {
        if (src[k] === '\n') {
          linha++;
          coluna = 1;
        } else coluna++;
      }
      return { linha, coluna };
    }

    function Falha(msg, at) {
      const p = pos(at === undefined ? i : at);
      this.erro = 'Linha ' + p.linha + ', coluna ' + p.coluna + ': ' + msg;
      this.linha = p.linha;
      this.coluna = p.coluna;
    }
    const falhar = (msg, at) => {
      throw new Falha(msg, at);
    };

    function trecho(at) {
      const t = src.slice(at, at + 12).split('\n')[0];
      return t ? '“' + t + (src.length > at + 12 ? '…' : '') + '”' : 'o fim do texto';
    }

    function espacos() {
      for (;;) {
        const c = src[i];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\u00a0' || c === '\ufeff') i++;
        else if (c === '/' && src[i + 1] === '/') {
          while (i < src.length && src[i] !== '\n') i++;
        } else if (c === '/' && src[i + 1] === '*') {
          const ini = i;
          const fim = src.indexOf('*/', i + 2);
          if (fim < 0) falhar('o comentário /* não foi fechado com */.', ini);
          i = fim + 2;
        } else break;
      }
    }

    function identificador() {
      const m = /^[A-Za-z_$\u00c0-\u024f][A-Za-z0-9_$\u00c0-\u024f]*/.exec(src.slice(i, i + 64));
      return m ? m[0] : null;
    }

    function texto(q) {
      const ini = i;
      i++;
      let out = '';
      for (;;) {
        if (i >= src.length) falhar('o texto que começa aqui não foi fechado com ' + q + '.', ini);
        const c = src[i];
        if (c === q) {
          i++;
          return out;
        }
        if (c === '\n') falhar('o texto que começa aqui não foi fechado com ' + q + ' antes do fim da linha.', ini);
        if (c === '\\') {
          const n = src[i + 1];
          const esc = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0', "'": "'", '"': '"', '\\': '\\', '\n': '' };
          if (n === 'u') {
            const h = src.slice(i + 2, i + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(h)) falhar('código \\u inválido no texto.');
            out += String.fromCharCode(parseInt(h, 16));
            i += 6;
            continue;
          }
          if (n === undefined) falhar('o texto terminou no meio de um \\.');
          out += hasOwn(esc, n) ? esc[n] : n;
          i += 2;
          continue;
        }
        out += c;
        i++;
      }
    }

    function numero() {
      const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(src.slice(i, i + 40));
      if (!m) falhar('esperava um número e encontrei ' + trecho(i) + '.');
      const n = Number(m[0]);
      if (!Number.isFinite(n)) falhar('número inválido: ' + m[0] + '.');
      i += m[0].length;
      return n;
    }

    function valor(nivel) {
      if (nivel > 24) falhar('a ficha tem grupos { } ou listas [ ] demais, um dentro do outro.');
      espacos();
      const c = src[i];
      if (c === '{') return objeto(nivel);
      if (c === '[') return lista(nivel);
      if (c === "'" || c === '"') return texto(c);
      if (c === '`') falhar('use aspas simples \' ou duplas " nos textos (a crase ` não vale aqui).');
      if (c !== undefined && /[-+.\d]/.test(c)) return numero();
      const id = identificador();
      if (id === 'true') {
        i += 4;
        return true;
      }
      if (id === 'false') {
        i += 5;
        return false;
      }
      if (id === 'null') {
        i += 4;
        return null;
      }
      if (c === undefined) falhar('o texto acabou antes da hora: faltou fechar alguma { ou [.');
      falhar('não entendi ' + trecho(i) + '. Aqui vai um valor: texto entre aspas, número, true/false, lista [ ] ou grupo { }.');
      return undefined;
    }

    function lista(nivel) {
      const ini = i;
      i++;
      const out = [];
      for (;;) {
        espacos();
        if (src[i] === ']') {
          i++;
          return out;
        }
        if (i >= src.length) falhar('a lista [ que começa aqui não foi fechada com ].', ini);
        out.push(valor(nivel + 1));
        espacos();
        if (src[i] === ',') {
          i++;
          continue;
        }
        if (src[i] === ']') continue;
        if (i >= src.length) falhar('a lista [ que começa aqui não foi fechada com ].', ini);
        falhar('faltou uma vírgula entre os itens da lista (ou o ] do fim) antes de ' + trecho(i) + '.');
      }
    }

    function objeto(nivel) {
      const ini = i;
      i++;
      const out = {};
      for (;;) {
        espacos();
        if (src[i] === '}') {
          i++;
          return out;
        }
        if (i >= src.length) falhar('o grupo { que começa aqui não foi fechado com }.', ini);
        const keyAt = i;
        let k;
        if (src[i] === "'" || src[i] === '"') k = texto(src[i]);
        else {
          k = identificador();
          if (!k) falhar('esperava o nome de um campo (como nome:) e encontrei ' + trecho(i) + '.');
          i += k.length;
        }
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') falhar('o campo ' + k + ' não é permitido.', keyAt);
        espacos();
        if (src[i] !== ':') falhar('faltou “:” depois de ' + k + '.');
        i++;
        out[k] = valor(nivel + 1);
        espacos();
        if (src[i] === ',') {
          i++;
          continue;
        }
        if (src[i] === '}') continue;
        if (i >= src.length) falhar('o grupo { que começa aqui não foi fechado com }.', ini);
        falhar('faltou uma vírgula depois de ' + k + ' (ou o } do fim) antes de ' + trecho(i) + '.');
      }
    }

    try {
      espacos();
      if (i >= src.length) return { ficha: null, erro: 'A ficha está vazia.', linha: 0, coluna: 0 };
      let chamada = false;
      if (src[i] !== '{') {
        const id = identificador();
        if (id === 'Truco') {
          i += 5;
          espacos();
          if (src[i] !== '.') falhar('depois de Truco vem .personagem(');
          i++;
          espacos();
          if (identificador() !== 'personagem') falhar('esperava Truco.personagem( e encontrei ' + trecho(i) + '.');
          i += 'personagem'.length;
          espacos();
        } else if (id === 'personagem') {
          i += 'personagem'.length;
          espacos();
        } else {
          falhar('a ficha começa com Truco.personagem({ ou com {. Encontrei ' + trecho(i) + '.');
        }
        if (src[i] !== '(') falhar('faltou “(” depois de Truco.personagem.');
        i++;
        chamada = true;
      }
      espacos();
      if (src[i] !== '{') falhar('a ficha precisa ser um grupo entre { }. Encontrei ' + trecho(i) + '.');
      const ficha = objeto(0);
      espacos();
      if (chamada) {
        if (src[i] !== ')') falhar('faltou o “)” que fecha Truco.personagem( — ou sobrou algo antes dele: ' + trecho(i) + '.');
        i++;
        espacos();
        if (src[i] === ';') i++;
      } else if (src[i] === ';') i++;
      espacos();
      if (i < src.length) falhar('sobrou texto depois do fim da ficha: ' + trecho(i) + '. Uma ficha por vez.');
      return { ficha, erro: null, linha: 0, coluna: 0 };
    } catch (e) {
      if (e instanceof Falha) return { ficha: null, erro: e.erro, linha: e.linha, coluna: e.coluna };
      return { ficha: null, erro: 'Não consegui ler a ficha.', linha: 0, coluna: 0 };
    }
  }

  // ------------------------------------------------------------------ para o jogo

  function garantir(p) {
    if (isObj(p) && p.visual && p.jogo && p.voz && p.sinais) return p;
    const r = normalizar(p);
    return r.personagem || normalizar({ nome: 'Jogador' }).personagem;
  }

  function corDe(campo, v) {
    const h = hex(v);
    if (h) return h;
    const op = typeof v === 'string' ? acharOpcao(campo, v) : null;
    return op && op.cor ? op.cor : null;
  }

  /** Spec do Avatars.create (docs/PERSONAGENS.md, apêndice). */
  function avatarSpec(p, seat) {
    const q = garantir(p);
    const v = q.visual;
    const shirt = corDe('cor', v.cor) || '#6c6863';
    const spec = {
      seat,
      name: q.nome,
      skin: corDe('pele', v.pele) || '#e0b48e',
      hair: corDe('corCabelo', v.corCabelo) || '#5a3a24',
      shirt,
      accent: corDe('cor', v.corSecundaria) || corSecundariaDe(shirt),
      hairStyle: v.cabelo,
      face: v.rosto,
      accessory: Array.isArray(v.acessorio) ? v.acessorio.slice() : v.acessorio,
      outfit: v.roupa,
    };
    // Campos novos só quando usados (o avatar ignora o que não conhece e usa o padrão).
    const capColor = corDe('cor', v.corAcessorio);
    if (capColor) spec.capColor = capColor;
    if (v.marcaNoBone === 'tres-quadrados') spec.capMark = 'tres-quadrados';
    if (v.brincos === true) spec.earrings = true;
    return spec;
  }

  /** Lista de acessórios do personagem (sem 'nenhum'): 'oculos' → ['oculos']; 'nenhum' → []. */
  function acessoriosDe(p) {
    const a = isObj(p) && isObj(p.visual) ? p.visual.acessorio : null;
    const l = Array.isArray(a) ? a : typeof a === 'string' ? [a] : [];
    return l.filter((x) => x && x !== 'nenhum');
  }

  /** Personalidade do Truco.AI (0..1). O marreco também erra de vez em quando (sloppy). */
  function personalidade(p) {
    const q = garantir(p);
    const out = { bluff: Math.round(q.jogo.blefe * 10) / 100, caution: Math.round(q.jogo.cautela * 10) / 100 };
    if (q.jogo.estilo === 'marreco') out.sloppy = 0.35;
    return out;
  }

  function voz(p) {
    const q = garantir(p);
    const t = CATALOGO.tom.find((o) => o.id === q.voz.tom) || CATALOGO.tom[1];
    const v = CATALOGO.velocidade.find((o) => o.id === q.voz.velocidade) || CATALOGO.velocidade[1];
    return { pitch: t.pitch, rate: v.rate };
  }

  function sortear(lista, rng) {
    const r = typeof rng === 'function' ? rng() : Math.random();
    const n = Number.isFinite(r) ? r : 0;
    return lista[Math.min(lista.length - 1, Math.max(0, Math.floor(n * lista.length)))];
  }

  /**
   * Frase da ficha para o momento, ou null (o jogo usa as falas padrão). `ctx.outros`: ids dos
   * personagens envolvidos (ex.: quem pediu o truco); falas de relacoes.falasPara para eles têm
   * prioridade, e o rival vem primeiro.
   */
  function fala(p, momento, rng, ctx) {
    if (!isObj(p) || MOMENTO_IDS.indexOf(momento) < 0) return null;
    const outros = ctx && Array.isArray(ctx.outros) ? ctx.outros.filter((x) => typeof x === 'string') : [];
    const rel = p.relacoes || {};
    if (outros.length && isObj(rel.falasPara)) {
      const ordem = rel.rival && outros.indexOf(rel.rival) >= 0 ? [rel.rival].concat(outros.filter((x) => x !== rel.rival)) : outros;
      for (const o of ordem) {
        const l = rel.falasPara[o] && rel.falasPara[o][momento];
        if (Array.isArray(l) && l.length) return sortear(l, rng);
      }
    }
    const l = p.falas && p.falas[momento];
    return Array.isArray(l) && l.length ? sortear(l, rng) : null;
  }

  function sinal(p, carta) {
    const c = CARTAS_SINAL.indexOf(carta) >= 0 ? carta : APELIDOS_CARTA[chave(carta || '')];
    if (!c) return null;
    const g = isObj(p) && isObj(p.sinais) ? p.sinais[c] : null;
    return g && CATALOGO.gesto.some((o) => o.id === g) ? g : SINAIS_PADRAO[c];
  }

  const NAIPE_CARTA = Object.freeze({ clubs: 'zap', hearts: 'copas', spades: 'espadilha', diamonds: 'picafumo' });

  /** A carta mais forte que merece sinal numa mão: 'zap' > 'copas' > 'espadilha' > 'picafumo' > 'tres'; ou null. */
  function cartaParaSinal(mao, manilhaRank) {
    if (!Array.isArray(mao)) return null;
    let melhor = -1;
    for (const c of mao) {
      if (!c || typeof c !== 'object') continue;
      let k = -1;
      if (manilhaRank && c.rank === manilhaRank && NAIPE_CARTA[c.suit]) k = CARTAS_SINAL.indexOf(NAIPE_CARTA[c.suit]);
      else if (c.rank === '3') k = 4;
      if (k >= 0 && (melhor < 0 || k < melhor)) melhor = k;
    }
    return melhor >= 0 ? CARTAS_SINAL[melhor] : null;
  }

  /** "Dona Cida piscou — tem o Zap". */
  function explicarSinal(p, carta, gesto) {
    const q = garantir(p);
    const g = CATALOGO.gesto.find((o) => o.id === (gesto || sinal(q, carta)));
    const c = CATALOGO.carta.find((o) => o.id === carta);
    if (!g || !c) return '';
    return q.nome + ' ' + g.feito + ' — tem ' + c.nome;
  }

  /** Mapeia o tipo de fala do Truco.AI (phrase) para o momento da ficha. */
  function momentoDe(kind, context) {
    const ctx = typeof context === 'number' ? { value: context } : context || {};
    const valor = { 3: 'truco', 6: 'seis', 9: 'nove', 12: 'doze' };
    switch (kind) {
      case 'call':
        return valor[ctx.value] || 'truco';
      case 'raise':
        return valor[ctx.value] || null;
      case 'accept':
        return 'aceitar';
      case 'run':
        return 'correr';
      case 'winRound':
        return 'ganhouRodada';
      case 'loseRound':
        return 'perdeuRodada';
      case 'tie':
        return 'cangou';
      case 'winHand':
        return 'ganhouMao';
      case 'loseHand':
        return 'perdeuMao';
      case 'maoDeOnzePlay':
        return 'maoDeOnzeJoga';
      case 'maoDeOnzeRun':
        return 'maoDeOnzeCorre';
      case 'idle':
        return 'pensando';
      case 'winMatch':
        return 'ganhouPartida';
      case 'loseMatch':
        return 'perdeuPartida';
      default:
        return null;
    }
  }

  // ------------------------------------------------------------------ áudio gravado das falas (docs/AUDIO.md)

  /**
   * Nome do arquivo (sem pasta nem extensão) da fala `texto` do momento: a posição dela na lista da
   * ficha, contando de 1 ('truco-2' = a 2ª frase de falas.truco). Falas de relacoes.falasPara viram
   * 'para-<id>-<momento>-<n>'. Texto que não está na ficha (fala padrão do jogo) → null.
   * O arquivo fica em audio/vozes/<id do personagem>/<chave>.mp3.
   */
  function chaveDeFala(p, momento, texto) {
    if (!isObj(p) || MOMENTO_IDS.indexOf(momento) < 0 || typeof texto !== 'string' || !texto) return null;
    const l = p.falas && p.falas[momento];
    const i = Array.isArray(l) ? l.indexOf(texto) : -1;
    if (i >= 0) return momento + '-' + (i + 1);
    const fp = p.relacoes && isObj(p.relacoes.falasPara) ? p.relacoes.falasPara : {};
    for (const outro of Object.keys(fp)) {
      const m = fp[outro] && fp[outro][momento];
      const j = Array.isArray(m) ? m.indexOf(texto) : -1;
      if (j >= 0) return 'para-' + outro + '-' + momento + '-' + (j + 1);
    }
    return null;
  }

  /** Todas as falas da ficha com o arquivo de cada uma, na ordem dos momentos (roteiro de gravação). */
  function arquivosDeFala(p) {
    const q = garantir(p);
    const out = [];
    const push = (momento, lista, prefixo, para) => {
      (lista || []).forEach((texto, i) => {
        const chave = prefixo + momento + '-' + (i + 1);
        out.push({ momento, n: i + 1, chave, para: para || null, texto, arquivo: 'audio/vozes/' + q.id + '/' + chave + '.mp3' });
      });
    };
    MOMENTO_IDS.forEach((m) => push(m, q.falas && q.falas[m], '', null));
    const fp = (q.relacoes && q.relacoes.falasPara) || {};
    Object.keys(fp).forEach((outro) => MOMENTO_IDS.forEach((m) => push(m, fp[outro][m], 'para-' + outro + '-', outro)));
    return out;
  }

  function artigo(p) {
    return isObj(p) && p.genero === 'ela' ? 'a' : 'o';
  }

  /** Nome curto para o painel: o menor entre nome e apelido ("Cida", não "Dona Cida"). */
  function nomeCurto(p) {
    if (!isObj(p)) return '';
    const a = p.apelido || p.nome;
    return a && a.length < p.nome.length ? a : p.nome;
  }

  const Personagens = {
    CATALOGO,
    ESTILOS,
    MOMENTOS,
    SUGESTOES,
    SINAIS_PADRAO,
    VISUAL_PADRAO,
    LIMITES,
    STORAGE_KEY,
    normalizar,
    registrar,
    lista,
    buscar,
    salvarMeu,
    removerMeu,
    paraFicha,
    paraTexto,
    deTexto,
    avatarSpec,
    personalidade,
    voz,
    fala,
    sinal,
    cartaParaSinal,
    explicarSinal,
    momentoDe,
    artigo,
    nomeCurto,
    slug,
    acessoriosDe,
    chaveDeFala,
    arquivosDeFala,
    // Só para os testes: esquece os personagens do jogo registrados / troca o armazenamento.
    _limparJogo() {
      doJogo.length = 0;
    },
    _usarArmazenamento(s) {
      armazenamento = s;
    },
  };

  Truco.Personagens = Personagens;
  Truco.personagem = function personagem(ficha) {
    try {
      return registrar(ficha);
    } catch (err) {
      aviso(['não deu para ler esta ficha: ' + String((err && err.message) || err)]);
      return { personagem: null, avisos: [] };
    }
  };
  if (typeof module === 'object' && module.exports) module.exports = Personagens;
})(typeof window !== 'undefined' ? window : globalThis);
