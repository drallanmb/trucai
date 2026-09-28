// Exemplo do modelo de ficha (docs/PERSONAGENS.md) — o exemplo COMPLETO: usa todos os campos, inclusive os
// mais novos (acessório em lista, cor do boné, marca no boné) e falas para outros personagens.
// Copie este arquivo para criar outro personagem e acrescente a linha de script dele no index.html.
//
// Vini (Vini Lana, da AI Coders) é o parceiro padrão no 2×2: senta à sua frente (assento 2).
Truco.personagem({
  // ---------------------------------------------------------------- identidade
  nome: 'Vini', //           obrigatório; até 16 letras. Aparece na mesa, no placar e nos balões.
  apelido: 'Vini Lana', //   opcional; até 20 letras. O painel usa o mais curto dos dois ("do Vini").
  genero: 'ele', //          'ele' ou 'ela': decide o artigo ("o Vini leva 1").
  historia: 'Dev da AI Coders. Joga truco no intervalo do deploy e trata cada mão como um teste: só sobe pra produção o que passou.',

  // ---------------------------------------------------------------- visual (peças prontas)
  visual: {
    pele: 'clara', //                          nome do catálogo ou código de cor
    cabelo: 'curto',
    corCabelo: '#3b2a1e', //                   castanho-escuro (código de cor)
    rosto: 'barba', //                         barba cheia; usa a mesma cor do cabelo
    // Acessório aceita um só ('oculos') ou uma lista, um por lugar: cabeça, olhos, boca/orelha.
    acessorio: ['bone-frente', 'oculos-fino'],
    corAcessorio: '#1b1918', //                cor do boné (ou do chapéu); sem ela, vale a cor dos detalhes
    marcaNoBone: 'tres-quadrados', //          'tres-quadrados' ou 'nenhuma' (padrão); só aparece com boné
    roupa: 'camisa-lisa', //                   camiseta/moletom lisa
    cor: '#1f1d1c', //                         preta
    corSecundaria: '#3a3634', //               gola e detalhes num cinza bem escuro
  },

  // ---------------------------------------------------------------- jeito de jogar
  // Equilibrado com um pouco mais de coragem: pede truco quando os "testes passam" e segura a mão do parceiro.
  jogo: { estilo: 'equilibrado', blefe: 5.5, cautela: 4.5 },

  // ---------------------------------------------------------------- voz (sintetizador; ou arquivos em audio/vozes/vini/)
  voz: { tom: 'medio', velocidade: 'rapido' },

  // ---------------------------------------------------------------- falas (até 40 letras cabem melhor no balão)
  // A posição de cada frase dá o nome do arquivo de áudio gravado: falas.truco[1] → audio/vozes/vini/truco-2.mp3.
  falas: {
    truco: ['Truco! Deploy em produção!', 'Truco! Sobe pra main!', 'Truco! Tá compilando?', 'Truco! Roda aí pra ver.'],
    seis: ['Seis! Escalou o servidor!', 'Seis! Aumenta a carga!', 'Seis, que o teste passou!'],
    nove: ['Nove! Sem rollback!', 'Nove! Vai direto pro ar!', 'Nove! Confia no código!'],
    doze: ['Doze! Commit final!', 'Doze! É agora ou nunca!', 'Doze! Push na sexta!'],
    aceitar: ['Cai, tá testado.', 'Pode vir, tá no log.', 'Cai! Já revisei.', 'Manda, que eu debugo.'],
    correr: ['Corro... deu bug.', 'Essa não passou no teste.', 'Corro. Volta pro backlog.', 'Deu erro 500. Tô fora.'],
    ganhouRodada: ['Passou no teste!', 'Build verde!', 'Rodou de primeira!', 'Essa foi limpa.'],
    perdeuRodada: ['Deu bug aqui.', 'Faltou um teste...', 'Anota no backlog.', 'Hmm, conflito de merge.'],
    cangou: ['Cangou! Empate técnico.', 'Cangou! Deu timeout.', 'Cangou! Roda de novo.'],
    ganhouMao: ['Merge aprovado!', 'Pode marcar, parceiro!', 'Subiu sem erro!'],
    perdeuMao: ['Bora refatorar.', 'Próxima sprint é nossa.', 'Anotado. Vamos corrigir.'],
    maoDeOnzeJoga: ['Bora rodar essa!', 'Tá no ponto. Vamos jogar.', 'Essa mão compila.'],
    maoDeOnzeCorre: ['Essa não compila.', 'Melhor não subir essa.', 'Volta pro rascunho.'],
    pensando: ['Carregando...', 'Deixa eu ver o log...', 'Hmm, pensando no caso.'],
    ganhouPartida: ['Deploy feito! Café por conta de vocês.', 'Partida em produção!', 'Zero bug. Valeu, parceiro!'],
    perdeuPartida: ['Amanhã tem hotfix.', 'Vou estudar o log.', 'Revanche na próxima sprint.'],
  },

  // ---------------------------------------------------------------- sinais para o parceiro (só no 2×2)
  // Gestos do catálogo: piscar, levantar-sobrancelha, bochecha-com-lingua, ponta-da-lingua,
  // levantar-ombro, encher-bochechas, cocar-nariz.
  sinais: {
    zap: 'piscar',
    copas: 'levantar-sobrancelha',
    espadilha: 'bochecha-com-lingua',
    picafumo: 'ponta-da-lingua',
    tres: 'cocar-nariz',
  },

  // ---------------------------------------------------------------- relações (opcional)
  // Falas de falasPara têm prioridade quando a pessoa está à mesa; por isso ficam em momentos raros
  // (mão de onze), para as falas normais continuarem aparecendo.
  relacoes: {
    rival: 'tiao',
    falasPara: {
      tiao: {
        maoDeOnzeJoga: ['Bora, Seu Tião, sem medo!', 'Vamos nessa, Seu Tião!'],
      },
      bia: {
        maoDeOnzeCorre: ['Hoje não, Bia. Essa não compila.', 'Essa fica pra você, Bia.'],
      },
    },
  },
})
