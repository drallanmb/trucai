# TrucAÍ — Arquitetura e contratos entre módulos

Jogo de **Truco Paulista (manilha limpa)** em HTML + Three.js, todo em 3D.
Regras canônicas: `docs/RULES.md` (fonte da verdade para o motor).

## 0. Princípios

- **Roda abrindo `index.html` direto (file://)**, sem servidor e sem build. Por isso:
  - Nada de ES modules locais. Cada arquivo é um **script clássico** em IIFE que pendura seu módulo em `window.Truco`.
  - Three.js **r159 UMD** via CDN: `https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.min.js` (global `THREE`). Não existem addons (`examples/jsm`) — tudo o que precisar (geometria arredondada, environment, partículas) é escrito à mão com o core.
  - Fontes: Google Fonts (`Shrikhand`, `Barlow`, `Barlow Condensed`) com fallback real.
- **Build opcional** `node tools/build.mjs` gera `dist/cafe-truco.html` (arquivo único, CSS/JS locais embutidos) e `dist/artifact.html` (mesmo conteúdo sem `<!doctype>/<html>/<head>/<body>`, para publicar como Artifact).
- **Identificadores em inglês, textos de interface em português do Brasil.**
- **Sem dependências npm.** Testes com `node --test tests/`.
- Nenhum `alert/confirm/prompt`. `localStorage` só dentro de try/catch (preferências).
- Performance: 60 fps em notebook comum; `quality: 'high'|'low'` (low = sem sombras suaves, pixelRatio ≤ 1.25, menos partículas).

### Padrão de módulo (obrigatório)

```js
(function (root) {
  'use strict';
  const Truco = (root.Truco = root.Truco || {});
  // ... código ...
  Truco.Rules = Rules;
  if (typeof module === 'object' && module.exports) module.exports = Rules;
})(typeof window !== 'undefined' ? window : globalThis);
```

Módulos que dependem de outros leem de `Truco.X` **no momento do uso** (não no carregamento), exceto `core/*` que pode ler na carga (a ordem é garantida).

### Arquivos e ordem de carga (index.html)

| Ordem | Arquivo | Global | Dono |
|---|---|---|---|
| 1 | CDN three@0.159.0 | `THREE` | — |
| 2 | `js/core/rules.js` | `Truco.Rules` | engine |
| 3 | `js/core/engine.js` | `Truco.Engine` | engine |
| 4 | `js/core/ai.js` | `Truco.AI` | ai |
| 5 | `js/gfx/tween.js` | `Truco.Tween` | scene |
| 6 | `js/gfx/cardtex.js` | `Truco.CardTex` | cardtex |
| 7 | `js/gfx/*.js` (demais, na ordem que o dono declarar) | `Truco.Scene` | scene |
| 8a | `audio/manifest.js` (gerado por `tools/audio-manifest.mjs`) | `Truco.AUDIO_MANIFEST` | audio |
| 8 | `js/ui/audio.js` | `Truco.Audio` | audio |
| 9 | `js/ui/hud.js` | `Truco.HUD` | hud |
| 10 | `js/main.js` | `Truco.Game` | controller |
| — | `css/style.css` | — | hud |

`index.html` tem: `<div id="app">` contendo `<div id="stage"></div>` (canvas 3D) e `<div id="hud"></div>` (overlay DOM por cima).

## 1. Convenções do jogo

- **Assentos** `seat`: inteiros `0..N-1`, `N = players ∈ {2, 4}`. **Seat 0 é sempre o humano.**
- **Ordem de jogo = anti-horária** (padrão brasileiro): próximo assento = `(seat + 1) % N`.
- **Times**: `team = seat % 2`. Time 0 = "Nós" (seats 0 e 2), time 1 = "Eles" (seats 1 e 3). Em 2 jogadores: seat 0 × seat 1.
- **Posições na mesa** (vista de cima, y para cima, humano em +z):
  - 4 jogadores: seat 0 = +z (embaixo, humano), seat 1 = +x (direita), seat 2 = −z (em frente, parceiro), seat 3 = −x (esquerda). Isso é anti-horário na tela.
  - 2 jogadores: seat 0 = +z, seat 1 = −z.
- **Unidade 3D**: 1 unidade = 10 cm. Tampo da mesa em `y = 0`. Carta = 0.63 × 0.88 × 0.006.

### Carta

```js
Card = { id: '7h', rank: '7', suit: 'hearts' }
// rank ∈ '4','5','6','7','Q','J','K','A','2','3'
// suit ∈ 'clubs'(paus ♣) | 'hearts'(copas ♥) | 'spades'(espadas ♠) | 'diamonds'(ouros ♦)
// id = rank + inicial do naipe em inglês: 'c','h','s','d'  →  '4c','Qh','As','3d'
```

**Baralho** (`options.deck`, ver RULES.md §1–2): `'limpo'` (**padrão**, 24 cartas: Q J K A 2 3 — é a "manilha limpa") ou `'sujo'` (40 cartas: 4 5 6 7 Q J K A 2 3). As texturas precisam existir para as 40.

## 2. `Truco.Rules` (js/core/rules.js) — funções puras

```js
Rules.DECKS          // { limpo: ['Q','J','K','A','2','3'], sujo: ['4','5','6','7','Q','J','K','A','2','3'] }
                     //   força crescente das comuns E sequência circular da manilha, por baralho
Rules.ALL_RANKS      // ['4','5','6','7','Q','J','K','A','2','3']
Rules.SUITS          // ['diamonds','spades','hearts','clubs']      força crescente das manilhas (ouros < espadas < copas < paus)
Rules.SUIT_INFO      // { clubs:{name:'Paus',symbol:'♣',color:'black',letter:'c'}, hearts:{name:'Copas',symbol:'♥',color:'red',letter:'h'}, ... }
Rules.RANK_NAMES     // { A:'Ás', K:'Rei', J:'Valete', Q:'Dama', '2':'Dois', ... }
Rules.MANILHA_NAMES  // { clubs:'Zap', hearts:'Copas', spades:'Espadilha', diamonds:'Pica-fumo' }
Rules.VALUES         // [1, 3, 6, 9, 12]
Rules.CALL_NAMES     // { 3:'Truco', 6:'Seis', 9:'Nove', 12:'Doze' }
Rules.makeDeck(deck = 'limpo')                  // Card[24|40], ordem fixa
Rules.cardFromId(id)                            // Card
Rules.manilhaRankFor(viraRank, deck = 'limpo')  // seguinte na sequência circular (limpo: vira 3 → Q; sujo: vira 3 → 4)
Rules.isManilha(card, manilhaRank)              // boolean
Rules.strength(card, manilhaRank, deck='limpo') // comuns: índice em DECKS[deck] (0..5 | 0..9); manilhas: 100 + índice do naipe em SUITS (100..103)
Rules.compare(a, b, manilhaRank, deck='limpo')  // -1 | 0 | 1  (comuns de mesmo rank empatam; naipe não importa)
Rules.label(card)                               // '7♥'
Rules.fullName(card, manilhaRank?)              // 'Sete de Copas' ou 'Zap (Dama de Paus)'
```
Carta encoberta vale −1 (tratada no motor, não em `Rules`).

## 3. `Truco.Engine` (js/core/engine.js) — máquina de estados pura

- Estado **JSON-serializável**, **determinístico** dado `seed` (PRNG próprio, ex.: mulberry32; nada de `Math.random` no motor).
- `apply` **muta** o estado e **retorna a lista de eventos**; lança `Error` (com `code`) em ação ilegal, sem alterar o estado.

```js
Engine.createMatch({ players: 2|4, seed: number, firstDealer?: seat, options?: { deck: 'limpo'|'sujo', format: 'single'|'bestOf3' } }) -> state
      // primeiro carteador: sorteado com o PRNG se firstDealer não for dado. state.phase: 'playing' | 'matchOver'
Engine.getDecision(state) -> Decision
Engine.legalActions(state) -> Action[]          // todas as ações válidas agora (útil para IA e testes)
Engine.apply(state, action) -> Event[]
Engine.viewFor(state, seat) -> View              // visão sem informação oculta (para IA e UI)
Engine.teamOf(seat) -> 0|1
Engine.nextSeat(seat, players) -> seat
Engine.clone(state) -> state                     // structuredClone/JSON
```

### Decision (o que o jogo espera agora)

```js
{ kind: 'startHand' }                                   // → {type:'START_HAND'}
{ kind: 'maoDeOnze', team, seats: [..] }                // time com 11 decide → {type:'MAO_DE_ONZE', seat, accept:boolean}
{ kind: 'play', seat, canCall: bool, callValue: 3|6|9|12|null, callName: 'Truco'|'Seis'|'Nove'|'Doze'|null,
  canFaceDown: bool, blind: bool, playableCardIds: [...] }
                                                        // → {type:'PLAY', seat, cardId, faceDown?:bool}  (ou index em vez de cardId; na mão de ferro, só index)
                                                        // → {type:'CALL', seat}   (pede truco/aumenta na sua vez)
{ kind: 'callResponse', team, seats: [..], callerSeat, currentValue, proposedValue, callName,
  canRaise: bool, raiseValue: 6|9|12|null, raiseName }  // → {type:'ACCEPT'|'RUN'|'RAISE', seat}  (qualquer seat de `seats`)
{ kind: 'matchOver', winnerTeam }
```

`seats` na resposta: todos os assentos do time que responde, em ordem de jogo a partir do jogador da vez (o primeiro é o "respondente designado", RULES.md §8.5). O controlador escolhe quem responde (humano se estiver no time). Em `maoDeOnze`, `seats` = time com 11 em ordem a partir do mão (§9.2).

### Eventos (sempre com `type`)

```js
{ type:'handStarted', handNumber, dealer, mao, vira, manilhaRank, hands: Card[][], value, special: null|'maoDeOnze'|'maoDeFerro', specialTeam }
{ type:'maoDeOnzeDecided', team, seat, accept, value }
{ type:'call', seat, team, from, to, name, isRaise }    // isRaise=true quando é resposta aumentando (ex.: "Seis!" em resposta a truco)
{ type:'accept', seat, team, value }
{ type:'run', seat, team, awardedTeam, points }
{ type:'cardPlayed', seat, card, faceDown, roundIndex, blind }
{ type:'roundEnded', roundIndex, winnerTeam: 0|1|null, winnerSeat: seat|null, winningCard, tie: bool, nextLeader }
{ type:'handEnded', winnerTeam: 0|1|null, points, reason: 'rounds'|'run'|'maoDeOnzeRun'|'allTied', score: [a,b], roundWinners: [..] }
{ type:'gameEnded', winnerTeam, score, gamesWon: [a,b] }      // um jogo de 12 terminou (sempre emitido antes de matchEnded)
{ type:'matchEnded', winnerTeam, score, gamesWon: [a,b] }     // partida acabou (single: após o 1º jogo; bestOf3: quem fizer 2 jogos)
```
Em `bestOf3`, após `gameEnded` sem fim de partida, o placar volta a 0×0 e a rotação do pé continua; o próximo `startHand` segue normalmente.
Placar real pode passar de 12 (ex.: 14); a UI mostra `min(score, 12)`.

Ordem garantida: `call` → (`accept` | `run`+`handEnded` | `call` isRaise ...). `cardPlayed` → (`roundEnded` → (`handEnded` → `matchEnded`?)?)?

### View (para IA e UI; nunca vaza carta escondida)

```js
{ players, deck, seat, team, score:[a,b], gamesWon:[a,b], handNumber, dealer, mao,
  vira, manilhaRank, value, special, specialTeam,
  myHand: Card[] | (blind ? [{hidden:true}...] : ...),
  partnerHand: Card[] | null,        // só na mão de onze, para o time com 11, em 4 jogadores
  handSizes: number[],               // cartas restantes por seat
  rounds: [{ leader, plays:[{seat, card|null, faceDown}], winnerTeam, winnerSeat, tie }],
  roundIndex, turn, pendingCall: null | {callerSeat, callerTeam, proposedValue, currentValue},
  lastCallTeam,                      // time que fez o último pedido (aceito ou pendente); não pode aumentar em seguida
  seenCards: Card[] }                // todas as cartas visíveis nesta mão (vira + jogadas abertas)
```

## 4. `Truco.AI` (js/core/ai.js)

```js
AI.create({ seat, difficulty: 'facil'|'medio'|'dificil', personality?: {bluff:0..1, caution:0..1}, seed }) -> bot
bot.decide(view, decision) -> Action                  // usa só `view` (sem trapaça)
bot.advise(view, decision) -> 'accept'|'run'|'raise'  // conselho do parceiro ao humano (callResponse / maoDeOnze → 'accept'|'run')
bot.phrase(kind) -> string                            // falas: 'call','raise','accept','run','winRound','loseRound','tie','maoDeOnzePlay','maoDeOnzeRun','idle'
AI.handStrength(cards, manilhaRank) -> 0..1           // utilitário exportado
```

## 5. `Truco.CardTex` (js/gfx/cardtex.js)

```js
CardTex.ready() -> Promise                 // espera fontes (document.fonts) e pré-gera texturas
CardTex.face(cardOrId) -> THREE.Texture    // cache; canvas ~512×716 (proporção 63:88), sRGB, anisotropy
CardTex.back() -> THREE.Texture
CardTex.faceCanvas(cardOrId) -> HTMLCanvasElement   // p/ HUD (miniaturas em diálogos)
CardTex.setRenderer(renderer)              // para anisotropia máxima
```

Baralho francês estilo Copag: índices nos cantos, pips corretos para A–7, figuras (J, Q, K) estilizadas desenhadas por código, Ás de espadas ornamentado. **Verso (decisão do usuário, 27/09): fundo preto liso com o símbolo de três quadrados vazados brancos sobrepostos na diagonal, bem no centro, sem nenhum texto; simétrico em 180°.** Não trocar. Cantos arredondados com transparência (alpha) OU a geometria recorta — ver seção 6.

## 6. `Truco.Scene` (js/gfx/*.js) — mundo 3D e animações

Toda a parte 3D: renderer, câmera, luz, ambiente de café/boteco, mesa, adereços, avatares, cartas 3D, feijões do placar, animações.

```js
const scene = Scene.create(stageEl, { players: 2|4, quality: 'high'|'low' })
scene.setup({ players, avatars: [{ seat, name, shirt:'#hex', skin:'#hex', hair:'#hex' }] }) // (re)monta assentos; seat 0 não tem avatar (é a câmera)
await scene.dealHand({ dealer, hands: Card[][], vira, blind: bool, deckSize: 24|40 })
      // embaralha, distribui 1 a 1 a partir do mão em sentido anti-horário, vira a vira sob o monte.
      // hands[0] = cartas do humano (viradas para ele, na "mão 3D" presa à câmera), outras = verso.
      // blind (mão de ferro): humano vê só o verso das próprias cartas.
await scene.playCard(seat, card, { faceDown, roundIndex, handIndex? })  // anima da mão até o slot da rodada
await scene.markRoundWinner(roundIndex, winnerSeat|null)               // brilho dourado; null = empate (tremida)
await scene.clearTable()                                               // recolhe tudo ao monte
scene.setHumanHand(cards, { interactive, playableIds, highlightManilhas, manilhaRank })
scene.onHumanPlay(cb)            // cb(cardId) quando humano clica/toca carta jogável
scene.setFaceDownMode(bool)      // visual: cartas da mão do humano marcadas "encobrir"
await scene.showPartnerHand(cards|null)   // mão de onze (4 jogadores): mostra cartas do parceiro para o humano
await scene.setScore([a,b], { animate })  // feijões (tentos) em cada lado
scene.avatarAct(seat, 'shout'|'think'|'win'|'lose'|'idle'|'nod'|'shake')
scene.seatScreenPos(seat) -> {x, y}       // px CSS, cabeça do avatar (seat 0: base central da tela)
scene.setTurn(seat|null)                  // indicação sutil de vez (luz/olhar)
scene.cameraPunch()                       // "tranco" da câmera no TRUCO
scene.avatarSignal(seat, gesto) -> Promise  // sinal de truco do parceiro (gestos em docs/PERSONAGENS.md)
scene.galaxySix() -> Promise              // galáxia de estrelas que forma um 6 sobre a mesa (js/gfx/galaxy.js); o controlador chama quando um pedido vai a 6
scene.setSpeed(mult)                      // multiplica velocidade das animações (1 = normal)
scene.setQuality('high'|'low')
scene.getRenderer() / scene.dispose()
```

- Loop de render próprio (requestAnimationFrame), `Truco.Tween.update(dt)` chamado nele.
- Mão do humano: cartas 3D presas à câmera, em leque na parte de baixo da tela (ocupa ~28% inferior da altura, centralizada); hover levanta; responsivo a retrato/paisagem.
- `Truco.Tween` (js/gfx/tween.js): `Tween.to(target, props, {duration, ease, delay}) -> Promise`, `Tween.update(dt)`, `Tween.ease.*`, `Tween.speed` global.

## 7. `Truco.HUD` (js/ui/hud.js + css/style.css)

Overlay DOM sobre o canvas. **Não cobrir o terço central inferior** (mão 3D do humano).

```js
const hud = HUD.create(hudEl)
await hud.showMenu(defaults) -> { players, deck:'limpo'|'sujo', format:'single'|'bestOf3', difficulty, speed, sound, voice, highlightManilhas, quality }
      // "Baralho: Limpo — 24 cartas (padrão, manilha limpa) / Sujo — 40 cartas"; "Partida: 1 jogo / Melhor de 3"
hud.setScore([a,b], gamesWon?)      // gamesWon só aparece em bestOf3
hud.setHandInfo({ value, vira, manilhaRank, special, roundResults: [0|1|'tie'|null, ...], dealerName, maoName })
hud.setActions({ visible, canCall, callName, canFaceDown, faceDown })   // botões do turno do humano
hud.onAction(cb)                    // cb('call') | cb('toggleFaceDown') | cb('menu') | cb('rules')
await hud.askCallResponse({ callerName, callName, proposedValue, currentValue, canRaise, raiseName, advice }) -> 'accept'|'run'|'raise'
await hud.askMaoDeOnze({ myCards, partnerCards, advice }) -> boolean
hud.speech(seat, text, { shout, ms })       // balão no avatar; posição via provider
hud.setSeatPosProvider(fn)                  // fn(seat) -> {x,y}
hud.setNames(namesBySeat)
hud.banner(text, { kind: 'truco'|'onze'|'ferro'|'info', ms })  // letreiro grande (Shrikhand)
hud.toast(text, { kind: 'good'|'bad'|'neutral', ms })
hud.setStatus(text)                         // "Sua vez", "Tião pensando…"
await hud.showMatchEnd({ winnerTeam, score }) -> 'again'|'menu'
hud.showRules()                             // modal "Como jogar" (a partir de docs/RULES.md, resumido)
hud.setSettings(settings) / hud.onSettings(cb)
```

## 8. `Truco.Audio` (js/ui/audio.js)

Sintetizado (WebAudio + speechSynthesis) por padrão. Arquivos gravados opcionais **substituem** o sintetizado
quando existem (guia para o usuário em `docs/AUDIO.md`): `audio/manifest.js` (gerado por `tools/audio-manifest.mjs`,
carregado antes de `audio.js`) define `Truco.AUDIO_MANIFEST = { sfx: { <som>: caminho }, vozes: { <id>: { '<momento>-<n>': caminho } } }`;
o build troca os caminhos por `data:` URIs. Toca por `HTMLAudioElement` (funciona em `file://`); erro → sintetizado.

```js
Audio.init()                         // chamar em gesto do usuário (pré-carrega os efeitos gravados)
Audio.play('shuffle'|'deal'|'flip'|'place'|'slide'|'bean'|'win'|'lose'|'tie'|'call'|'click'|'hover')  // audio/sfx/<som>.mp3 se houver
Audio.say(text, { seat, shout, voice: { pitch, rate }, clip: 'vini/truco-2' })  // clip = arquivo gravado; senão speechSynthesis pt-BR
Audio.preloadVoices(['tiao', 'vini', 'bia', 'voce'])  // pré-carga das falas gravadas do elenco
Audio.fileFor('sfx'|'vozes', chave)  // caminho do arquivo gravado ou null
Audio.status().files                 // { sfx, vozes, played, failed, broken, last: { kind, key, ok } }; evento window 'truco:audio-arquivo'
Audio.setMuted(bool); Audio.setVoice(bool); Audio.ambient(bool)   // burburinho de café (opcional, baixo)
```

O controlador acha o `clip` com `Personagens.chaveDeFala(p, momento, texto)` (posição da frase na ficha) e, para
os gritos fixos de quem joga, com `Game.HUMAN_CLIPS` (`'TRUCO!'` → `voce/truco-1`).

## 9. `Truco.Game` (js/main.js) — controlador

Laço assíncrono: `getDecision` → (humano via HUD/cena | bot via `AI` com tempo de "pensar") → `apply` → apresenta eventos em sequência (cena + HUD + áudio) → repete.

Parâmetros de URL para testes: `?autoplay=1` (seat 0 também é bot), `?speed=N`, `?seed=N`, `?players=2|4`, `?difficulty=`, `?skipMenu=1`, `?quality=low`.
Expõe `window.__truco = { state(), events: [], errors: [], decision() }` e captura `window.onerror` em `__truco.errors`.


## 10. Personagens

Fichas em `personagens/*.js` via `Truco.personagem({...})`, carregadas depois de `js/core/personagens.js` (`Truco.Personagens`). Contrato completo e guia em `docs/PERSONAGENS.md`. A tela "Personagens" do HUD (`hud.showPersonagens()`) usa `Truco.AvatarPreview` (`js/gfx/avatarpreview.js`). As configurações ganham `seats2`/`seats4` (quem senta onde) e `explainSignals`.
