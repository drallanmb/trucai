// Exemplo do modelo de ficha (docs/PERSONAGENS.md): um marreco afoito, sem apelido e com a pele em código de cor.
// Copie este arquivo para criar outro personagem e acrescente a linha de script dele no index.html.
Truco.personagem({
  nome: 'Juninho',
  historia: 'Sobrinho do dono do boteco. Aprendeu truco no ano passado e aceita qualquer pedido.',

  visual: {
    pele: '#8D5A3B',
    cabelo: 'curto',
    corCabelo: 'preto',
    acessorio: 'bone',
    roupa: 'camisa-de-time',
    cor: '#3E6B45',
  },

  jogo: { estilo: 'marreco', blefe: 5.5, cautela: 2.8 },

  voz: { tom: 'medio', velocidade: 'normal' },

  falas: {
    truco: ['Truco! Bora!', 'Truco, truco, truco!'],
    aceitar: ['Cai dentro!', 'Bora!', 'Vem que tem!'],
    correr: ['Tô fora dessa.'],
    ganhouRodada: ['Levei essa!', 'Marreco é a vó!'],
    perdeuRodada: ['Ué?', 'Foi sorte!'],
    pensando: ['Pera, pera...', 'Qual era a manilha mesmo?'],
  },

  sinais: { zap: 'encher-bochechas' },

  relacoes: {
    parceiro: 'tiao',
    falasPara: {
      'dona-cida': {
        truco: ['Truco, Dona Cida! Com todo respeito.'],
      },
    },
  },
})
