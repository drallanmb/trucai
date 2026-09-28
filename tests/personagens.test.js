// Testes de Truco.Personagens (js/core/personagens.js) e das fichas de exemplo em personagens/.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const P = require('../js/core/personagens.js');
// Mesma ordem do index.html.
const FICHAS = ['tiao', 'vini', 'bia', 'cida', 'juninho', 'rosa'];
for (const f of FICHAS) require('../personagens/' + f + '.js');

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

function withStorage(s, fn) {
  P._usarArmazenamento(s);
  try {
    return fn();
  } finally {
    P._usarArmazenamento(undefined);
  }
}

// ------------------------------------------------------------------ normalizar

test('normalizar: só o nome já dá um personagem completo com os padrões', () => {
  const { personagem: p, avisos } = P.normalizar({ nome: 'Rosa' });
  assert.deepEqual(avisos, []);
  assert.equal(p.id, 'rosa');
  assert.equal(p.nome, 'Rosa');
  assert.equal(p.apelido, 'Rosa');
  assert.equal(p.historia, '');
  assert.equal(p.genero, 'ele');
  assert.deepEqual(
    { pele: p.visual.pele, cabelo: p.visual.cabelo, corCabelo: p.visual.corCabelo, rosto: p.visual.rosto, acessorio: p.visual.acessorio, roupa: p.visual.roupa },
    P.VISUAL_PADRAO
  );
  assert.match(p.visual.cor, /^#[0-9a-f]{6}$/);
  assert.equal(p.visual.corSecundaria, null);
  assert.deepEqual(p.jogo, { estilo: 'equilibrado', blefe: 5, cautela: 5 });
  assert.deepEqual(p.voz, { tom: 'medio', velocidade: 'normal' });
  assert.deepEqual(p.falas, {});
  assert.deepEqual(p.sinais, P.SINAIS_PADRAO);
  assert.deepEqual(p.relacoes, { parceiro: null, rival: null, falasPara: {} });
  // A cor padrão é sempre a mesma para o mesmo nome.
  assert.equal(P.normalizar({ nome: 'Rosa' }).personagem.visual.cor, p.visual.cor);
});

test('normalizar: sem nome é o único caso recusado; nunca lança', () => {
  for (const f of [undefined, null, 42, 'Rosa', [], {}, { nome: '' }, { nome: '   ' }, { nome: {} }, { apelido: 'Zé' }]) {
    const r = P.normalizar(f);
    assert.equal(r.personagem, null, JSON.stringify(f));
    assert.equal(r.avisos.length, 1);
    assert.match(r.avisos[0], /nome|objeto/);
  }
  assert.equal(P.normalizar({ nome: 7 }).personagem.nome, '7');
});

test('normalizar: números viram limites com aviso claro', () => {
  const r = P.normalizar({ nome: 'Tião', jogo: { estilo: 'blefador', blefe: 15, cautela: -3 } });
  assert.deepEqual(r.personagem.jogo, { estilo: 'blefador', blefe: 10, cautela: 0 });
  assert.ok(r.avisos.includes('Tião: blefe precisa ser um número de 0 a 10 e veio 15. Usei 10.'), r.avisos.join('\n'));
  assert.ok(r.avisos.includes('Tião: cautela precisa ser um número de 0 a 10 e veio -3. Usei 0.'));
  const t = P.normalizar({ nome: 'Tião', jogo: { estilo: 'cauteloso', blefe: 'muito', cautela: '7,5' } });
  assert.equal(t.personagem.jogo.blefe, 2); // do estilo
  assert.equal(t.personagem.jogo.cautela, 7.5);
  assert.match(t.avisos[0], /blefe precisa ser um número de 0 a 10 e veio “muito”\. Usei 2 \(do estilo cauteloso\)\./);
  // Sem ajuste, valem os números do estilo.
  assert.deepEqual(P.normalizar({ nome: 'A', jogo: { estilo: 'marreco' } }).personagem.jogo, { estilo: 'marreco', blefe: 4, cautela: 2 });
});

test('normalizar: opção desconhecida vira o padrão, com a lista de opções', () => {
  const r = P.normalizar({ nome: 'Rosa', visual: { cabelo: 'moicano', roupa: 'terno' }, voz: { tom: 'fininho' }, jogo: { estilo: 'maluco' }, genero: 'x' });
  assert.equal(r.personagem.visual.cabelo, 'curto');
  assert.equal(r.personagem.visual.roupa, 'camisa-lisa');
  assert.equal(r.personagem.voz.tom, 'medio');
  assert.equal(r.personagem.jogo.estilo, 'equilibrado');
  assert.equal(r.personagem.genero, 'ele');
  assert.ok(r.avisos.includes('Rosa: não conheço o cabelo “moicano”. Opções: careca, curto, topete, coque, comprido, rabo-de-cavalo, black, laterais. Usei “curto”.'), r.avisos.join('\n'));
  assert.ok(r.avisos.some((a) => /o estilo “maluco”\. Opções: blefador, cauteloso, equilibrado, marreco/.test(a)));
  assert.ok(r.avisos.some((a) => /o tom de voz “fininho”/.test(a)));
  assert.ok(r.avisos.some((a) => /o gênero “x”/.test(a)));
});

test('normalizar: tolerante com acento, maiúscula e espaço; cores por nome ou código', () => {
  const r = P.normalizar({
    Nome: 'Zé',
    História: 'Oi.',
    visual: { Pele: 'Morena Clara', cabelo: 'CARECA', corCabelo: '#abc', acessório: 'Chapéu-panamá', cor: 'Vinho', corSecundaria: '#FFF' },
    voz: { tom: 'Grave', velocidade: 'rápido' },
  });
  assert.deepEqual(r.avisos, []);
  const v = r.personagem.visual;
  assert.equal(r.personagem.historia, 'Oi.');
  assert.equal(v.pele, 'morena-clara');
  assert.equal(v.cabelo, 'careca');
  assert.equal(v.corCabelo, '#aabbcc');
  assert.equal(v.acessorio, 'chapeu-panama');
  assert.equal(v.cor, '#6b2433');
  assert.equal(v.corSecundaria, '#ffffff');
  assert.deepEqual(r.personagem.voz, { tom: 'grave', velocidade: 'rapido' });
  // Código igual a uma cor do catálogo vira o nome dela.
  assert.equal(P.normalizar({ nome: 'A', visual: { pele: '#B5835A' } }).personagem.visual.pele, 'morena');
  const bad = P.normalizar({ nome: 'A', visual: { cor: 'furta-cor' } });
  assert.match(bad.avisos[0], /não conheço a cor “furta-cor”\. Use um código como “#2F5D8A”/);
});

test('normalizar: limites de tamanho cortam com aviso; campos desconhecidos são avisados', () => {
  const r = P.normalizar({ nome: 'Maria Aparecida dos Santos', apelido: 'x'.repeat(30), historia: 'y'.repeat(260), vizual: {} });
  assert.equal(r.personagem.nome, 'Maria Aparecida');
  assert.equal(r.personagem.nome.length <= P.LIMITES.nome, true);
  assert.equal(r.personagem.apelido.length, P.LIMITES.apelido);
  assert.equal(r.personagem.historia.length, P.LIMITES.historia);
  assert.ok(r.avisos.some((a) => /o nome tem 26 letras; cabem 16/.test(a)));
  assert.ok(r.avisos.some((a) => /não conheço o campo “vizual”/.test(a)));
});

test('normalizar: falas proibidas viram aviso e saem; texto solto vira lista; momentos desconhecidos avisam', () => {
  const r = P.normalizar({
    nome: 'Rosa',
    falas: {
      truco: ['Troco!', 'Truco!', 'TRUCA, ladrão', 'Ô Jorge!'],
      aceitar: 'Cai!',
      correr: ['Mata que eu corro', 'Deixa pra mim', 'Deixa comigo', 'Corro.', 42],
      xingar: ['...'],
    },
  });
  assert.deepEqual(r.personagem.falas.truco, ['Truco!']);
  assert.deepEqual(r.personagem.falas.aceitar, ['Cai!']);
  assert.deepEqual(r.personagem.falas.correr, ['Corro.']);
  assert.equal(r.personagem.falas.xingar, undefined);
  const txt = r.avisos.join('\n');
  for (const w of ['Troco', 'Truca', 'Jorge', 'Mata', 'Deixa pra mim', 'Deixa comigo']) assert.ok(txt.includes('“' + w + '”'), w);
  assert.match(txt, /a fala “Troco!” \(truco\) tem “Troco”, que soa como pedido de truco\. Tirei essa fala\./);
  assert.match(txt, /não conheço o momento “xingar”/);
  assert.match(txt, /42 não é uma frase/);
  // As sugestões da tela passam pelo filtro.
  const all = Object.values(P.SUGESTOES).flat();
  const s = P.normalizar({ nome: 'S', falas: Object.fromEntries(Object.entries(P.SUGESTOES)) });
  assert.deepEqual(s.avisos, []);
  assert.equal(Object.values(s.personagem.falas).flat().length, all.length);
});

test('normalizar: sinais e relações', () => {
  const r = P.normalizar({
    nome: 'Rosa',
    sinais: { zap: 'coçar-nariz', 'Pica-fumo': 'Piscar', 3: 'encher-bochechas', rei: 'piscar', copas: 'dançar' },
    relacoes: { parceiro: 'Dona Cida', rival: 'tiao', falasPara: { Tião: { aceitar: ['Vem, Tião!'], nada: ['x'] } }, amigo: 'x' },
  });
  const p = r.personagem;
  assert.equal(p.sinais.zap, 'cocar-nariz');
  assert.equal(p.sinais.picafumo, 'piscar');
  assert.equal(p.sinais.tres, 'encher-bochechas');
  assert.equal(p.sinais.copas, 'levantar-sobrancelha');
  assert.deepEqual(p.relacoes, { parceiro: 'dona-cida', rival: 'tiao', falasPara: { tiao: { aceitar: ['Vem, Tião!'] } } });
  const txt = r.avisos.join('\n');
  assert.match(txt, /não conheço a carta “rei” nos sinais/);
  assert.match(txt, /não conheço o gesto “dançar” para copas/);
  assert.match(txt, /não conheço o momento “nada” em falasPara Tião/);
  assert.match(txt, /não conheço “amigo” em relacoes/);
});

// ------------------------------------------------------------------ fichas de exemplo

test('fichas de exemplo: Tião, Vini, Bia, Dona Cida, Juninho e Rosa registrados, sem avisos', () => {
  const ids = P.lista().map((p) => p.id);
  assert.deepEqual(ids, ['tiao', 'vini', 'bia', 'dona-cida', 'juninho', 'rosa']);
  for (const f of FICHAS) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'personagens', f + '.js'), 'utf8');
    assert.match(src.split('\n')[0], /^\/\/ Exemplo do modelo de ficha/, f);
    const parsed = P.deTexto(src);
    assert.equal(parsed.erro, null, f + ': ' + parsed.erro);
    assert.deepEqual(P.normalizar(parsed.ficha).avisos, [], f);
  }
  const tiao = P.buscar('tiao');
  assert.deepEqual(P.personalidade(tiao), { bluff: 0.72, caution: 0.35 });
  assert.deepEqual(P.personalidade(P.buscar('dona-cida')), { bluff: 0.3, caution: 0.62 });
  assert.deepEqual(P.personalidade(P.buscar('juninho')), { bluff: 0.55, caution: 0.28, sloppy: 0.35 });
  assert.equal(P.buscar('dona-cida').genero, 'ela');
  assert.equal(P.nomeCurto(P.buscar('dona-cida')), 'Cida');
  assert.equal(P.nomeCurto(tiao), 'Tião');
  assert.equal(P.artigo(P.buscar('dona-cida')), 'a');
  assert.equal(P.artigo(tiao), 'o');
  // Mexer na cópia devolvida não muda o registro.
  tiao.nome = 'Outro';
  assert.equal(P.buscar('tiao').nome, 'Tião');
});

test('registrar: id repetido ganha sufixo; ficha sem nome não entra', () => {
  const before = P.lista().length;
  try {
    const a = P.registrar({ nome: 'Rosa', genero: 'ela' });
    assert.equal(a.personagem.id, 'rosa-2');
    assert.equal(Truco.personagem({ historia: 'sem nome' }).personagem, null);
    assert.equal(P.lista().length, before + 1);
  } finally {
    P._limparJogo();
    for (const f of FICHAS) {
      delete require.cache[require.resolve('../personagens/' + f + '.js')];
      require('../personagens/' + f + '.js');
    }
  }
  assert.equal(P.lista().length, before);
});

// ------------------------------------------------------------------ texto

test('deTexto: formatos válidos do guia', () => {
  const ok = (t) => {
    const r = P.deTexto(t);
    assert.equal(r.erro, null, t + ' → ' + r.erro);
    return r.ficha;
  };
  assert.deepEqual(ok("Truco.personagem({ nome: 'Rosa' })"), { nome: 'Rosa' });
  assert.deepEqual(ok('{ "nome": "Rosa" }'), { nome: 'Rosa' });
  assert.deepEqual(ok("Truco.personagem({ nome: 'Rosa', });"), { nome: 'Rosa' });
  assert.deepEqual(
    ok(`// ficha da Rosa
      /* comentário
         de várias linhas */
      Truco.personagem({
        nome: 'Rosa', // o nome
        jogo: { estilo: "cauteloso", blefe: 2.5, cautela: -1, },
        falas: { truco: ['Truco!', "D'água", 'Ele disse "oi"', 'a\\'b\\n', ], },
        ativo: true, outro: false, nada: null, lista: [1, [2, 3], {x: 1}],
        'com-hifen': 1,
      })
    `),
    {
      nome: 'Rosa',
      jogo: { estilo: 'cauteloso', blefe: 2.5, cautela: -1 },
      falas: { truco: ['Truco!', "D'água", 'Ele disse "oi"', "a'b\n"] },
      ativo: true, outro: false, nada: null, lista: [1, [2, 3], { x: 1 }],
      'com-hifen': 1,
    }
  );
  assert.deepEqual(ok('﻿{nome:"Zé"}'), { nome: 'Zé' });
});

test('deTexto: erros em português com linha e coluna', () => {
  const err = (t) => {
    const r = P.deTexto(t);
    assert.equal(r.ficha, null, t);
    assert.equal(typeof r.erro, 'string');
    return r;
  };
  let r = err("Truco.personagem({\n  nome: 'Rosa'\n  apelido: 'R',\n})");
  assert.equal(r.linha, 3);
  assert.equal(r.coluna, 3);
  assert.match(r.erro, /^Linha 3, coluna 3: faltou uma vírgula depois de nome/);
  r = err("{ nome: 'Rosa }");
  assert.match(r.erro, /^Linha 1, coluna 9: o texto que começa aqui não foi fechado com '/);
  r = err('{ nome: "Rosa", visual: { cabelo: "curto" }');
  assert.match(r.erro, /não foi fechado com \}/);
  r = err('{ nome "Rosa" }');
  assert.match(r.erro, /faltou “:” depois de nome/);
  assert.match(err('').erro, /vazia/);
  assert.match(err('Rosa').erro, /começa com Truco\.personagem\(\{ ou com \{/);
  assert.match(err("Truco.personagem({ nome: 'Rosa' }").erro, /faltou o “\)”/);
  assert.match(err("{ nome: 'A' } { nome: 'B' }").erro, /sobrou texto depois do fim da ficha/);
  assert.match(err('{ nome: `Rosa` }').erro, /crase/);
  assert.match(err('{ nome: /* sem fim').erro, /comentário \/\* não foi fechado/);
  assert.match(err('{ __proto__: { x: 1 } }').erro, /não é permitido/);
  assert.equal(P.deTexto(null).ficha, null);
});

test('deTexto: não executa código (nada de eval/Function)', () => {
  delete globalThis.x;
  for (const t of [
    '{ nome: (()=>{globalThis.x=1})() }',
    "Truco.personagem({ nome: 'a' + (globalThis.x = 1) })",
    '{ nome: globalThis.x = 1 }',
    "(globalThis.x = 1, { nome: 'a' })",
    "Truco.personagem((globalThis.x = 1) && { nome: 'a' })",
    '{ nome: `${globalThis.x = 1}` }',
    '{ get nome() { globalThis.x = 1; return "a" } }',
    "{ nome: 'a' }; globalThis.x = 1",
    "{ nome: 'a', toString: function () { globalThis.x = 1 } }",
  ]) {
    const r = P.deTexto(t);
    assert.equal(r.ficha, null, t);
    assert.match(r.erro, /^Linha \d+, coluna \d+: /, t);
  }
  assert.equal(globalThis.x, undefined);
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'core', 'personagens.js'), 'utf8');
  assert.doesNotMatch(src, /\beval\s*\(|new\s+Function|\bFunction\s*\(/);
});

test('paraTexto ↔ deTexto: ida e volta dá o mesmo personagem', () => {
  const fichas = P.lista().concat([
    P.normalizar({
      nome: "Zé D'Ávila",
      apelido: 'Zé "Pé Frio"',
      genero: 'ela',
      historia: 'Linha com \\ barra e \'aspas\'.',
      visual: { cor: '#123456', corSecundaria: '#abcdef', pele: '#101010' },
      jogo: { estilo: 'marreco', blefe: 9.9 },
      falas: { truco: ['Truco!', 'É agora, hein?'], perdeuPartida: ['Amanhã tem revanche.'] },
      sinais: { tres: 'piscar' },
      relacoes: { rival: 'tiao', falasPara: { tiao: { aceitar: ['Vem!'] }, 'dona-cida': { correr: ['Tchau!'] } } },
    }).personagem,
  ]);
  for (const p of fichas) {
    const text = P.paraTexto(p);
    assert.match(text, /^Truco\.personagem\(\{\n/);
    const back = P.deTexto(text);
    assert.equal(back.erro, null, text);
    const again = P.normalizar(back.ficha);
    assert.deepEqual(again.avisos, [], text);
    const strip = (x) => Object.assign({}, x, { origem: undefined });
    assert.deepEqual(strip(again.personagem), strip(Object.assign({}, p, { id: P.slug(p.nome) })), p.nome);
  }
  // A ficha mínima continua curta, sem padrões desnecessários.
  const rosa = P.paraTexto(P.buscar('rosa'));
  assert.doesNotMatch(rosa, /falas|sinais|relacoes|apelido|blefe/);
  assert.equal(P.paraTexto({}), '');
});

// ------------------------------------------------------------------ para o jogo

test('avatarSpec, personalidade e voz', () => {
  const tiao = P.buscar('tiao');
  assert.deepEqual(P.avatarSpec(tiao, 1), {
    seat: 1, name: 'Tião', skin: '#b5835a', hair: '#8a8580', shirt: '#2f5d8a', accent: P.avatarSpec(tiao, 1).accent,
    hairStyle: 'careca', face: 'bigodao', accessory: 'nenhum', outfit: 'camisa-listrada',
  });
  assert.match(P.avatarSpec(tiao, 1).accent, /^#[0-9a-f]{6}$/);
  const s = P.avatarSpec({ nome: 'X', visual: { corSecundaria: '#00ff00', cabelo: 'black' } }, 3);
  assert.equal(s.seat, 3);
  assert.equal(s.accent, '#00ff00');
  assert.equal(s.hairStyle, 'black');
  assert.deepEqual(P.voz(tiao), { pitch: 0.78, rate: 1 });
  assert.deepEqual(P.voz(P.buscar('dona-cida')), { pitch: 1.22, rate: 1.12 });
  assert.deepEqual(P.voz({ nome: 'Y', voz: { tom: 'agudo', velocidade: 'devagar' } }), { pitch: 1.22, rate: 0.9 });
  assert.deepEqual(P.personalidade({ nome: 'Y', jogo: { blefe: 10, cautela: 0 } }), { bluff: 1, caution: 0 });
  // Nunca lança, mesmo com lixo.
  assert.equal(P.avatarSpec(null, 1).name, 'Jogador');
});

test('fala: sorteia da ficha, prioriza falasPara (rival primeiro) e devolve null sem fala', () => {
  const tiao = P.buscar('tiao');
  const seq = (...v) => {
    let i = 0;
    return () => v[i++ % v.length];
  };
  assert.equal(P.fala(tiao, 'truco', seq(0)), 'Truco, ladrão!');
  assert.equal(P.fala(tiao, 'truco', seq(0.99)), 'Truco! Quero ver ter peito.');
  assert.equal(P.fala(tiao, 'doze', seq(0)), null); // sem fala própria: o jogo usa a padrão
  assert.equal(P.fala(tiao, 'nao-existe', seq(0)), null);
  assert.equal(P.fala(null, 'truco'), null);
  // Relação: aceitar um pedido da Dona Cida.
  assert.equal(P.fala(tiao, 'aceitar', seq(0), { outros: ['dona-cida'] }), 'Pode vir, Dona Cida!');
  assert.equal(P.fala(tiao, 'aceitar', seq(0), { outros: ['juninho'] }), 'Cai!');
  const rival = P.normalizar({
    nome: 'R',
    falas: { aceitar: ['geral'] },
    relacoes: { rival: 'b', falasPara: { a: { aceitar: ['para A'] }, b: { aceitar: ['para B'] } } },
  }).personagem;
  assert.equal(P.fala(rival, 'aceitar', seq(0), { outros: ['a', 'b'] }), 'para B');
  assert.equal(P.fala(rival, 'aceitar', seq(0), { outros: ['a'] }), 'para A');
  assert.equal(P.fala(rival, 'aceitar', seq(0), { outros: ['c'] }), 'geral');
  // Tipos da IA → momentos.
  assert.equal(P.momentoDe('call', 3), 'truco');
  assert.equal(P.momentoDe('raise', { value: 9 }), 'nove');
  assert.equal(P.momentoDe('winMatch'), 'ganhouPartida');
  assert.equal(P.momentoDe('idle'), 'pensando');
  assert.equal(P.momentoDe('faceDown'), null);
});

test('sinal: gesto da ficha ou o padrão; carta mais forte da mão', () => {
  const cida = P.buscar('dona-cida');
  assert.equal(P.sinal(cida, 'zap'), 'piscar');
  assert.equal(P.sinal(cida, 'tres'), 'cocar-nariz');
  assert.equal(P.sinal(cida, 'espadilha'), 'bochecha-com-lingua');
  assert.equal(P.sinal(P.buscar('juninho'), 'zap'), 'encher-bochechas');
  assert.equal(P.sinal(null, 'copas'), 'levantar-sobrancelha');
  assert.equal(P.sinal(cida, 'pica-fumo'), 'ponta-da-lingua');
  assert.equal(P.sinal(cida, 'rei'), null);
  const c = (rank, suit) => ({ id: rank + suit[0], rank, suit });
  assert.equal(P.cartaParaSinal([c('K', 'hearts'), c('3', 'spades'), c('Q', 'diamonds')], 'Q'), 'picafumo');
  assert.equal(P.cartaParaSinal([c('Q', 'spades'), c('Q', 'clubs')], 'Q'), 'zap');
  assert.equal(P.cartaParaSinal([c('Q', 'hearts'), c('3', 'clubs')], 'Q'), 'copas');
  assert.equal(P.cartaParaSinal([c('3', 'clubs'), c('A', 'hearts')], 'Q'), 'tres');
  assert.equal(P.cartaParaSinal([c('3', 'diamonds')], '3'), 'picafumo'); // vira 2: o 3 é manilha
  assert.equal(P.cartaParaSinal([c('2', 'clubs'), c('A', 'hearts')], 'Q'), null);
  assert.equal(P.cartaParaSinal([{ hidden: true }], 'Q'), null);
  assert.equal(P.cartaParaSinal(null, 'Q'), null);
  assert.equal(P.explicarSinal(cida, 'zap'), 'Dona Cida piscou — tem o Zap');
  assert.equal(P.explicarSinal(cida, 'tres'), 'Dona Cida coçou o nariz — tem um 3');
});

// ------------------------------------------------------------------ armazenamento

test('Meus personagens: salvar, listar, atualizar pelo id e remover', () => {
  const s = memoryStorage();
  withStorage(s, () => {
    assert.deepEqual(P.lista().filter((p) => p.origem === 'meu'), []);
    const a = P.salvarMeu({ nome: 'Zé', jogo: { blefe: 20 } });
    assert.equal(a.salvo, true);
    assert.equal(a.personagem.id, 'ze');
    assert.ok(a.avisos.some((t) => /Usei 10/.test(t)));
    assert.equal(JSON.parse(s.getItem(P.STORAGE_KEY)).length, 1);
    // Nome de um personagem do jogo: id com sufixo, sem esconder o original.
    const t = P.salvarMeu({ nome: 'Tião', historia: 'o meu' });
    assert.equal(t.personagem.id, 'tiao-2');
    assert.equal(P.buscar('tiao').historia.indexOf('Aposentado'), 0);
    // Atualiza pelo id (mesmo trocando o nome).
    const b = P.salvarMeu({ id: 'ze', nome: 'Zé Grande' });
    assert.equal(b.personagem.id, 'ze');
    const meus = P.lista().filter((p) => p.origem === 'meu');
    assert.deepEqual(meus.map((p) => [p.id, p.nome]), [['tiao-2', 'Tião'], ['ze', 'Zé Grande']]);
    assert.equal(P.salvarMeu({ historia: 'sem nome' }).salvo, false);
    assert.equal(P.removerMeu('ze'), true);
    assert.equal(P.removerMeu('ze'), false);
    assert.deepEqual(P.lista().filter((p) => p.origem === 'meu').map((p) => p.id), ['tiao-2']);
    // Lixo no armazenamento é ignorado.
    s.setItem(P.STORAGE_KEY, '{quebrado');
    assert.equal(P.lista().filter((p) => p.origem === 'meu').length, 0);
    s.setItem(P.STORAGE_KEY, JSON.stringify([null, 3, { historia: 'sem nome' }, { nome: 'Ok' }]));
    assert.deepEqual(P.lista().filter((p) => p.origem === 'meu').map((p) => p.id), ['ok']);
  });
});

test('Meus personagens: localStorage que lança não quebra nada', () => {
  const boom = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceeded');
    },
    removeItem() {
      throw new Error('x');
    },
  };
  withStorage(boom, () => {
    assert.deepEqual(P.lista().map((p) => p.id), ['tiao', 'vini', 'bia', 'dona-cida', 'juninho', 'rosa']);
    const r = P.salvarMeu({ nome: 'Zé' });
    assert.equal(r.salvo, false);
    assert.equal(r.personagem.nome, 'Zé');
    assert.match(r.avisos[r.avisos.length - 1], /Não deu para guardar no navegador/);
    assert.equal(P.removerMeu('ze'), false);
  });
  // Sem armazenamento nenhum (Node puro).
  withStorage(null, () => {
    assert.equal(P.lista().length, FICHAS.length);
    assert.equal(P.salvarMeu({ nome: 'Zé' }).salvo, false);
  });
});

// ------------------------------------------------------------------ acessórios em lista, boné e brincos

test('acessorio: texto ou lista, um por lugar, na ordem cabeça → olhos → boca/orelha', () => {
  const um = P.normalizar({ nome: 'A', visual: { acessorio: 'oculos-fino' } });
  assert.deepEqual(um.avisos, []);
  assert.equal(um.personagem.visual.acessorio, 'oculos-fino');
  const lista = P.normalizar({ nome: 'B', visual: { acessorio: ['Óculos fininho', 'bone-frente', 'palito-na-boca', 'bone-frente', 'nenhum'] } });
  assert.deepEqual(lista.avisos, []);
  assert.deepEqual(lista.personagem.visual.acessorio, ['bone-frente', 'oculos-fino', 'palito-na-boca']);
  // Lista com um só vira texto; lista vazia vira 'nenhum'.
  assert.equal(P.normalizar({ nome: 'C', visual: { acessorio: ['bone'] } }).personagem.visual.acessorio, 'bone');
  assert.equal(P.normalizar({ nome: 'D', visual: { acessorio: [] } }).personagem.visual.acessorio, 'nenhum');
  // Dois no mesmo lugar: fica o primeiro, com aviso; desconhecido e não-texto saem com aviso.
  const r = P.normalizar({ nome: 'E', visual: { acessorio: ['bone', 'chapeu-panama', 'oculos', 'oculos-fino', 'coroa', 7, 'lapis-na-orelha', 'palito-na-boca'] } });
  assert.deepEqual(r.personagem.visual.acessorio, ['bone', 'oculos', 'lapis-na-orelha']);
  assert.ok(r.avisos.some((a) => /“bone” e “chapeu-panama” vão no mesmo lugar \(cabeça\)/.test(a)), r.avisos.join('\n'));
  assert.ok(r.avisos.some((a) => /“oculos” e “oculos-fino” vão no mesmo lugar \(olhos\)/.test(a)));
  assert.ok(r.avisos.some((a) => /“lapis-na-orelha” e “palito-na-boca” vão no mesmo lugar \(boca ou orelha\)/.test(a)));
  assert.ok(r.avisos.some((a) => /não conheço o acessório “coroa”/.test(a)));
  assert.ok(r.avisos.some((a) => /7 não é um texto/.test(a)));
  const ruim = P.normalizar({ nome: 'F', visual: { acessorio: { a: 1 } } });
  assert.equal(ruim.personagem.visual.acessorio, 'nenhum');
  assert.equal(ruim.avisos.length, 1);
  // Catálogo: rótulos novos e lugar de cada acessório.
  const acc = (id) => P.CATALOGO.acessorio.find((o) => o.id === id);
  assert.equal(acc('bone-frente').rotulo, 'Boné (aba pra frente)');
  assert.equal(acc('oculos-fino').rotulo, 'Óculos fininho');
  assert.deepEqual(P.CATALOGO.lugarAcessorio.map((l) => l.id), ['cabeca', 'olhos', 'boca-orelha']);
  for (const o of P.CATALOGO.acessorio) if (o.id !== 'nenhum') assert.ok(P.CATALOGO.lugarAcessorio.some((l) => l.id === o.lugar), o.id);
  assert.deepEqual(P.acessoriosDe(lista.personagem), ['bone-frente', 'oculos-fino', 'palito-na-boca']);
  assert.deepEqual(P.acessoriosDe(P.buscar('tiao')), []);
});

test('corAcessorio, marcaNoBone e brincos: normalizar, avisos, avatarSpec e ida e volta', () => {
  const r = P.normalizar({
    nome: 'Gi',
    visual: { acessorio: ['bone-frente', 'oculos-fino'], corAcessorio: 'preto', marcaNoBone: 'Tres Quadrados', brincos: true, cabelo: 'Rabo de cavalo' },
  });
  assert.deepEqual(r.avisos, []);
  const v = r.personagem.visual;
  assert.equal(v.corAcessorio, '#2a2522');
  assert.equal(v.marcaNoBone, 'tres-quadrados');
  assert.equal(v.brincos, true);
  assert.equal(v.cabelo, 'rabo-de-cavalo');
  const spec = P.avatarSpec(r.personagem, 2);
  assert.deepEqual(spec.accessory, ['bone-frente', 'oculos-fino']);
  assert.equal(spec.capColor, '#2a2522');
  assert.equal(spec.capMark, 'tres-quadrados');
  assert.equal(spec.earrings, true);
  assert.equal(spec.hairStyle, 'rabo-de-cavalo');
  // Sem os campos novos, o spec não ganha chaves novas (o avatar usa o padrão).
  const simples = P.avatarSpec(P.normalizar({ nome: 'H' }).personagem, 1);
  assert.ok(!('capColor' in simples) && !('capMark' in simples) && !('earrings' in simples));
  // Padrões e avisos.
  const pad = P.normalizar({ nome: 'I' }).personagem.visual;
  assert.equal(pad.corAcessorio, null);
  assert.equal(pad.marcaNoBone, 'nenhuma');
  assert.equal(pad.brincos, false);
  const ruim = P.normalizar({ nome: 'J', visual: { marcaNoBone: 'estrela', brincos: 'sim', corAcessorio: 'furta-cor' } });
  assert.ok(ruim.avisos.some((a) => /não conheço a marca no boné “estrela”/.test(a)), ruim.avisos.join('\n'));
  assert.ok(ruim.avisos.some((a) => /brincos precisa ser true/.test(a)));
  assert.ok(ruim.avisos.some((a) => /não conheço a cor do boné\/chapéu “furta-cor”/.test(a)));
  const semBone = P.normalizar({ nome: 'K', visual: { acessorio: 'oculos', marcaNoBone: 'tres-quadrados' } });
  assert.ok(semBone.avisos.some((a) => /a marca no boné só aparece com boné/.test(a)));
  // Ida e volta pelo texto da ficha.
  const texto = P.paraTexto(r.personagem);
  assert.match(texto, /acessorio: \['bone-frente', 'oculos-fino'\]/);
  assert.match(texto, /marcaNoBone: 'tres-quadrados'/);
  assert.match(texto, /brincos: true/);
  const volta = P.normalizar(P.deTexto(texto).ficha);
  assert.deepEqual(volta.avisos, []);
  assert.deepEqual(volta.personagem.visual, r.personagem.visual);
  assert.doesNotMatch(P.paraTexto(P.buscar('tiao')), /marcaNoBone|brincos|corAcessorio/);
});

test('Vini e Bia: fichas completas, jovens, sem avisos e com falas dentro das regras', () => {
  const vini = P.buscar('vini');
  const bia = P.buscar('bia');
  assert.equal(vini.nome, 'Vini');
  assert.equal(vini.genero, 'ele');
  assert.deepEqual(vini.visual.acessorio, ['bone-frente', 'oculos-fino']);
  assert.equal(vini.visual.marcaNoBone, 'tres-quadrados');
  assert.equal(vini.visual.rosto, 'barba');
  assert.equal(vini.visual.pele, 'clara');
  const sv = P.avatarSpec(vini, 2);
  assert.equal(sv.capMark, 'tres-quadrados');
  assert.match(sv.capColor, /^#[0-9a-f]{6}$/);
  assert.equal(bia.genero, 'ela');
  assert.equal(bia.visual.cabelo, 'rabo-de-cavalo');
  assert.equal(bia.visual.brincos, true);
  assert.equal(P.avatarSpec(bia, 3).earrings, true);
  const proibidas = /\b(troco|truca|jorge|mata|deixa (pra|para) mim|deixa comigo|porra|caralho|merda|puta)\b/i;
  for (const p of [vini, bia]) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'personagens', p.id + '.js'), 'utf8');
    assert.deepEqual(P.normalizar(P.deTexto(src).ficha).avisos, [], p.id);
    const momentos = P.MOMENTOS.map((m) => m.id);
    for (const m of momentos) {
      const l = p.falas[m] || [];
      assert.ok(l.length >= (m.startsWith('maoDeOnze') ? 2 : 3) && l.length <= 5, p.id + '.' + m + ': ' + l.length + ' falas');
    }
    const todas = [];
    momentos.forEach((m) => todas.push(...(p.falas[m] || [])));
    Object.values(p.relacoes.falasPara).forEach((b) => Object.values(b).forEach((l) => todas.push(...l)));
    for (const t of todas) {
      assert.ok(t.length <= 40, p.id + ': “' + t + '” tem ' + t.length + ' letras');
      assert.doesNotMatch(t.normalize('NFD').replace(/[̀-ͯ]/g, ''), proibidas, t);
    }
    // Sinais só com gestos do catálogo.
    for (const g of Object.values(p.sinais)) assert.ok(P.CATALOGO.gesto.some((o) => o.id === g), g);
  }
  // O Vini fala de programação sem forçar: algumas falas-chave do pedido.
  assert.ok(vini.falas.truco.includes('Truco! Deploy em produção!'));
  assert.ok(vini.falas.aceitar.includes('Cai, tá testado.'));
  assert.ok(vini.falas.correr.includes('Corro... deu bug.'));
});

test('chaveDeFala e arquivosDeFala: posição da frase na ficha → nome do arquivo', () => {
  const vini = P.buscar('vini');
  assert.equal(P.chaveDeFala(vini, 'truco', vini.falas.truco[0]), 'truco-1');
  assert.equal(P.chaveDeFala(vini, 'truco', vini.falas.truco[1]), 'truco-2');
  assert.equal(P.chaveDeFala(vini, 'maoDeOnzeJoga', 'Vamos nessa, Seu Tião!'), 'para-tiao-maoDeOnzeJoga-2');
  assert.equal(P.chaveDeFala(vini, 'truco', 'fala que não está na ficha'), null);
  assert.equal(P.chaveDeFala(vini, 'nao-existe', 'Truco!'), null);
  assert.equal(P.chaveDeFala(null, 'truco', 'Truco!'), null);
  // Toda fala sorteada tem arquivo.
  for (let i = 0; i < 20; i++) {
    const r = i / 20;
    const t = P.fala(vini, 'correr', () => r);
    assert.match(P.chaveDeFala(vini, 'correr', t), /^correr-[1-4]$/);
  }
  const lista = P.arquivosDeFala(vini);
  const fp = Object.values(vini.relacoes.falasPara).reduce((n, b) => n + Object.values(b).reduce((m, l) => m + l.length, 0), 0);
  assert.equal(fp, 4);
  const total = Object.values(vini.falas).reduce((n, l) => n + l.length, 0) + fp;
  assert.equal(lista.length, total);
  assert.deepEqual(lista[0], { momento: 'truco', n: 1, chave: 'truco-1', para: null, texto: vini.falas.truco[0], arquivo: 'audio/vozes/vini/truco-1.mp3' });
  assert.ok(lista.some((f) => f.arquivo === 'audio/vozes/vini/para-bia-maoDeOnzeCorre-1.mp3' && f.para === 'bia'));
  assert.equal(new Set(lista.map((f) => f.arquivo)).size, lista.length, 'nomes de arquivo únicos');
  assert.deepEqual(P.arquivosDeFala(P.buscar('rosa')), []);
});
