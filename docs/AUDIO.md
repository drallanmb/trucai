# Áudio gravado: onde ficam os arquivos e o que gravar

Hoje o TrucAÍ **não tem nenhum arquivo de áudio**: todos os efeitos são sintetizados por código (`js/ui/audio.js`) e as vozes saem do sintetizador de fala do navegador. Você pode trocar qualquer um desses sons por um arquivo gravado (por exemplo no ElevenLabs). A regra é simples:

- **Existe o arquivo** com o nome certo → o jogo toca o arquivo.
- **Não existe** (ou o arquivo deu erro) → o jogo usa o som sintetizado, como hoje. Nada trava.

Dá para gravar aos poucos: um efeito, só as falas do Vini, só o "Truco!"… O resto continua sintetizado.

## Onde ficam

```
audio/
  sfx/                     efeitos: audio/sfx/<nome>.mp3        (lista abaixo)
  vozes/
    vini/                  falas do Vini: audio/vozes/vini/<momento>-<n>.mp3
    bia/                   falas da Bia
    tiao/  dona-cida/  juninho/
    voce/                  gritos de quem joga (você): truco-1.mp3, aceitar-1.mp3…
  manifest.js              GERADO — lista do que existe (não edite à mão)
  ROTEIRO.csv              GERADO — todas as falas: personagem, momento, arquivo, texto
  LEIA-ME.md
```

- A pasta de cada personagem é o **id** da ficha: o nome em minúsculas, sem acento, com hífen (`Dona Cida` → `dona-cida`, `Tião` → `tiao`).
- `<momento>-<n>`: **n é a posição da frase** na lista `falas[momento]` da ficha, contando de 1. Quando o jogo sorteia a 2ª frase de `truco` do Vini ("Truco! Sobe pra main!"), ele toca `audio/vozes/vini/truco-2.mp3`. As tabelas abaixo já trazem o nome exato de cada arquivo.
- Falas especiais para outro personagem (`relacoes.falasPara`) ficam como `para-<id do outro>-<momento>-<n>.mp3`.
- Se você mudar a ordem das frases numa ficha, os números mudam: renomeie os arquivos ou regrave (e rode o passo 3 de novo).

**Formato:** MP3 (recomendado). Também valem `.m4a`, `.ogg`, `.wav` e `.webm`; se houver o mesmo nome em dois formatos, vale o MP3. Para as falas, MP3 **mono, 64–96 kbps** fica ótimo e leve; para efeitos, 96–128 kbps. Corte o silêncio do começo (o grito tem que sair junto com o letreiro) e deixe só um respiro curto no fim.

## Passo a passo

1. **Gere o áudio** no ElevenLabs (efeitos em *Sound Effects*, falas em *Text to Speech*) — as dicas estão nas tabelas.
2. **Salve com o nome exato** na pasta certa (ex.: `audio/vozes/vini/truco-1.mp3`, `audio/sfx/call.mp3`).
3. **Atualize o manifesto:**

   ```sh
   node tools/audio-manifest.mjs
   ```

   Ele varre `audio/`, reescreve `audio/manifest.js` (a lista do que existe) e `audio/ROTEIRO.csv`, mostra quantas falas de cada personagem já estão gravadas e **avisa** se algum nome não bate com um efeito ou com uma fala da ficha. Por que isso é preciso: o jogo abre direto do arquivo (`file://`), sem servidor, então não consegue olhar a pasta sozinho — o `manifest.js` é quem conta para ele o que existe.
4. **Recarregue o jogo** (`index.html`). Para conferir, no console do navegador: `Truco.Audio.status().files` mostra quantos arquivos o jogo conhece, quantos já tocaram (`played`), quantos falharam e o último (`last`).
5. **Arquivo único / Artifact:**

   ```sh
   node tools/build.mjs
   ```

   O build embute cada arquivo de áudio dentro do `dist/cafe-truco.html` e do `dist/artifact.html` (como `data:`), para eles tocarem sem a pasta. Ele mostra o total e **avisa se passar de 10 MB** — o Artifact tem limite de 16 MB para a página inteira (o jogo sem áudio já ocupa ~1 MB). Com MP3 mono de 64 kbps, as ~170 falas curtas + 12 efeitos ficam por volta de 2–4 MB.

Para gravar em lote, use o **`audio/ROTEIRO.csv`** (abre no Excel/Google Planilhas): uma linha por fala, com `personagem, momento, arquivo, texto`.

O que **continua sintetizado** mesmo com tudo gravado: as falas padrão do jogo (quando um momento da ficha está vazio, como tudo da Rosa), os conselhos do parceiro no diálogo de truco e o burburinho de fundo do boteco. Se quiser voz gravada nesses casos, escreva as falas na ficha do personagem — aí elas entram no roteiro.

## Efeitos (`audio/sfx/`)

São os 12 sons de `Truco.Audio.play(...)`. Duração sugerida = o tamanho do som sintetizado de hoje (o jogo não corta nem espera o arquivo; um arquivo mais longo só se sobrepõe ao próximo). No ElevenLabs *Sound Effects*, os prompts em inglês costumam dar resultado melhor; ajuste *Duration* para o valor sugerido e *Prompt influence* alto.

| Arquivo | O que é (quando toca) | Duração | Dica de prompt (ElevenLabs Sound Effects) |
|---|---|---|---|
| `shuffle.mp3` | Embaralhar: o maço sendo embaralhado (riffle) e duas batidinhas do maço na mesa de ferro. No começo de cada mão | 1,2–1,7 s | `Riffle shuffle of a paper playing card deck, cards cascading, then two soft taps of the deck on a metal folding table, close-up, dry, no music` |
| `deal.mp3` | Dar carta: uma carta voando e pousando na mesa. Toca uma vez por carta distribuída (rápido e repetido) | 0,15–0,35 s | `Single playing card dealt, quick paper flick and soft landing on a metal table, very short, close-up` |
| `flip.mp3` | Virar carta: a vira (que define a manilha) e as cartas que viram na mesa | 0,2–0,4 s | `Playing card flipped over on a table, quick paper snap and light landing, very short, close-up` |
| `place.mp3` | Jogar carta: a carta batida com vontade na mesa de ferro do boteco | 0,25–0,5 s | `Playing card slapped down firmly on a painted metal bar table, short paper slap with a low metallic thump, close-up` |
| `slide.mp3` | Arrastar carta: carta deslizando no tampo (recolher/mover cartas) | 0,25–0,35 s | `Playing card sliding across a smooth painted metal table, short soft swish, close-up` |
| `bean.mp3` | Marcar tento: uma **tampinha de cerveja** caindo na mesa (o placar é de tampinhas) | 0,3–0,6 s | `Beer bottle cap dropped on a metal table, small metallic tick and a short spinning rattle as it settles, close-up` |
| `call.mp3` | **TRUCO!**: soco na mesa de ferro — whoosh, pancada grave, copos, garrafa e tampinhas tremendo. Toca a cada pedido (truco, seis, nove, doze), junto do grito | 0,8–1,5 s | `Fist banging hard on a metal bar table, deep thump, glasses and a beer bottle rattling, bottle caps jumping, short whoosh before the hit, dramatic but short` |
| `win.mp3` | Vitória (mão ou partida ganha): vinheta curtinha de samba — cavaquinho "tchá-ca-TCHÁ" e baixo de violão | 1,5–2,4 s | `Short happy Brazilian samba sting, cavaquinho strum ending on a bright major chord with nylon guitar bass note, 2 seconds, no percussion` |
| `lose.mp3` | Derrota (mão ou partida perdida): violão de nylon descendo em tom menor, meio "que pena" | 2–2,8 s | `Short sad nylon guitar phrase, three descending notes and a soft A minor chord, gentle and a bit comic, 2.5 seconds` |
| `tie.mp3` | Rodada empatada (cangou): duas notas soltas de violão, neutras | 1–1,5 s | `Two neutral open fifth plucks on a nylon guitar, questioning, short, 1.2 seconds` |
| `click.mp3` | Clique de botão da interface (menu, diálogos) | 0,05–0,1 s | `Soft short wooden UI button click, subtle, 60 milliseconds` |
| `hover.mp3` | Passar o mouse sobre uma carta da mão: um "tic" quase imperceptível | 0,03–0,06 s | `Very subtle tiny high tick, UI hover sound, 40 milliseconds, quiet` |

Dicas: exporte com o pico por volta de −3 dBFS e sem silêncio no começo. `click` e `hover` devem ser **bem baixinhos** (tocam o tempo todo); `call`, `win` e `lose` são os mais altos.

## Falas (`audio/vozes/<personagem>/`)

**Como gravar no ElevenLabs (Text to Speech):**

- Modelo **Eleven Multilingual v2** (ou mais novo) com uma voz em **português do Brasil**; escolha (ou crie em *Voice Design*) uma voz por personagem seguindo a descrição de cada um.
- Escreva o texto exatamente como na tabela. Para os gritos (`truco`, `seis`, `nove`, `doze`), grave **gritado/animado** (exclamação, *Style* mais alto); para `pensando`, bem baixinho, como quem fala sozinho.
- *Stability* por volta de 40–50% dá expressão sem perder a voz; *Speed* conforme a ficha (rápido ≈ 1,1).
- Um arquivo por linha da tabela, com o nome exato da coluna **Arquivo**, dentro da pasta do personagem.
- O jogo toca a fala gravada no volume da mesa (grito um pouco mais alto), respeitando **Som** e **Vozes** do menu.

### Tião — pasta `audio/vozes/tiao/`

**Voz:** Senhor de uns 70 anos, paulistano, voz **grave**, ritmo normal, rouca de boteco, malandro e sério ao mesmo tempo (blefa com a cara fechada). Ficha: tom grave, velocidade normal.

| Arquivo | Momento | Texto a gravar |
|---|---|---|
| `truco-1.mp3` | Pedir truco | Truco, ladrão! |
| `truco-2.mp3` | Pedir truco | Truco! |
| `truco-3.mp3` | Pedir truco | Truco! Quero ver ter peito. |
| `seis-1.mp3` | Pedir seis | Seis, ladrão! |
| `seis-2.mp3` | Pedir seis | Meio-pau! |
| `aceitar-1.mp3` | Aceitar | Cai! |
| `aceitar-2.mp3` | Aceitar | Manda que eu gosto. |
| `aceitar-3.mp3` | Aceitar | Pode vir, que eu tô sentado. |
| `correr-1.mp3` | Correr | Corro... dessa vez. |
| `correr-2.mp3` | Correr | Essa eu deixo passar. |
| `ganhouRodada-1.mp3` | Ganhou a rodada | A primeira vai à missa! |
| `ganhouRodada-2.mp3` | Ganhou a rodada | Olha a casinha de caboclo... |
| `perdeuRodada-1.mp3` | Perdeu a rodada | Deixa estar... |
| `perdeuRodada-2.mp3` | Perdeu a rodada | Tá bom, essa é sua. |
| `cangou-1.mp3` | Cangou | Cangou! |
| `cangou-2.mp3` | Cangou | Embuchou! |
| `pensando-1.mp3` | Pensando | Hmm... |
| `pensando-2.mp3` | Pensando | Traz mais um pingado aí! |
| `ganhouPartida-1.mp3` | Ganhou a partida | Quem perdeu paga o café! |
| `perdeuPartida-1.mp3` | Perdeu a partida | Amanhã tem revanche. |
| `para-dona-cida-aceitar-1.mp3` | Aceitar (falando com Dona Cida) | Pode vir, Dona Cida! |
| `para-dona-cida-ganhouRodada-1.mp3` | Ganhou a rodada (falando com Dona Cida) | Essa foi pra senhora, Dona Cida! |

### Vini — pasta `audio/vozes/vini/`

**Voz:** Homem jovem (20 e poucos), dev, simpático e animado, fala **rápido** e natural, tom **médio**. Nada de voz de locutor: é conversa de mesa entre amigos. Ficha: tom médio, velocidade rápida.

| Arquivo | Momento | Texto a gravar |
|---|---|---|
| `truco-1.mp3` | Pedir truco | Truco! Deploy em produção! |
| `truco-2.mp3` | Pedir truco | Truco! Sobe pra main! |
| `truco-3.mp3` | Pedir truco | Truco! Tá compilando? |
| `truco-4.mp3` | Pedir truco | Truco! Roda aí pra ver. |
| `seis-1.mp3` | Pedir seis | Seis! Escalou o servidor! |
| `seis-2.mp3` | Pedir seis | Seis! Aumenta a carga! |
| `seis-3.mp3` | Pedir seis | Seis, que o teste passou! |
| `nove-1.mp3` | Pedir nove | Nove! Sem rollback! |
| `nove-2.mp3` | Pedir nove | Nove! Vai direto pro ar! |
| `nove-3.mp3` | Pedir nove | Nove! Confia no código! |
| `doze-1.mp3` | Pedir doze | Doze! Commit final! |
| `doze-2.mp3` | Pedir doze | Doze! É agora ou nunca! |
| `doze-3.mp3` | Pedir doze | Doze! Push na sexta! |
| `aceitar-1.mp3` | Aceitar | Cai, tá testado. |
| `aceitar-2.mp3` | Aceitar | Pode vir, tá no log. |
| `aceitar-3.mp3` | Aceitar | Cai! Já revisei. |
| `aceitar-4.mp3` | Aceitar | Manda, que eu debugo. |
| `correr-1.mp3` | Correr | Corro... deu bug. |
| `correr-2.mp3` | Correr | Essa não passou no teste. |
| `correr-3.mp3` | Correr | Corro. Volta pro backlog. |
| `correr-4.mp3` | Correr | Deu erro 500. Tô fora. |
| `ganhouRodada-1.mp3` | Ganhou a rodada | Passou no teste! |
| `ganhouRodada-2.mp3` | Ganhou a rodada | Build verde! |
| `ganhouRodada-3.mp3` | Ganhou a rodada | Rodou de primeira! |
| `ganhouRodada-4.mp3` | Ganhou a rodada | Essa foi limpa. |
| `perdeuRodada-1.mp3` | Perdeu a rodada | Deu bug aqui. |
| `perdeuRodada-2.mp3` | Perdeu a rodada | Faltou um teste... |
| `perdeuRodada-3.mp3` | Perdeu a rodada | Anota no backlog. |
| `perdeuRodada-4.mp3` | Perdeu a rodada | Hmm, conflito de merge. |
| `cangou-1.mp3` | Cangou | Cangou! Empate técnico. |
| `cangou-2.mp3` | Cangou | Cangou! Deu timeout. |
| `cangou-3.mp3` | Cangou | Cangou! Roda de novo. |
| `ganhouMao-1.mp3` | Ganhou a mão | Merge aprovado! |
| `ganhouMao-2.mp3` | Ganhou a mão | Pode marcar, parceiro! |
| `ganhouMao-3.mp3` | Ganhou a mão | Subiu sem erro! |
| `perdeuMao-1.mp3` | Perdeu a mão | Bora refatorar. |
| `perdeuMao-2.mp3` | Perdeu a mão | Próxima sprint é nossa. |
| `perdeuMao-3.mp3` | Perdeu a mão | Anotado. Vamos corrigir. |
| `maoDeOnzeJoga-1.mp3` | Joga a mão de onze | Bora rodar essa! |
| `maoDeOnzeJoga-2.mp3` | Joga a mão de onze | Tá no ponto. Vamos jogar. |
| `maoDeOnzeJoga-3.mp3` | Joga a mão de onze | Essa mão compila. |
| `maoDeOnzeCorre-1.mp3` | Corre da mão de onze | Essa não compila. |
| `maoDeOnzeCorre-2.mp3` | Corre da mão de onze | Melhor não subir essa. |
| `maoDeOnzeCorre-3.mp3` | Corre da mão de onze | Volta pro rascunho. |
| `pensando-1.mp3` | Pensando | Carregando... |
| `pensando-2.mp3` | Pensando | Deixa eu ver o log... |
| `pensando-3.mp3` | Pensando | Hmm, pensando no caso. |
| `ganhouPartida-1.mp3` | Ganhou a partida | Deploy feito! Café por conta de vocês. |
| `ganhouPartida-2.mp3` | Ganhou a partida | Partida em produção! |
| `ganhouPartida-3.mp3` | Ganhou a partida | Zero bug. Valeu, parceiro! |
| `perdeuPartida-1.mp3` | Perdeu a partida | Amanhã tem hotfix. |
| `perdeuPartida-2.mp3` | Perdeu a partida | Vou estudar o log. |
| `perdeuPartida-3.mp3` | Perdeu a partida | Revanche na próxima sprint. |
| `para-tiao-maoDeOnzeJoga-1.mp3` | Joga a mão de onze (falando com Tião) | Bora, Seu Tião, sem medo! |
| `para-tiao-maoDeOnzeJoga-2.mp3` | Joga a mão de onze (falando com Tião) | Vamos nessa, Seu Tião! |
| `para-bia-maoDeOnzeCorre-1.mp3` | Corre da mão de onze (falando com Bia) | Hoje não, Bia. Essa não compila. |
| `para-bia-maoDeOnzeCorre-2.mp3` | Corre da mão de onze (falando com Bia) | Essa fica pra você, Bia. |

### Bia — pasta `audio/vozes/bia/`

**Voz:** Moça jovem (uns 20 anos), estudante, voz **aguda**/clara, fala **rápido**, provocadora mas simpática, com risada no canto da voz. Ficha: tom agudo, velocidade rápida.

| Arquivo | Momento | Texto a gravar |
|---|---|---|
| `truco-1.mp3` | Pedir truco | Truco! E aí, vai encarar? |
| `truco-2.mp3` | Pedir truco | Truco! Bora ver quem aguenta. |
| `truco-3.mp3` | Pedir truco | Truco! Quero ver agora. |
| `truco-4.mp3` | Pedir truco | Truco! Sem medo. |
| `seis-1.mp3` | Pedir seis | Seis! Aguenta essa! |
| `seis-2.mp3` | Pedir seis | Seis! Tá achando o quê? |
| `seis-3.mp3` | Pedir seis | Seis! Vem pro jogo. |
| `nove-1.mp3` | Pedir nove | Nove! Tô com tudo! |
| `nove-2.mp3` | Pedir nove | Nove! Pode chorar depois. |
| `nove-3.mp3` | Pedir nove | Nove! Sobe mais essa. |
| `doze-1.mp3` | Pedir doze | Doze! Agora é pra valer! |
| `doze-2.mp3` | Pedir doze | Doze! Vai ou racha! |
| `doze-3.mp3` | Pedir doze | Doze! Tô confiante. |
| `aceitar-1.mp3` | Aceitar | Cai! Tô pronta. |
| `aceitar-2.mp3` | Aceitar | Pode vir, tô de boa. |
| `aceitar-3.mp3` | Aceitar | Cai, que eu seguro. |
| `aceitar-4.mp3` | Aceitar | Manda! |
| `correr-1.mp3` | Correr | Corro... essa não dá. |
| `correr-2.mp3` | Correr | Passo essa, próxima é minha. |
| `correr-3.mp3` | Correr | Corro, mas volto. |
| `ganhouRodada-1.mp3` | Ganhou a rodada | Essa é minha! |
| `ganhouRodada-2.mp3` | Ganhou a rodada | Anota aí! |
| `ganhouRodada-3.mp3` | Ganhou a rodada | Olha a conta fechando! |
| `ganhouRodada-4.mp3` | Ganhou a rodada | Fácil, fácil. |
| `perdeuRodada-1.mp3` | Perdeu a rodada | Ah, qual é... |
| `perdeuRodada-2.mp3` | Perdeu a rodada | Calma que tem mais. |
| `perdeuRodada-3.mp3` | Perdeu a rodada | Foi sorte, hein. |
| `perdeuRodada-4.mp3` | Perdeu a rodada | Tá, essa foi boa. |
| `cangou-1.mp3` | Cangou | Cangou! Que tenso. |
| `cangou-2.mp3` | Cangou | Cangou! Tudo igual. |
| `cangou-3.mp3` | Cangou | Empatou, gente! |
| `ganhouMao-1.mp3` | Ganhou a mão | Pode marcar! |
| `ganhouMao-2.mp3` | Ganhou a mão | Mais um tento pra cá! |
| `ganhouMao-3.mp3` | Ganhou a mão | Conta fechada! |
| `perdeuMao-1.mp3` | Perdeu a mão | Beleza, a próxima vem. |
| `perdeuMao-2.mp3` | Perdeu a mão | Tô só esquentando. |
| `perdeuMao-3.mp3` | Perdeu a mão | Vou lembrar dessa. |
| `maoDeOnzeJoga-1.mp3` | Joga a mão de onze | Bora jogar essa! |
| `maoDeOnzeJoga-2.mp3` | Joga a mão de onze | Com essa mão, eu vou. |
| `maoDeOnzeCorre-1.mp3` | Corre da mão de onze | Essa não, gente. |
| `maoDeOnzeCorre-2.mp3` | Corre da mão de onze | Melhor passar essa. |
| `pensando-1.mp3` | Pensando | Pera, deixa eu contar... |
| `pensando-2.mp3` | Pensando | Hmm... |
| `pensando-3.mp3` | Pensando | Qual saiu mesmo? |
| `ganhouPartida-1.mp3` | Ganhou a partida | Ganhei! Vô ia ter orgulho. |
| `ganhouPartida-2.mp3` | Ganhou a partida | É assim que se faz! |
| `ganhouPartida-3.mp3` | Ganhou a partida | Quem perdeu paga o açaí! |
| `perdeuPartida-1.mp3` | Perdeu a partida | Revanche amanhã, hein! |
| `perdeuPartida-2.mp3` | Perdeu a partida | Hoje não foi meu dia. |
| `perdeuPartida-3.mp3` | Perdeu a partida | Vou treinar com o vô. |
| `para-vini-maoDeOnzeJoga-1.mp3` | Joga a mão de onze (falando com Vini) | Pode vir, Vini. Tá testado? |
| `para-vini-maoDeOnzeJoga-2.mp3` | Joga a mão de onze (falando com Vini) | Bora, Vini! Roda esse teste. |
| `para-vini-maoDeOnzeCorre-1.mp3` | Corre da mão de onze (falando com Vini) | Essa é sua, Vini. Aproveita. |
| `para-vini-maoDeOnzeCorre-2.mp3` | Corre da mão de onze (falando com Vini) | Passo essa, Vini. |

### Dona Cida — pasta `audio/vozes/dona-cida/`

**Voz:** Senhora de uns 65 anos, dona de pensão, voz **aguda** e firme, fala **rápido** e sem rodeio, calma e confiante. Ficha: tom agudo, velocidade rápida.

| Arquivo | Momento | Texto a gravar |
|---|---|---|
| `truco-1.mp3` | Pedir truco | Truco, meu filho. |
| `truco-2.mp3` | Pedir truco | Truco! E não é blefe. |
| `aceitar-1.mp3` | Aceitar | Cai, que eu seguro. |
| `aceitar-2.mp3` | Aceitar | Pode mandar. |
| `correr-1.mp3` | Correr | Essa eu não quero, não. |
| `correr-2.mp3` | Correr | Corro, e sem vergonha nenhuma. |
| `ganhouRodada-1.mp3` | Ganhou a rodada | Devagar se vai longe. |
| `ganhouRodada-2.mp3` | Ganhou a rodada | Essa é nossa. |
| `ganhouMao-1.mp3` | Ganhou a mão | Pode marcar, parceiro. |
| `perdeuMao-1.mp3` | Perdeu a mão | Paciência. A próxima vem. |
| `maoDeOnzeJoga-1.mp3` | Joga a mão de onze | Vamos jogar, que dá. |
| `maoDeOnzeCorre-1.mp3` | Corre da mão de onze | Com essa mão, nem pensar. |
| `ganhouPartida-1.mp3` | Ganhou a partida | O café hoje é por conta de vocês. |
| `para-tiao-aceitar-1.mp3` | Aceitar (falando com Tião) | Cai, Tião, que eu conheço teu blefe. |
| `para-tiao-correr-1.mp3` | Correr (falando com Tião) | Pode levar, Tião. Hoje não. |

### Juninho — pasta `audio/vozes/juninho/`

**Voz:** Rapaz de uns 18 anos, afobado e empolgado, tom **médio**, ritmo normal puxando para o rápido. Ficha: tom médio, velocidade normal.

| Arquivo | Momento | Texto a gravar |
|---|---|---|
| `truco-1.mp3` | Pedir truco | Truco! Bora! |
| `truco-2.mp3` | Pedir truco | Truco, truco, truco! |
| `aceitar-1.mp3` | Aceitar | Cai dentro! |
| `aceitar-2.mp3` | Aceitar | Bora! |
| `aceitar-3.mp3` | Aceitar | Vem que tem! |
| `correr-1.mp3` | Correr | Tô fora dessa. |
| `ganhouRodada-1.mp3` | Ganhou a rodada | Levei essa! |
| `ganhouRodada-2.mp3` | Ganhou a rodada | Marreco é a vó! |
| `perdeuRodada-1.mp3` | Perdeu a rodada | Ué? |
| `perdeuRodada-2.mp3` | Perdeu a rodada | Foi sorte! |
| `pensando-1.mp3` | Pensando | Pera, pera... |
| `pensando-2.mp3` | Pensando | Qual era a manilha mesmo? |
| `para-dona-cida-truco-1.mp3` | Pedir truco (falando com Dona Cida) | Truco, Dona Cida! Com todo respeito. |

### Rosa — pasta `audio/vozes/rosa/`

A ficha do Rosa não tem falas próprias (usa as falas padrão do jogo, que continuam sintetizadas). Para gravar, primeiro escreva as falas na ficha (`personagens/rosa.js`) e rode `node tools/audio-manifest.mjs` para atualizar o roteiro.

### Você (quem joga) — pasta `audio/vozes/voce/`

Gritos fixos do jogador humano (sem personagem). Uma voz neutra e animada, de quem está na mesa; grave o "Truco!" e os pedidos **gritados**.

| Arquivo | Momento | Texto a gravar |
|---|---|---|
| `truco-1.mp3` | Pedir truco | Truco! |
| `seis-1.mp3` | Pedir seis | Seis! |
| `nove-1.mp3` | Pedir nove | Nove! |
| `doze-1.mp3` | Pedir doze | Doze! |
| `aceitar-1.mp3` | Aceitar | Cai! |
| `correr-1.mp3` | Correr | Corro! |
| `maoDeOnzeJoga-1.mp3` | Joga a mão de onze | Vamos jogar! |

> "Corro!" serve tanto para correr de um pedido quanto para correr da mão de onze (o mesmo arquivo `correr-1.mp3`).

## Como o jogo acha o arquivo (para quem mexe no código)

- `audio/manifest.js` define `Truco.AUDIO_MANIFEST = { sfx: { call: 'audio/sfx/call.mp3', … }, vozes: { vini: { 'truco-2': 'audio/vozes/vini/truco-2.mp3', … } } }` e é carregado no `index.html` antes de `js/ui/audio.js`. Nunca edite à mão: rode `node tools/audio-manifest.mjs` (ou `node tools/audio-manifest.mjs --check` para só conferir).
- Efeitos: `Truco.Audio.play('call')` toca `sfx.call` se existir; senão sintetiza. Falas: o controlador (`js/main.js`) passa `clip: 'vini/truco-2'` para `Truco.Audio.say(texto, …)`, calculado por `Personagens.chaveDeFala(personagem, momento, texto)`; os gritos de quem joga vêm de `Game.HUMAN_CLIPS` (`'TRUCO!'` → `voce/truco-1`).
- Toca com `HTMLAudioElement` (funciona abrindo o arquivo direto, `file://`), com um pool pequeno por arquivo e pré-carga (efeitos ao ligar o som; falas do elenco ao começar a partida). Mudo, volume e "Vozes" valem para os arquivos. Um arquivo que falha é marcado e não é tentado de novo: o sintetizado entra no lugar.
- Para conferir no navegador: `Truco.Audio.status().files` e o evento `truco:audio-arquivo` em `window` (`detail: { kind, key, ok }`) a cada arquivo tocado ou que falhou.
