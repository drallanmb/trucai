// Exemplo do modelo de ficha (docs/PERSONAGENS.md): uma jogadora jovem, com genero: 'ela',
// cabelo 'rabo-de-cavalo' e brincos.
// Copie este arquivo para criar outro personagem e acrescente a linha de script dele no index.html.
//
// Bia é a adversária padrão da esquerda no 2×2 (assento 3).
Truco.personagem({
  nome: 'Bia',
  genero: 'ela',
  historia: 'Estudante de engenharia, aprendeu truco com o avô. Faz conta de cabeça e adora um blefe na hora certa.',

  visual: {
    pele: 'morena-clara',
    cabelo: 'rabo-de-cavalo',
    corCabelo: 'castanho',
    rosto: 'nenhum',
    acessorio: 'nenhum',
    brincos: true, //                  brincos pequenos nas orelhas
    roupa: 'camisa-de-time',
    cor: '#2e8b83', //                 verde-água
    corSecundaria: '#f1ece2',
  },

  // Atrevida, mas faz conta: blefa mais que a média e não aceita qualquer coisa.
  jogo: { estilo: 'equilibrado', blefe: 6.5, cautela: 5.5 },

  voz: { tom: 'agudo', velocidade: 'rapido' },

  falas: {
    truco: ['Truco! E aí, vai encarar?', 'Truco! Bora ver quem aguenta.', 'Truco! Quero ver agora.', 'Truco! Sem medo.'],
    seis: ['Seis! Aguenta essa!', 'Seis! Tá achando o quê?', 'Seis! Vem pro jogo.'],
    nove: ['Nove! Tô com tudo!', 'Nove! Pode chorar depois.', 'Nove! Sobe mais essa.'],
    doze: ['Doze! Agora é pra valer!', 'Doze! Vai ou racha!', 'Doze! Tô confiante.'],
    aceitar: ['Cai! Tô pronta.', 'Pode vir, tô de boa.', 'Cai, que eu seguro.', 'Manda!'],
    correr: ['Corro... essa não dá.', 'Passo essa, próxima é minha.', 'Corro, mas volto.'],
    ganhouRodada: ['Essa é minha!', 'Anota aí!', 'Olha a conta fechando!', 'Fácil, fácil.'],
    perdeuRodada: ['Ah, qual é...', 'Calma que tem mais.', 'Foi sorte, hein.', 'Tá, essa foi boa.'],
    cangou: ['Cangou! Que tenso.', 'Cangou! Tudo igual.', 'Empatou, gente!'],
    ganhouMao: ['Pode marcar!', 'Mais um tento pra cá!', 'Conta fechada!'],
    perdeuMao: ['Beleza, a próxima vem.', 'Tô só esquentando.', 'Vou lembrar dessa.'],
    maoDeOnzeJoga: ['Bora jogar essa!', 'Com essa mão, eu vou.'],
    maoDeOnzeCorre: ['Essa não, gente.', 'Melhor passar essa.'],
    pensando: ['Pera, deixa eu contar...', 'Hmm...', 'Qual saiu mesmo?'],
    ganhouPartida: ['Ganhei! Vô ia ter orgulho.', 'É assim que se faz!', 'Quem perdeu paga o açaí!'],
    perdeuPartida: ['Revanche amanhã, hein!', 'Hoje não foi meu dia.', 'Vou treinar com o vô.'],
  },

  sinais: { zap: 'piscar', copas: 'levantar-sobrancelha', espadilha: 'encher-bochechas', tres: 'levantar-ombro' },

  // Falas para o Vini só na mão de onze (falasPara tem prioridade quando ele está à mesa).
  relacoes: {
    parceiro: 'tiao',
    rival: 'vini',
    falasPara: {
      vini: {
        maoDeOnzeJoga: ['Pode vir, Vini. Tá testado?', 'Bora, Vini! Roda esse teste.'],
        maoDeOnzeCorre: ['Essa é sua, Vini. Aproveita.', 'Passo essa, Vini.'],
      },
    },
  },
})
