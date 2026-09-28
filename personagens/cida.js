// Exemplo do modelo de ficha (docs/PERSONAGENS.md): uma jogadora cautelosa, com genero: 'ela'.
// Copie este arquivo para criar outro personagem e acrescente a linha de script dele no index.html.
Truco.personagem({
  nome: 'Dona Cida',
  apelido: 'Cida',
  genero: 'ela',
  historia: 'Dona da pensão da esquina. Joga desde menina, fala pouco e só pede truco quando tem certeza.',

  visual: {
    pele: 'morena-clara',
    cabelo: 'coque',
    corCabelo: 'castanho',
    rosto: 'nenhum',
    acessorio: 'oculos',
    roupa: 'camisa-lisa',
    cor: '#9B3B2E',
  },

  jogo: { estilo: 'cauteloso', blefe: 3, cautela: 6.2 },

  voz: { tom: 'agudo', velocidade: 'rapido' },

  falas: {
    truco: ['Truco, meu filho.', 'Truco! E não é blefe.'],
    aceitar: ['Cai, que eu seguro.', 'Pode mandar.'],
    correr: ['Essa eu não quero, não.', 'Corro, e sem vergonha nenhuma.'],
    ganhouRodada: ['Devagar se vai longe.', 'Essa é nossa.'],
    ganhouMao: ['Pode marcar, parceiro.'],
    perdeuMao: ['Paciência. A próxima vem.'],
    maoDeOnzeJoga: ['Vamos jogar, que dá.'],
    maoDeOnzeCorre: ['Com essa mão, nem pensar.'],
    ganhouPartida: ['O café hoje é por conta de vocês.'],
  },

  sinais: { zap: 'piscar', copas: 'levantar-sobrancelha', tres: 'cocar-nariz' },

  relacoes: {
    rival: 'tiao',
    falasPara: {
      tiao: {
        aceitar: ['Cai, Tião, que eu conheço teu blefe.'],
        correr: ['Pode levar, Tião. Hoje não.'],
      },
    },
  },
})
