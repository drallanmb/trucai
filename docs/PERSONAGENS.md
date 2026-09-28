# Como criar um personagem para o TrucAÍ

Todo mundo que senta à mesa do TrucAÍ é descrito por uma **ficha**: quem é a pessoa, como ela é, como joga, como fala e que sinais faz para o parceiro. O jogo lê a ficha e monta o personagem em 3D, com voz, falas e jeito de jogar. O Vini, a Bia, o Tião, a Dona Cida, o Juninho e a Rosa que vêm com o jogo são fichas como qualquer outra (pasta `personagens/`) e servem de modelo. O **exemplo mais completo** (todos os campos, bem comentado) é `personagens/vini.js`.

No 2×2, a mesa padrão é: **Vini** como parceiro (à sua frente — é o parceiro padrão, mas você escolhe outro no menu quando quiser), **Bia** como adversária da esquerda e **Seu Tião** como adversário da direita. No 1×1, o adversário padrão é o Tião.

Há dois jeitos de criar uma ficha:

1. **Pela tela "Personagens"**, dentro do jogo. Você escolhe as peças, vê o personagem em 3D na hora, ouve a voz e já pode sentá-lo à mesa. Não precisa escrever nada.
2. **Escrevendo a ficha num arquivo**. Útil para compartilhar, guardar junto com o jogo ou criar vários de uma vez.

Os dois dão o mesmo resultado: a tela gera a ficha (botão **Copiar ficha**) e uma ficha escrita à mão pode ser colada na tela (botão **Colar ficha**) para ser editada.

---

## 1. A ficha mais simples possível

Só o nome é obrigatório. Todo o resto recebe um padrão. É a ficha da Rosa (`personagens/rosa.js`):

```js
Truco.personagem({ nome: 'Rosa' })
```

Isso já cria alguém de estilo equilibrado, com aparência, voz, falas e sinais padrão. Repare que, sem `genero`, o jogo trata a pessoa como "ele" ("o Rosa leva 1"): para uma jogadora, acrescente `genero: 'ela'`.

## 2. Uma ficha completa

É a ficha do Tião (`personagens/tiao.js`):

```js
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
```

Veja também `personagens/cida.js` (uma jogadora cautelosa, com `genero: 'ela'`) e `personagens/juninho.js` (um marreco, sem apelido e com a pele em código de cor).

O exemplo com **todos** os campos é `personagens/vini.js`. O visual dele usa as peças mais novas — vários acessórios de uma vez, a cor do boné e a marquinha na frente do boné:

```js
visual: {
  pele: 'clara',
  cabelo: 'curto',
  corCabelo: '#3b2a1e',
  rosto: 'barba',
  acessorio: ['bone-frente', 'oculos-fino'], // um por lugar: cabeça, olhos, boca/orelha
  corAcessorio: '#1b1918',                    // cor do boné
  marcaNoBone: 'tres-quadrados',              // a marquinha dos três quadrados
  roupa: 'camisa-lisa',
  cor: '#1f1d1c',
  corSecundaria: '#3a3634',
},
```

E `personagens/bia.js` mostra `cabelo: 'rabo-de-cavalo'` e `brincos: true`.

---

## 3. Campo a campo

### Identidade

| Campo | O que é | Regras |
|---|---|---|
| `nome` | Como aparece na mesa, no placar e nos balões | **Obrigatório.** Até 16 letras. |
| `apelido` | Como os outros chamam | Opcional. Até 20 letras. Se faltar, vale o nome. O painel das rodadas usa o mais curto dos dois ("da Cida", não "da Dona Cida"). |
| `genero` | `'ele'` ou `'ela'`: decide o artigo nas frases do jogo ("o Tião leva 1", "a Dona Cida") | Opcional. Padrão `'ele'`. |
| `historia` | Uma ou duas frases sobre a pessoa | Opcional. Até 200 letras. Aparece na hora de escolher quem senta à mesa. |

### Visual (peças prontas)

Cada campo aceita uma das opções da tabela. Maiúsculas, acentos e espaços não importam (`'Morena Clara'` vale `'morena-clara'`). As cores aceitam um nome da lista ou um código de cor como `'#2F5D8A'`.

| Campo | Opções | Padrão |
|---|---|---|
| `pele` | `clara`, `morena-clara`, `morena`, `negra` (ou código de cor) | `morena-clara` |
| `cabelo` | `careca`, `curto`, `topete`, `coque`, `comprido`, `rabo-de-cavalo`, `black`, `laterais` (só dos lados) | `curto` |
| `corCabelo` | `preto`, `castanho`, `loiro`, `ruivo`, `grisalho`, `branco` (ou código de cor) | `castanho` |
| `rosto` | `nenhum`, `bigode`, `bigodao`, `cavanhaque`, `barba` | `nenhum` |
| `acessorio` | Um só (`'oculos'`) ou uma **lista**, um por lugar (`['bone-frente', 'oculos-fino']`). Cabeça: `bone`, `bone-frente` (Boné, aba pra frente), `chapeu-panama`. Olhos: `oculos`, `oculos-fino` (Óculos fininho). Boca ou orelha: `lapis-na-orelha`, `palito-na-boca`. `nenhum` = sem acessório | `nenhum` |
| `roupa` | `camisa-lisa`, `camisa-listrada`, `camisa-de-time`, `regata`, `camisa-social`, `avental` | `camisa-lisa` |
| `cor` | Cor principal da roupa: `azul`, `vermelho`, `verde`, `amarelo`, `laranja`, `vinho`, `roxo`, `rosa`, `cinza`, `preto`, `branco`, `caqui` (ou código de cor) | uma cor viva, sempre a mesma para o mesmo nome |
| `corSecundaria` | Listras, gola, boné e detalhes (mesmas opções de `cor`) | derivada de `cor` |
| `corAcessorio` | Cor do boné ou do chapéu (mesmas opções de `cor`) | a de `corSecundaria` |
| `marcaNoBone` | `tres-quadrados` (a marquinha dos três quadrados, em branco) ou `nenhuma`. Só aparece com boné | `nenhuma` |
| `brincos` | `true` (com brincos) ou `false` | `false` |

Dois acessórios no mesmo lugar (por exemplo boné e chapéu) não cabem: a ficha fica com o primeiro e avisa. A tela "Personagens" mostra um grupo por lugar, então lá não tem como errar.

> As proporções do corpo são fixas de propósito: assim qualquer combinação fica bonita e cabe na mesa.

### Jeito de jogar (`jogo`)

Primeiro escolha um **estilo**. Se quiser, ajuste depois o blefe e a cautela, de 0 a 10 (vale número quebrado, como `7.2`). O que você ajustar substitui o número do estilo.

| Estilo | Como joga | Blefe | Cautela |
|---|---|---|---|
| `blefador` | Pede truco com mão fraca para assustar; gosta de trucar de mão | 8 | 3 |
| `cauteloso` | Só pede truco com mão boa; corre fácil | 2 | 8 |
| `equilibrado` (padrão) | Joga pelo livro; blefa de vez em quando | 5 | 5 |
| `marreco` | Novato: aceita tudo e esquece quais manilhas já saíram | 4 | 2 |

- **Blefe** (0 a 10): quanto pede truco sem ter mão para isso. 0 = nunca blefa, 10 = blefa sempre que pode.
- **Cautela** (0 a 10): quanto medo tem de aceitar um pedido. 0 = aceita qualquer coisa, 10 = só aceita com a mão feita.

A **dificuldade** (Fácil, Médio, Difícil) continua sendo escolhida no menu e vale para a mesa toda. A ficha diz *como* o personagem joga; a dificuldade diz *quão bem*.

### Voz

| Campo | Opções | Padrão |
|---|---|---|
| `tom` | `grave`, `medio`, `agudo` | `medio` |
| `velocidade` | `devagar`, `normal`, `rapido` | `normal` |

A voz usa o sintetizador do navegador em português, então o timbre exato varia de um computador para outro. Na tela, o botão **Ouvir** fala uma frase com a voz escolhida.

### Falas

Cada momento aceita uma lista de frases (ou uma frase só), e o jogo sorteia uma delas. Frases com até 40 letras cabem melhor no balão; o limite é 80, e até 12 frases por momento. **Momento que ficar vazio usa as falas padrão do jogo**, então dá para escrever só os momentos que importam.

> **Áudio gravado:** a posição de cada frase na lista dá o nome do arquivo de voz: a 2ª frase de `truco` do Vini é `audio/vozes/vini/truco-2.mp3`. Se você mudar a ordem das frases, renomeie os arquivos (ou regrave). Guia completo em [`docs/AUDIO.md`](AUDIO.md).

| Momento | Quando acontece |
|---|---|
| `truco`, `seis`, `nove`, `doze` | Ao pedir (ou aumentar para) cada valor |
| `aceitar`, `correr` | Ao responder um pedido |
| `ganhouRodada`, `perdeuRodada`, `cangou` | Fim de cada rodada |
| `ganhouMao`, `perdeuMao` | Fim da mão |
| `maoDeOnzeJoga`, `maoDeOnzeCorre` | Decisão da mão de onze |
| `pensando` | Enquanto decide a jogada ou quando você demora (use pouco) |
| `ganhouPartida`, `perdeuPartida` | Fim da partida |

> **Não use** palavras que soam como "truco" (**Troco**, **Truca**, **Jorge**) nem ordens para o parceiro (**Mata**, **Deixa pra mim**, **Deixa comigo**). Em torneio elas valem como pedido ou são proibidas, e aqui atrapalham quem está jogando. A ficha tira a fala que tiver uma delas e avisa; a tela nem deixa adicionar.

### Sinais

No truco de verdade, parceiros trocam sinais com o rosto. A ficha diz qual gesto o personagem faz para cada carta forte. Opcional: o padrão segue a tradição.

Os sinais acontecem **só entre parceiros**, no 2×2: logo depois de dar as cartas, se o seu parceiro (quem senta à sua frente) tem uma carta forte, ele faz **um** gesto, o da carta mais forte, olhando para você. Os adversários não sinalizam. Não há sinal na mão de ferro (ninguém vê as cartas) nem na mão de onze do seu time (você já vê as cartas do parceiro). Com **Explicar os sinais** ligado no menu (padrão), o jogo diz o que o gesto quer dizer: "Vini piscou — tem o Zap".

| Carta | Gesto padrão |
|---|---|
| `zap` | `piscar` |
| `copas` | `levantar-sobrancelha` |
| `espadilha` | `bochecha-com-lingua` |
| `picafumo` (ou `pica-fumo`) | `ponta-da-lingua` |
| `tres` (um 3 comum) | `levantar-ombro` |

Gestos disponíveis: `piscar`, `levantar-sobrancelha`, `bochecha-com-lingua`, `ponta-da-lingua`, `levantar-ombro`, `encher-bochechas`, `cocar-nariz` (também aceita `coçar-nariz`).

### Relações (opcional)

| Campo | O que é |
|---|---|
| `parceiro` | Nome (ou id) de quem costuma fazer dupla com ele. Informativo por enquanto. |
| `rival` | Nome (ou id) do rival. Se o rival estiver envolvido, as falas para ele vêm primeiro. |
| `falasPara` | Falas especiais para um personagem: `{ 'dona-cida': { aceitar: ['Pode vir, Dona Cida!'] } }` |

O id de um personagem é o nome em minúsculas, sem acento, com hífen no lugar dos espaços: `Dona Cida` → `dona-cida`, `Tião` → `tiao`.

As falas de `falasPara` têm prioridade quando o momento envolve aquela pessoa: ao aceitar ou correr de um pedido **dela**, ao pedir truco com ela do outro lado, ao ganhar ou perder rodada, mão ou partida com ela na mesa (adversários primeiro, depois o parceiro). Se não houver fala especial para o momento, vale a fala normal da ficha, e depois a padrão do jogo.

> Dica: como a fala especial ganha sempre que a pessoa está à mesa, use `falasPara` em momentos raros (mão de onze, fim de partida) ou com 2–3 variações; num momento frequente, uma frase só vira repetição. O Vini e a Bia fazem assim.

---

## 4. Quando algo está errado

A ficha nunca quebra o jogo. Se um campo tiver um valor que não existe, o jogo usa o padrão e mostra um aviso na tela de personagens (e no console do navegador, para fichas escritas à mão), por exemplo:

> **Tião:** blefe precisa ser um número de 0 a 10 e veio 15. Usei 10.
>
> **Rosa:** não conheço o cabelo “moicano”. Opções: careca, curto, topete, coque, comprido, black, laterais. Usei “curto”.
>
> **Rosa:** a fala “Troco!” (truco) tem “Troco”, que soa como pedido de truco. Tirei essa fala.
>
> **Rosa:** não conheço o campo “vizual”; ignorei.

Texto muito comprido é cortado com aviso. A única coisa que impede o personagem de entrar é faltar o `nome`.

Ao colar uma ficha com erro de escrita, a tela diz onde está o problema, com linha e coluna: "Linha 4, coluna 3: faltou uma vírgula depois de jogo (ou o } do fim) antes de “voz: { tom: …”."

### O que a ficha aceita (formato)

A ficha é um pedaço de JavaScript, mas o jogo **não executa** o que está nela: ele só lê este formato, e qualquer outra coisa é recusada.

- `Truco.personagem({ ... })` ou só `{ ... }`;
- textos com aspas simples `'...'` ou duplas `"..."` (crase não vale);
- nomes de campo com ou sem aspas (`nome:` ou `'nome':`);
- números (`7`, `7.2`), `true`, `false`, listas `[ ]` e grupos `{ }`;
- vírgula sobrando no fim de listas e grupos;
- comentários `// até o fim da linha` e `/* entre marcas */`.

---

## 5. Onde a ficha fica

### Pela tela "Personagens"

1. No menu, toque em **Personagens**.
2. **Criar personagem** começa uma ficha do zero; **Ver** mostra um personagem do jogo (só para ver) e **Duplicar** faz uma cópia dele para você mudar; **Colar ficha** abre uma ficha que alguém mandou.
3. No editor, a prévia 3D mostra o personagem na hora (arraste para girar). **Gritar truco** e **Fazer sinal** testam o personagem; **Ouvir** testa a voz; **Testar** em cada sinal mostra o gesto.
4. Os avisos da ficha aparecem embaixo do formulário enquanto você edita.
5. **Salvar** guarda em **Meus personagens** (no navegador). Em "Meus personagens" dá para **Editar** e **Apagar** (a tela pede confirmação).
6. **Copiar ficha** copia o texto da ficha para mandar para alguém ou salvar num arquivo.
7. Para sentar alguém à mesa, escolha em **Quem senta à mesa**, no menu: no 1×1, o adversário; no 2×2, o parceiro (à sua frente) e os adversários da direita e da esquerda. Todos os personagens aparecem ali, os do jogo e os seus. Ninguém senta em dois lugares: escolher alguém que já está noutro lugar troca os dois. Sem escolha, vale a mesa padrão: no 2×2, Vini (parceiro padrão), Bia (esquerda) e Tião (direita); no 1×1, Tião.

"Meus personagens" ficam no navegador (localStorage). Limpar os dados do site ou usar outro navegador começa sem eles; guarde as fichas com **Copiar ficha**.

### Escrita à mão, junto com o jogo

1. Copie um dos exemplos de `personagens/` (por exemplo `personagens/rosa.js`) para `personagens/<id>.js` e escreva a ficha.
2. No `index.html`, acrescente uma linha logo depois das outras fichas:

   ```html
   <script src="personagens/<id>.js"></script>
   ```

   O jogo abre direto do arquivo, sem servidor, então ele não consegue descobrir sozinho quais arquivos existem na pasta; por isso a linha.
3. Recarregue a página. O personagem aparece em **Personagens** (em "Do jogo") e em **Quem senta à mesa**. Se a ficha tiver avisos, eles aparecem no console do navegador e ao abrir o personagem na tela.
4. Para o arquivo único (`dist/cafe-truco.html`), rode `node tools/build.mjs`: ele embute tudo o que o `index.html` carrega, inclusive as fichas.

---

## Apêndice técnico (contrato de implementação — v1)

**Arquivos**
- `js/core/personagens.js` → `Truco.Personagens` (puro, testável em Node) e o atalho global `Truco.personagem(ficha)` que registra uma ficha do jogo.
- `personagens/<id>.js` → uma ficha por arquivo (script clássico chamando `Truco.personagem({...})`), listados no `index.html` logo depois de `js/core/personagens.js`. O build embute como os demais.
- `js/gfx/avatars.js` → peças e gestos; `js/gfx/avatarpreview.js` → `Truco.AvatarPreview` (prévia 3D da tela de criação).
- Tela "Personagens" em `js/ui/hud.js` (`hud.showPersonagens()`, classe `Studio`) + `css/style.css`; escolha de lugares no menu; ligação no `js/main.js`.
- Testes: `tests/personagens.test.js`; controlador em `tests/main.test.js`.

**`Truco.Personagens`**
```js
Personagens.CATALOGO            // opções de cada campo com rótulos pt-BR: pele, cabelo, corCabelo, rosto, acessorio, roupa,
                                // cor, genero, tom (+pitch), velocidade (+rate), gesto (+feito: 'piscou'), carta (+nome: 'o Zap')
Personagens.ESTILOS             // { blefador:{blefe:8,cautela:3,rotulo,descricao}, cauteloso:{2,8}, equilibrado:{5,5}, marreco:{4,2} }
Personagens.MOMENTOS / SUGESTOES / SINAIS_PADRAO / VISUAL_PADRAO / LIMITES / STORAGE_KEY
Personagens.normalizar(ficha)   // -> { personagem, avisos: string[] }  nunca lança; só rejeita (personagem=null) sem nome
Personagens.registrar(ficha)    // normaliza e guarda como "do jogo" (id = slug do nome, único); devolve { personagem, avisos }
Personagens.lista()             // cópias: personagens do jogo + "Meus personagens" (localStorage 'cafe-truco:personagens', try/catch)
Personagens.buscar(id)
Personagens.salvarMeu(ficha)    // -> { personagem, avisos, salvo }; ficha.id opcional (atualiza pelo id); nunca usa o id de um do jogo
Personagens.removerMeu(id)      // -> boolean
Personagens.paraFicha(p)        // personagem -> ficha compacta (só o que difere dos padrões)
Personagens.paraTexto(p)        // ficha formatada como no guia (Truco.personagem({...}))
Personagens.deTexto(texto)      // parser SEGURO do formato da seção 4 — NUNCA eval/Function
                                // -> { ficha, erro: null } | { ficha: null, erro: 'Linha L, coluna C: …', linha, coluna }
Personagens.avatarSpec(p, seat) // -> spec do Avatars.create (abaixo)
Personagens.personalidade(p)    // -> { bluff: blefe/10, caution: cautela/10 } (+ marreco: sloppy: 0.35)
Personagens.voz(p)              // -> { pitch, rate }  grave .78 / medio 1 / agudo 1.22 ; devagar .9 / normal 1 / rapido 1.12
Personagens.fala(p, momento, rng, { outros: [ids] }?)  // frase da ficha (falasPara dos `outros` primeiro, rival à frente) ou null
Personagens.momentoDe(kind, ctx)  // tipo de fala do Truco.AI ('call' 6 → 'seis', 'accept' → 'aceitar', 'idle' → 'pensando'…)
Personagens.sinal(p, carta)     // gesto para 'zap'|'copas'|'espadilha'|'picafumo'|'tres'
Personagens.cartaParaSinal(mao, manilhaRank)  // carta mais forte que merece sinal, ou null
Personagens.explicarSinal(p, carta, gesto?)   // "Dona Cida piscou — tem o Zap"
Personagens.artigo(p) / nomeCurto(p) / slug(nome)
Personagens.acessoriosDe(p)     // ['bone-frente', 'oculos-fino'] (sem 'nenhum')
Personagens.chaveDeFala(p, momento, texto)  // 'truco-2' (2ª frase de falas.truco) | 'para-<id>-<momento>-<n>' | null
Personagens.arquivosDeFala(p)   // [{ momento, n, chave, para, texto, arquivo: 'audio/vozes/<id>/<chave>.mp3' }] (roteiro)
```

Personagem normalizado: `{ id, nome, apelido, historia, genero, visual:{pele, cabelo, corCabelo, rosto, acessorio: id | [ids] (lista com 2+), roupa, cor:'#hex', corSecundaria:'#hex'|null, corAcessorio:'#hex'|null, marcaNoBone:'nenhuma'|'tres-quadrados', brincos:boolean}, jogo:{estilo, blefe, cautela}, voz:{tom, velocidade}, falas:{<momento>:[..]}, sinais:{zap, copas, espadilha, picafumo, tres}, relacoes:{parceiro, rival, falasPara}, origem:'jogo'|'meu' }`. `pele` e `corCabelo` guardam o nome do catálogo quando o código bate com uma cor dele.

**Spec do avatar** (`Avatars.create(ctx, spec)`, compatível com o `style` antigo):
```js
{ seat, name, skin:'#hex', hair:'#hex', shirt:'#hex', accent:'#hex',
  hairStyle: 'careca'|'curto'|'topete'|'coque'|'comprido'|'rabo-de-cavalo'|'black'|'laterais',
  face: 'nenhum'|'bigode'|'bigodao'|'cavanhaque'|'barba',
  accessory: 'nenhum'|'bone'|'bone-frente'|'oculos'|'oculos-fino'|'chapeu-panama'|'lapis-na-orelha'|'palito-na-boca' | [um por lugar],
  outfit: 'camisa-lisa'|'camisa-listrada'|'camisa-de-time'|'regata'|'camisa-social'|'avental',
  capColor?: '#hex', capMark?: 'tres-quadrados', earrings?: true }   // só presentes quando a ficha usa
// Valor que o avatar não conhece cai no padrão, sem erro.
avatar.signal(gesto) -> Promise   // 'piscar'|'levantar-sobrancelha'|'bochecha-com-lingua'|'ponta-da-lingua'|'levantar-ombro'|'encher-bochechas'|'cocar-nariz'
```

**`Truco.AvatarPreview.create(el, { quality })`** → `{ setSpec(spec), act(kind), signal(gesto), dispose() }`: um avatar sozinho numa cadeira de boteco, luz quente, girando devagar (arrastar gira), redimensiona com o elemento. Sem ele, a tela mostra um rostinho 2D com as cores.

**Controlador (`js/main.js`)**
- Configuração: `settings.seats2 = { 1: id }`, `settings.seats4 = { 1: id, 2: id, 3: id }` (menu, salvos nas preferências), `settings.explainSignals` (padrão `true`, vale na hora).
- `Game.resolveCast(players, escolha)` → `[null, p1, p2?, p3?]`: respeita a escolha, sem repetir; o que faltar vem do padrão (2×2: Tião, Vini, Bia; 1×1: Tião) e depois de quem sobrar. `Game.DEFAULT_SEATS`.
- Bots: `AI.create({ personality: Personagens.personalidade(p) })`. Voz: `Audio.say(texto, { seat, shout, voice: Personagens.voz(p) })`.
- Falas: `line()` tenta `Personagens.fala(p, Personagens.momentoDe(kind), rng, { outros })` e, se vier `null`, usa `bot.phrase(kind)`.
- Sinal: em 2×2, depois de `dealHand`, `scene.avatarSignal?.(2, gesto)` (espera até 2,6 s) e, com "Explicar os sinais", `hud.toast(explicarSinal)`. Registro em `window.__truco.signals`; o elenco da partida em `window.__truco.cast()`.
- Cena: `scene.avatarSignal(seat, gesto) -> Promise` (chama `avatar.signal(gesto)` do assento; sem avatar/sem sinal, resolve na hora). Se a cena não tiver o método, só o texto aparece.
