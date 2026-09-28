// Exemplo do modelo de ficha (docs/PERSONAGENS.md): uma ficha completa, com relações.
// Copie este arquivo para criar outro personagem e acrescente a linha de script dele no index.html.
Truco.personagem({
  nome: 'Tião',
  apelido: 'Seu Tião',
  historia: 'Aposentado da CMTC, joga na calçada do boteco toda noite desde 1985. Blefa com a cara mais séria do mundo.',

  visual: {
    pele: 'morena',
    cabelo: 'careca',
    corCabelo: 'grisalho',
    rosto: 'bigodao',
    acessorio: 'nenhum',
    roupa: 'camisa-listrada',
    cor: '#2F5D8A',
  },

  jogo: { estilo: 'blefador', blefe: 7.2, cautela: 3.5 },

  voz: { tom: 'grave', velocidade: 'normal' },

  falas: {
    truco: ['Truco, ladrão!', 'Truco!', 'Truco! Quero ver ter peito.'],
    seis: ['Seis, ladrão!', 'Meio-pau!'],
    aceitar: ['Cai!', 'Manda que eu gosto.', 'Pode vir, que eu tô sentado.'],
    correr: ['Corro... dessa vez.', 'Essa eu deixo passar.'],
    cangou: ['Cangou!', 'Embuchou!'],
    ganhouRodada: ['A primeira vai à missa!', 'Olha a casinha de caboclo...'],
    perdeuRodada: ['Deixa estar...', 'Tá bom, essa é sua.'],
    pensando: ['Hmm...', 'Traz mais um pingado aí!'],
    ganhouPartida: ['Quem perdeu paga o café!'],
    perdeuPartida: ['Amanhã tem revanche.'],
  },

  sinais: { zap: 'piscar', copas: 'levantar-sobrancelha' },

  relacoes: {
    parceiro: 'juninho',
    rival: 'dona-cida',
    falasPara: {
      'dona-cida': {
        aceitar: ['Pode vir, Dona Cida!'],
        ganhouRodada: ['Essa foi pra senhora, Dona Cida!'],
      },
    },
  },
})
