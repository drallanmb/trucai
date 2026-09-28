# TrucAÍ — Contratos internos da cena 3D

Complementa `docs/ARCHITECTURE.md` §6 (API pública `Truco.Scene`). Aqui está o que fica **dentro** da cena: quem cria o quê, em que referencial, e o contrato exato que `Truco.World` e `Truco.Avatars` precisam cumprir para serem trocados por versões mais ricas sem mexer em `scene.js` / `cards3d.js`.

Direção visual: `docs/DESIGN.md` **v2** (boteco paulistano, mesa de ferro vermelha "Garoa", placar de tampinhas). A base já segue a v2; o que falta (rua, fachada, skyline, garoa, adereços) é do World.

## 1. Arquivos e ordem de carga

| Ordem | Arquivo | Global | Papel |
|---|---|---|---|
| 1 | `js/gfx/tween.js` | `Truco.Tween`, `Truco.GfxUtil` | interpolação com promessas (usada por todos); relator de erros e espera de fontes |
| 2 | `js/gfx/cardtex.js` | `Truco.CardTex` | texturas das cartas (outro dono) |
| 3 | `js/gfx/table.js` | `Truco.Table` | mesa + utilitários de canvas/ruído |
| 4 | `js/gfx/world.js` | `Truco.World` | entorno (substituível) |
| 5 | `js/gfx/avatars.js` | `Truco.Avatars` | oponentes/parceiro (substituível) |
| 5b | `js/gfx/avatarpreview.js` | `Truco.AvatarPreview` | prévia 3D de um personagem (tela "Criar personagem"); só precisa vir depois de `avatars.js` |
| 6 | `js/gfx/cards3d.js` | `Truco.Cards3D` | cartas, mãos, monte, vira, placar, animações |
| 7 | `js/gfx/scene.js` | `Truco.Scene` | renderer, câmera, luz, laço, picking, API pública |

Todos leem os outros módulos **no momento do uso** (dentro de `Scene.create`), então a ordem só precisa garantir que tudo esteja carregado antes de `Scene.create`. Se `Truco.CardTex` não existir, `cards3d.js` usa um baralho simples em canvas; se `World.build` ou `Avatars.create` lançarem erro, a cena registra o erro (ver §7) e usa um substituto mínimo (a partida continua).

### `Truco.GfxUtil` (definido em `tween.js`, também em `Tween.util`)

```js
GfxUtil.report(err, where)            // Truco.reportError(err, where) se existir (→ __truco.errors); senão console.error
GfxUtil.fontsReady(fonts)             // true só se a família de cada fonte CSS está declarada E carregada
GfxUtil.onFonts(fonts, redraw, alive) // chama redraw() a cada família nova que terminar de carregar ('loadingdone')
GfxUtil.familyOf(font) / GfxUtil.loadedFamilies()
```

`document.fonts.check()` devolve `true` quando nenhuma face foi declarada (CSS das fontes ainda não chegou), por isso a cena não usa mais `check()` para decidir se uma textura com texto está pronta. Toda textura com texto (índices das cartas, guardanapos NÓS/ELES, logo Garoa do tampo, letreiros, lousa, placas) se inscreve em `onFonts` e é repintada quando Barlow/Shrikhand chegam, mesmo que o CSS chegue depois. Se as fontes nunca chegarem, ficam as de reserva. Exceção dentro do redesenho vai para `report(e, 'redesenho')` (não é confundida com "fonte indisponível").

## 2. Referencial e medidas

- 1 unidade = 10 cm. **Tampo da mesa em `y = 0`**. Chão em `Truco.Table.DIM.floorY` (−7,4).
- Mesa: quadrada, `Table.DIM.size` = 7,0 (70 cm), aba dobrada de 0,3 para baixo. Centro em `(0, 0, 0)`.
- Assentos (vista de cima, humano em +Z): `seatDir(seat)` = `[0,+1]`, `[+1,0]`, `[0,−1]`, `[−1,0]` para 4 jogadores; `[0,+1]`, `[0,−1]` para 2. Avatares ficam a `Scene.SEAT_RADIUS` = 5,0 do centro (`ctx.seatPosition(seat)`), olhando para o centro (`ctx.seatFacing(seat)`, rotação em Y tal que o +Z local do avatar aponta para a mesa).
- Carta: geometria 0,63 × 0,88 × 0,006 (face em +Z local, verso em −Z, "para cima" = +Y, cantos com raio 0,038 = raio do `CardTex`).
- **Escala de mesa**: cartas **sobre a mesa** (jogadas, monte, vira) são desenhadas maiores que o real para ficarem legíveis com a câmera que enquadra os avatares: `Cards3D.TABLE_SCALE` = 1,35 em paisagem e `Cards3D.TABLE_SCALE_PORTRAIT` = 1,85 quando a proporção da tela é < `Cards3D.PORTRAIT_ASPECT` (0,8), porque em retrato a câmera fica longe (os avatares laterais limitam a largura). `Cards3D.tableScaleFor(aspect)` escolhe; `setHandFrame` troca a escala na hora (`setTableScale`) e reposiciona o que já está no tampo; voos em andamento recalculam o alvo a cada quadro. A geometria é a mesma; só o `scale` do objeto muda. Leques dos oponentes usam escala 1; a mão do humano tem escala própria (presa à câmera).
- Na mesa, "face para cima" = rotação −90° em X; o topo da carta aponta para −Z (fica em pé para quem olha do assento 0). Face para baixo = a mesma pose girada 180° no eixo Y local.

### Mapa do tampo (`Cards3D.layout(players, tableScale?)`, puro, sem THREE)

`tableScale` padrão = 1,35 (paisagem). Com a escala de retrato o mapa muda (colunas "retrato") para as cartas maiores não invadirem monte, vira, fileiras de tampinhas nem adereços; `tests/world.test.js` confere as duas escalas.

| Elemento | Paisagem (1,35) | Retrato (1,85) | Observações |
|---|---|---|---|
| Monte (em repouso) | `deckHome` = (−0,12 × s; 0) | (−0,2625 × s; 0) | espessura = cartas restantes × 0,006 × s |
| Vira | `viraHome` = (0,28 × s; 0), yaw 90° | (0,1375 × s; 0) | por baixo do monte, saindo para a direita (em retrato o par fica centrado) |
| Monte na distribuição | `dealerSpot(seat)` = dir × 2,35 (frente/fundo) | idem | laterais: dir × (2,58 − 0,44 × s), aquém da fileira de tampinhas |
| Slot de jogo | `slot(seat, round)` = dir × R + (round−1) × (0,2 s; 0,12 s) | frente/fundo: (round−1) × (0,13 s; ±0,04 s); laterais: (round−1) × (0; 0,16 s) | R = 1,58/1,78 (paisagem) ou 1,83/1,86 (retrato); cada rodada fica por cima e deslocada, a anterior continua visível |
| Placar (tampinhas) | `capRow(team, i)`, x = ∓2,8, z de −2,25 em direção ao humano | idem | 12 posições, grupos de 3 separados por 0,14; time 0 ("Nós") à esquerda |
| Copo com tampinhas | `holder(team)` = (∓2,95; −2,95), cantos do fundo | idem | copo americano sobre guardanapo escrito "NÓS"/"ELES" (`napkin(team)`) |
| Zonas reservadas | `keepOut()` | idem | círculos/retângulos que **adereços do World não podem ocupar** (também em `ctx.table.keepOut`); cobre as duas escalas (`slotBounds(seat)` de cada uma) |

## 3. `ctx` — o contexto compartilhado

Criado por `Scene.create` e passado a `Table.build`, `World.build`, `Avatars.create` e `Cards3D.create`:

```js
ctx = {
  THREE,                 // global THREE (r159)
  scene,                 // THREE.Scene
  renderer,              // THREE.WebGLRenderer (sRGB, ACES, sombras PCFSoft/PCF)
  camera,                // THREE.PerspectiveCamera (está na cena; a mão do humano é filha dela)
  quality,               // 'high' | 'low' (atualizado por setQuality)
  envMap,                // PMREM de reserva da cena; null quando o World gera o dele (o normal: um PMREM só)
  players,               // 2 | 4 (atualizado em setup)
  lights: { key, fill, hemi, rim },
  table: { topY, rimTopY, size:{w,d}, playSize:{w,d}, floorY, keepOut:[...] },
  reducedMotion,         // prefers-reduced-motion no momento da criação
  seatPosition(seat, players?) -> Vector3,   // posição do avatar (y = 0)
  seatFacing(seat, players?) -> number,      // rotação Y do avatar
  sfx(name),             // dispara os ouvintes de scene.onSfx
  avatar(seat) -> avatar|null,
}
```

### Luzes (criadas pela cena, não pelo World)

| Nome | Tipo | Papel |
|---|---|---|
| `key` | SpotLight quente em (0; 9,6; 0,3), cone estreito, **única com sombra** | a lâmpada sobre a mesa |
| `fill` | PointLight quente sem sombra, perto da lâmpada | ilumina avatares fora do cone |
| `hemi` | HemisphereLight fraca: céu azul-noite (0x8fa3d6), chão âmbar escuro | ambiente com contraponto frio |
| `rim` | DirectionalLight alaranjada vinda do fundo, baixa (y = 3,2) | luz de sódio da rua (contraluz nas costas dos avatares, sem tingir o piso) |

O World **pode** mudar cor, intensidade e posição dessas luzes (por exemplo, pôr a lâmpada no toldo e mover `key.position` junto), acrescentar luzes próprias sem sombra e trocar `scene.background` / `scene.fog`. **Não pode** removê-las nem ligar `castShadow` em outras luzes (custo). A intensidade é física (`useLegacyLights = false` no r159).

O World atual: em retrato (`camera.aspect < 0,8`) a luminária (corpo, `key` e `fill`) sobe 2 un., com o ângulo do cone e a intensidade compensados (a poça de luz na mesa não muda), para não encostar na cabeça da parceira; volta sozinha em paisagem. Acrescenta uma PointLight fria sem sombra (0xa9c4ff, saindo do vão do bar), desligada em 'low'.

## 4. `Truco.World` — contrato

```js
World.build(ctx) -> {
  update(dt, t),         // todo quadro; dt e t em segundos
  dispose(),             // remove tudo o que criou e libera geometria/material/textura
  setQuality(q),         // 'high' | 'low' (menos partículas, texturas menores)
  setPlayers?(n),        // opcional: 2 | 4 (ex.: esconder cadeiras vazias)
  onEvent?(name, data),  // opcional: eventos de clima vindos de scene.worldEvent(name, data)
}
```

- `onEvent('contextRestored')`: a cena chama depois que o contexto WebGL volta; o World refaz o PMREM dele (render target só da GPU) e o repõe em `scene.environment`.
- `setQuality(q)` ao vivo: partículas, luzes internas e as texturas grandes (calçada, fachada, parede lateral) repintadas no tamanho da qualidade (a textura é descartada antes: `texStorage2D` do r159 é imutável). A quantidade de prédios/luzes do fundo e as texturas pequenas só mudam recarregando (são decididas na construção).
- **Chão**: o ladrilho antiderrapante da calçada paulistana (foto de referência do usuário): placas quadradas de `World.SIDEWALK.tile` = 2,5 (25 cm), alinhadas com a mesa, cada uma com 8 × 8 quadradinhos em relevo e sulcos entre eles. Três tipos de placa — toda branca, toda preta e dividida na diagonal (dois triângulos) — que formam faixas em zigue-zague (`World.sidewalkField(x, y)` / `World.sidewalkTile(i, j)`, puros e testados; o desenho repete a cada 4 placas = 1 m, e a fronteira preto/branco só passa pelas diagonais). `World.paintSidewalk(T, S)` pinta `color` (sRGB: preto e branco de verdade, quadradinhos lascados/gastos, sujeira nos sulcos, chiclete, manchas) e `data` (linear: R = altura → `bumpMap`, G = aspereza → `roughnessMap`). Úmido de garoa (brilho leve nas poças) mesmo sob o toldo; molhado de vez fora dele. Substitui o piso antigo com o mapa de SP.
- **Chuva**: nada de partícula de chuva perto da mesa, sob o toldo ou dentro do bar. A garoa existe só no fundo (`buildBackdrop`): na rua de baixo, contra a luz dos postes, do outro lado da mureta.
- A câmera de paisagem olha a mesa de quem está sentado (~35°): o topo do quadro fica ~8° abaixo do horizonte (a skyline ocupa uma faixa maior que antes, com 47°). Por isso a TV fica num rack na calçada, na quina do bar (`TV_SPOT`), e a lousa de preços do lado esquerdo (`BOARD_SPOT`), onde a câmera as vê fora dos painéis do HUD; o letreiro "TRUCAÍ · BAR E LANCHES" vai na faixa vermelha da frente do balcão. Orelhão, placa azul, postes de sódio e Copan ficam na camada de fundo presa ao olho (`buildBackdrop`), em escala que dê para reconhecer.

- Chamado **uma vez** em `Scene.create`, antes de qualquer avatar. Não depende de `players`.
- Tudo o que o World cria vai para `ctx.scene` (ou um grupo dentro dela). Nada de posicionar coisas dentro de `ctx.table.keepOut` nem acima do tampo entre y = 0 e y = 3 nessas zonas (as cartas voam por ali).
- A névoa deve acompanhar a distância da câmera (em retrato a câmera fica mais longe; ver `world.js`, `update`).
- A mesa (`table.js`) é da base. Quem cuidar do ambiente pode refinar a textura/forma dela, mantendo `DIM.topY = 0` e o tamanho útil.
- Sugestão de eventos para `onEvent`: `'truco'` (lâmpada balança/pisca), `'roundWon'`, `'handEnded'`. A cena não depende de nenhum.

## 5. `Truco.Avatars` — contrato

```js
Avatars.create(ctx, {
  seat, name, shirt, skin, hair,   // de scene.setup({ avatars }) (cores '#hex')
  style?,                          // formato antigo: 'bigode'|'bone'|'coque'|'topete' (ou só o cabelo)
  hairStyle?, face?, accessory?, outfit?, accent?,   // formato da ficha (docs/PERSONAGENS.md, apêndice)
  position: Vector3,               // ctx.seatPosition(seat)
  facing: number,                  // ctx.seatFacing(seat): o +Z local aponta para o centro da mesa
}) -> {
  group,                 // Object3D raiz, já adicionado em ctx.scene
  cardAnchor,            // Object3D onde a cena prende o leque de cartas do avatar
  headWorldPos(target?), // Vector3 do centro da cabeça em coordenadas de mundo
  act(kind) -> Promise,  // 'shout'|'think'|'win'|'lose'|'idle'|'nod'|'shake' (+ internos 'play' e 'deal');
                         //   também aceita o nome de um sinal (repassa para signal)
  signal(gesto) -> Promise, // sinal para o parceiro (abaixo)
  lookAt(point|null),    // olhar para um ponto do mundo; null = comportamento ocioso
  setTurn(bool),         // é a vez deste avatar (postura/olhar sutil)
  update(dt, t),         // todo quadro
  dispose(),             // remove de ctx.scene e libera recursos
  look,                  // visual resolvido (Avatars.resolveLook)
}
```

### Visual: `Avatars.resolveLook(spec)` (puro, testado em `tests/avatars.test.js`)

- **`style` válido** (formato antigo, o que o jogo usava): visual pronto de `Avatars.LOOKS` e os campos novos só sobrepõem. Os três avatares atuais saem idênticos.
- **Sem `style` válido e com `hairStyle`** (ficha): parte dos padrões da ficha — cabelo `curto`, rosto `nenhum`, `camisa-lisa`, acessório `nenhum`, barriga fixa.
- **Nenhum dos dois**: o estilo pronto do assento (1 `bigode`, 2 `coque`, 3 `topete`), como antes.
- Valores desconhecidos caem no padrão (nunca lança). Aceita acentos e maiúsculas (`'Chapéu-Panamá'`, `'óculos'`, `'Bigodão'`).
- Campos novos da ficha (todos opcionais; inválido = padrão, nunca lança):

```js
hairStyle: 'careca'|'curto'|'topete'|'coque'|'comprido'|'black'|'laterais'|'rabo-de-cavalo'
face:      'nenhum'|'bigode'|'bigodao'|'cavanhaque'|'barba'      // 'barba' = cheia, com o bigode junto
accessory: string | string[]   // valores: 'nenhum'|'bone'|'bone-frente'|'oculos'|'oculos-fino'|
                               //          'chapeu-panama'|'lapis-na-orelha'|'palito-na-boca'
capColor:  '#hex'              // cor do boné (bone e bone-frente); padrão = accent (senão derivada da camisa)
capMark:   'tres-quadrados' | null   // marca branca na frente da copa: o símbolo do verso das cartas
earrings:  true | false        // brincos (sem o campo: o do estilo; 'coque' tem)
lashes:    true | false        // cílios (dois traços no canto de fora do olho; fecham junto na piscada)
belly:     número 0..1         // barriga (0 = reto; padrão da ficha 0,4)
// ex. do Vini (parceiro, assento 2):
// { hairStyle: 'curto', face: 'barba', accessory: ['bone-frente', 'oculos-fino'],
//   capColor: '#1b1b1e', capMark: 'tres-quadrados', skin: '#e2b08a', hair: '#6a4a32',
//   shirt: '#1d1d24', outfit: 'camisa-lisa' }
// ex. de uma jovem (assento 3):
// { hairStyle: 'rabo-de-cavalo', lashes: true, earrings: true, belly: 0, accent: '#f2c230', ... }
```

- `accessory` em lista combina cabeça + rosto + orelha/boca. Grupos que se excluem (vale o último da lista): cabeça = `bone` | `bone-frente` | `chapeu-panama`; rosto = `oculos` | `oculos-fino`. `lapis-na-orelha` e `palito-na-boca` somam. `'nenhum'` na lista limpa o que veio antes. Valores desconhecidos são ignorados. String continua valendo como antes. `Avatars.ACCESSORY_GROUP` e `Avatars.CAP_MARKS` listam os grupos e as marcas.
- `look` resolvido ganha: `capFront` (bone-frente), `glassesThin` (oculos-fino), `capMark`, `lashes`, `colors.cap` (null = derivada) e `accessories` (lista final, na ordem cabeça, rosto, orelha, boca). `look.accessory` continua uma string (o último aplicado).
- `bone-frente`: a copa assenta como a do `bone` (frente logo acima das sobrancelhas) e a aba vai para a frente, quase na horizontal, curvada (laterais caindo); não faz sombra nos olhos. `bone` continua o de sempre (aba levantada). Os dois bonés e o chapéu **sobem junto com a sobrancelha** (acts e o sinal 'levantar-sobrancelha'), para nada atravessar a copa. Com boné: `topete` perde a franjinha no `bone-frente`, `coque` vira coque baixo, `black` fica espremido e o boné cresce 20%, `rabo-de-cavalo` sai pela abertura de trás.
- `oculos-fino`: aro metálico bem fino (prata), lentes grandes arredondadas-quadradas levemente curvadas, ponte dupla, plaquetas, lente de vidro quase transparente; as hastes passam por baixo da borda do boné. `oculos` (aro grosso marrom) continua igual.
- `rabo-de-cavalo`: cabelo puxado para trás com franja lateral, xuxinha na cor `accent` e o rabo em três gomos pelas costas.
- `outfit` aceita os nomes da ficha e devolve o nome interno: `camisa-lisa`→`lisa`, `camisa-listrada`→`listrada`, `camisa-de-time`→`time`, `regata`, `camisa-social`→`social`, `avental`.
- `accessory` liga um sinalizador: `bone`→`cap`, `oculos`→`glasses`, `chapeu-panama`→`panama`, `lapis-na-orelha`→`pencil`, `palito-na-boca`→`toothpick`; boné e chapéu se excluem; `nenhum` tira todos (o brinco do estilo `coque` não é acessório).
- Cores (`look.colors`): `'#abc'`, `'#aabbcc'` ou número 0..0xffffff; inválida → padrão (`skin` #c68a5e, `hair` #2b1d14, `shirt` #2f5d8a, `accent` null = derivada da camisa, `pants` por assento).

Peças: `regata` (cavas e decote pintados na textura, braços de pele, sem gola), `camisa-social` (colarinho em pé com pontas grandes, risca de giz na cor secundária, carcela com seis botões, bolso com lapela, manga dobrada), `avental` (casca creme por cima da camisa lisa, peitilho estreito e saia larga, alça do pescoço e cordão da cintura pintados na camisa, bolso duplo). Chapéu-panamá (copa com vinco, aba quebrada, fita escura) inclinado para trás como o boné (a aba não esconde os olhos na câmera alta); lápis em cima da orelha e palito no canto da boca do lado virado para a câmera (o palito balança). Combinações de cabelo com chapéu/boné: o `coque` vira coque baixo na nuca, o `topete` vira uma franjinha, o `black` fica mais baixo e o chapéu/boné cresce 20% para caber por cima. O `black` sem chapéu tem a linha do cabelo na testa (antes o volume cobria o rosto).

### Sinais (`avatar.signal(gesto)`)

`'piscar'` (um olho, com a sobrancelha descendo e sorriso de canto), `'levantar-sobrancelha'` (uma, bem alta e mais grossa), `'bochecha-com-lingua'` (bochecha de um lado estufa), `'ponta-da-lingua'` (pontinha rosa), `'levantar-ombro'` (um ombro sobe 0,5 com a cabeça inclinando), `'encher-bochechas'` (as duas), `'cocar-nariz'` (mão direita ao nariz, coçando; aceita `'coçar-nariz'`). ~0,9–1,1 s; durante o gesto o avatar olha para a câmera (ignora `lookAt`) e depois volta ao alvo/ócio. O lado do gesto é o virado para a câmera (laterais) ou o +X local (parceira). Exagerados para ler em 1280×800 com a cabeça da parceira a ~80 px. Interrompe e é interrompido como os acts; gesto desconhecido resolve na hora. Como `act` repassa nomes de sinal, **`scene.avatarAct(2, 'piscar')` já funciona** sem mudar `scene.js`.

### `ctx.tween` (opcional)

Relógio de animação no lugar de `Truco.Tween` (mesma API parcial: `to`, `run`, `kill`, `isTweening`, `ease`, `prefersReducedMotion`). A prévia (`Truco.AvatarPreview`) passa um próprio para não acelerar nem disputar o `Tween` global da mesa quando roda por cima dela.

Regras que a cena assume:

- **`cardAnchor`**: filho do avatar (acompanha o corpo), escala de mundo 1. O leque fica no **plano XY local** da âncora, com a base das cartas na origem e as cartas subindo em +Y. **+Z local aponta para o rosto do avatar** (as faces ficam para ele; os versos para a mesa/câmera). Inclinar a âncora em direção à câmera ajuda os versos a aparecerem (o stub faz isso). Posição típica: à frente do peito, ~1,6–2,2 acima do tampo, sobre a borda da mesa. A cena cria um grupo `fan-N` dentro da âncora; não mexa nos filhos dele.
- **Não cobrir o placar**: braços, mãos e leque devem ficar fora da vertical das fileiras de tampinhas (retângulos laterais de `keepOut`), senão a câmera não vê o placar. No stub, as mãos ficam a ~1,1 à frente do tronco, sobre a borda da mesa.
- **Altura da cabeça**: `headWorldPos` ≈ 3,5–4,2 acima do tampo. O enquadramento automático da câmera garante que todas as cabeças (+ folga de 0,95 em paisagem, 0,45 em retrato) caibam na tela; cabeças muito altas afastam a câmera e diminuem a mesa.
- **Pose de repouso já em `create`**: a cena enquadra a câmera logo depois de criar os avatares, usando `headWorldPos`; se a postura (inclinação, altura) só for aplicada no primeiro `update`, o enquadramento sai errado.
- `act` nunca rejeita e sempre resolve (um novo `act` pode interromper o anterior, resolvendo-o).
- `lookAt(point)` guarda uma cópia do ponto; a cena chama com cabeças de outros avatares, slots da mesa ou a posição da câmera (humano). O avatar atual limita o giro para o rosto continuar visível: até 1,1 rad (ou até a câmera) para o lado da câmera, no máximo 0,2 rad para o outro lado, e os laterais ainda puxam 35% do giro na direção da câmera; a cabeça inclina no máximo 0,25 rad para baixo; o resto do olhar vai para as pupilas. Nas olhadas ociosas, 50% vão para a câmera. Na cena, quando alguém joga, só o parceiro de quem jogou (e às vezes outro) acompanha a carta; os demais olham para quem jogou ou para o humano.
- Em retrato os laterais recuam as mãos e o leque 0,3 (a câmera alta via o braço por cima da fileira de tampinhas).
- `update` não deve alocar objetos por quadro.

### `Truco.AvatarPreview` (`js/gfx/avatarpreview.js`, depois de `avatars.js`)

```js
const pv = Truco.AvatarPreview.create(el, { quality: 'high'|'low', background: '#17110D'|'transparent', spec? })
pv.setSpec(spec)       // troca o avatar (libera geometria/material/textura do anterior)
pv.act(kind) / pv.signal(gesto) -> Promise   // sempre resolvem
pv.dispose()           // para o laço, desliga o ResizeObserver, libera tudo, renderer.dispose + forceContextLoss, tira o canvas
```

Renderer próprio dentro de `el` (canvas 100% × 100%, `data-block-3d`, `touch-action: pan-y`), um avatar sentado na cadeira "Garoa" simplificada (mesmas medidas da do World) com um leque de três cartas de costas, lâmpada quente de cima (sombra só em 'high'), preenchimento, céu/chão e contraluz de sódio. Câmera em retrato 3/4 (cabeça e tronco; distância calculada para caber em qualquer proporção). Balança sozinha ±~45° em torno do 3/4; arrastar (mouse/toque/caneta) gira, com inércia curta, e 2,5 s depois volta a balançar. Relógio de animação próprio (`makeTween()`), então não interfere na mesa. Sem WebGL: põe um aviso em `el` e devolve a mesma API sem efeito (`ok: false`). `pv.debug` (renderer, step, pause, info…) é só para `tools/preview-avatars.html`.

## 6. `Truco.Cards3D` — uso interno pela cena

`Cards3D.create(ctx)` devolve o controlador das cartas. `scene.js` só usa isto:

| Método | Uso |
|---|---|
| `setSeats(players, anchorsBySeat)` | em `setup`: zera a mesa na hora e cria os leques nas âncoras |
| `dealHand / playCard / markRoundWinner / clearTable / showPartnerHand / setScore` | animações da API pública (todas `async`) |
| `setHumanHand / setFaceDownMode` | estado da mão do humano |
| `setTurn(seat|null)` | brilho suave no tampo diante de quem joga |
| `setHandFrame({ fov, aspect })`, `handTopFraction()` | layout da mão presa à câmera (a mão ocupa a faixa inferior de 28%; a carta tem 90% dessa altura); também troca a escala de mesa (`setTableScale`, `tableScale()`) |
| `pickHuman(raycaster)`, `setHover(i)`, `requestPlay(i)`, `isInteractive()`, `setPointerKind(kind)` | picking; o tipo do último ponteiro ('touch' esconde as teclas 1/2/3) |
| `slotWorld(seat, round)`, `keepOut()`, `layout()` | pontos para olhar/enquadrar |
| `update(dt, t)`, `resetImmediate()`, `dispose()` | ciclo de vida |

Detalhes que valem para quem mexer aqui:

- **Mão do humano**: filhos da câmera, a 2,2 à frente, em leque (ordem Euler `ZYX`), `emissive` mais alto para ficarem legíveis fora do cone de luz. **Vez do humano** (`interactive`): a mão sobe 4% da altura do quadro até a faixa da mão (o topo continua em `handTopFraction()`, onde o HUD põe a pílula "Sua vez"), as jogáveis ganham um contorno dourado (#C9A15B) com pulso leve (sem pulso com reduced motion) e as não jogáveis ficam escurecidas (0,55). **Fora da vez** a mão fica 4% mais baixa e um pouco mais escura (0,85), sem contorno. Transição ~0,2 s. Com mouse (`(hover: hover)` e `(pointer: fine)`), em paisagem e se o último ponteiro não foi um toque, cada carta jogável mostra no pé um selo com a tecla 1/2/3 que a joga (índice em `hands[0]`, a mesma ordem do teclado do controlador). Hover levanta 14% da altura e traz para frente. Manilhas (com `highlightManilhas`) ganham halo aditivo + moldura dourada pulsando. `setFaceDownMode(true)` põe o véu listrado com "ENCOBERTA / NÃO VALE NADA" em pé na faixa esquerda de cada carta (a parte que o leque não cobre) e gira a carta um pouco. Em mão cega, as cartas mostram o verso.
- **Verso**: material próprio (cor base 0x8a8a8a, roughness 0,35, `envMapIntensity` 0,25, brilho próprio × 4 só nos quadrados brancos do mapa), para o preto não virar marrom sob a lâmpada quente. A textura é a do `CardTex` (decisão do usuário).
- **Leques**: filhos de `cardAnchor`; cartas dos oponentes têm verso nos dois lados até serem jogadas (nada vaza). `showPartnerHand` vira o leque do parceiro para a câmera, 1,7× maior, ao lado da cabeça da parceira (à direita na tela, na altura do rosto, sem cobri-lo), e depois devolve.
- **Distribuição**: `dealHand({ ..., quickShuffle })`: com `quickShuffle: true` o monte leva um corte curto (~0,35 s) no lugar do riffle completo (o controlador manda `false` na 1ª mão de cada jogo); o intervalo entre cartas é 0,08 s. Som 'shuffle' nos dois casos; respeita reduced motion e `Tween.speed`.
- **Voo**: `flight(mesh, getTarget, opts)` recalcula o alvo a cada quadro (câmera e avatares se mexem), com arco, giro e transição de brilho; ao chegar, a carta é re-parentada (câmera, leque ou mesa).
- **Encoberta**: pousa com o verso para cima; de oponente nunca recebe a textura da face.
- **Geração**: `resetImmediate()` (usado por `setup`/`dispose`) incrementa `state.gen`; toda continuação `async` confere a geração e desiste se a mesa foi zerada no meio, sem religar objetos descartados.

## 7. Garantias das funções `async` da API

- Todas resolvem (nunca rejeitam) quando a animação termina. Erros internos (promessa da cena, exceção num tween, textura de carta que falhou e caiu no desenho reserva, redesenho com fonte) vão para `Truco.reportError(err, where)` quando o controlador o define (→ `__truco.errors`), senão para `console.error`; a promessa resolve assim mesmo.
- Cada uma passa por `Tween.guard` com um teto de tempo proporcional à duração nominal / `Tween.speed` + 4 s.
- Se o `requestAnimationFrame` parar (aba em segundo plano), um `setInterval` avança o relógio das animações, então nada fica pendurado.
- `dispose()` encerra todos os tweens (resolvendo as promessas pendentes).
- `setSpeed(mult)` muda `Tween.speed` (vale na hora, inclusive para animações em curso).
- `setQuality(q)` ao vivo: pixel ratio, sombras, e repassa para `Table.setQuality` (tampo 2048 ↔ 1024), `World.setQuality` e `CardTex.setQuality` (cartas 512×716 ↔ 320×448; as mesmas texturas são recriadas na GPU). Pré-compila os shaders com `compileAsync` quando o navegador tem `KHR_parallel_shader_compile`. `prefers-reduced-motion` (ou `Tween.reducedMotion = true`) encurta as durações para 60%, desliga o tranco da câmera, a paralaxe e a respiração.

## 8. Câmera

```js
Truco.Scene.CAMERA = {
  landscape: { elev: 35, fov: 54, aspect: 1.45, headRoom: 0.95, xMax: 0.95, yMax: 0.9, handPad: 0.04, bodyOut: 1.2 },
  portrait:  { elev: 50, fov: 68, aspect: 0.55, headRoom: 0.7, xMax: 0.99, yMax: 0.58, handPad: 0.3, bodyOut: 0.5 },
  bodyY: 2.4, maxY: 17.5,
  hudAspect: 1,                  // em telas com proporção ≥ 1 vale a regra dos cantos do HUD
  hudFace: { r: 0.8, up: 0.45 }, // "rosto": meia-largura e quanto acima do centro da cabeça
  hud: [                         // cantos de cima ocupados pelo HUD (px CSS; altura = min(h, hFrac × altura))
    { side: -1, w: 256, h: 96, hFrac: 0.19 },   // placar
    { side: 1, w: 230, h: 184, hFrac: 0.37 },   // vira, manilha e rodadas
    { side: 1, w: 446, h: 68, hFrac: 0.18 },    // ícones (menu, ajuda, som)
  ],
}
```

- Elevação: paisagem 35° (antes 47°: pedido do usuário, "visão muito para cima"; agora é a altura de quem está sentado), retrato 50° (antes 68°). Com a câmera mais baixa ela chega mais perto (a mesa cresce na tela) e o fundo (skyline) ocupa uma faixa maior.
- **Cantos do HUD**: em paisagem, o rosto dos avatares (retângulo `hudFace` em volta de `headWorldPos`) não pode entrar nos retângulos de `CAMERA.hud` (o alto da cabeça/boné pode). Se o HUD mudar de tamanho, ajuste `CAMERA.hud` (vale na hora com `scene.debugReframe()`).
- A câmera é o olho do humano (assento 0). O enquadramento é calculado em `resize`/`setup` (`frameCamera`): para a elevação e o FOV da proporção atual (interpolados entre `Scene.CAMERA.portrait` e `Scene.CAMERA.landscape`), procura a menor distância em que: as cabeças dos avatares (com folga `headRoom`, menor em retrato) cabem abaixo do topo e dentro da largura (`xMax`), o corpo dos laterais (assento + direção para fora × `bodyOut`, na altura `CAMERA.bodyY`) cabe na largura, os cantos do fundo da mesa e as laterais cabem na largura, e a área de jogo do humano fica **acima** da faixa da mão. Com folga vertical (retrato), centraliza o conteúdo.
- Retrato: FOV 68°, `bodyOut` 0,5 (ombros podem ficar levemente cortados; as cabeças não) e a escala de mesa maior (§2): a carta jogada fica com ≥ 34 px em 390×844 e 360×740.
- Teto: a câmera fica abaixo do toldo (`CAMERA.maxY` = 17,5); se o enquadramento pedir mais alto, a elevação desce grau a grau até caber.
- Por quadro: paralaxe do mouse (só `pointerType: 'mouse'`), respiração leve e o "tranco" (`cameraPunch`: empurrão para frente + FOV + leve rolagem).
- `Scene.CAMERA` pode ser ajustado em tempo de execução; `scene.debugReframe()` recalcula.

## 9. Entrada (picking)

- Ouve `pointermove/down/up/cancel` na `window` e converte para o retângulo do canvas; funciona mesmo com o HUD por cima.
- Ignora eventos cujo alvo esteja dentro de `button, a, input, select, textarea, label, [role="button"], [role="dialog"], dialog, [data-block-3d]`. **O HUD deve marcar painéis que não podem "vazar" clique para a mesa com `data-block-3d`** (ou usar esses elementos/roles).
- Mouse: hover levanta a carta e o cursor vira `pointer`. Toque: `pointerdown` destaca, `pointerup` na mesma carta joga.
- Depois de um clique válido a mão fica não interativa até o controlador chamar `setHumanHand` de novo (evita jogada dupla). O callback recebe `(cardId, { index })`; em mão cega `cardId` é o id conhecido pela cena (vindo de `dealHand`) ou `null`, e `index` é a posição na mão.

## 10. Extras além do ARCHITECTURE.md

```js
scene.onContext(cb) -> unsubscribe // perda/restauração do contexto WebGL: cb('lost') e depois cb('restored').
                                //   A cena se recupera sozinha (o r159 reenvia texturas/geometrias; o PMREM
                                //   é refeito); o HUD usa isto para pausar e avisar.
scene.dealHand({ ..., quickShuffle: true })  // corte curto no lugar do riffle (ver §6)
scene.onSfx(cb) -> unsubscribe  // cb(name) sincronizado com a animação:
                                //   'shuffle' 'deal' 'flip' 'place' 'slide' 'bean' (tampinha pousando) 'hover'
scene.worldEvent(name, data)    // repassa para world.onEvent, se existir
scene.getCamera()
scene.debugReframe()            // só testes
scene.debugHandScreenPoints()   // só testes: centro das cartas da mão em px
Truco.Scene.CAMERA              // ajustes do enquadramento
Truco.Cards3D.layout(players, tableScale?)   // mapa do tampo (puro)
Truco.Cards3D.tableScaleFor(aspect)          // 1,35 em paisagem, 1,85 em retrato (< 0,8)
Truco.CardTex.setQuality('high'|'low')       // a cena chama em create/setQuality: 'low' pinta as cartas em 320×448
Truco.Table.tex                 // makeCanvas, noise, mulberry32, canvasTexture
```

`scene.seatScreenPos(seat)` devolve px CSS relativos ao elemento do palco: para avatares, um ponto logo **acima** da cabeça (limitado à área visível); para o assento 0, o centro da borda superior da faixa da mão.

## 11. Como testar

- Lógica: `node --test tests/` (inclui `tests/tween.test.js`).
- Visual: `tools/preview-scene.html` roda um roteiro (setup 4 → distribuir → mão/encobrir/parceiro → 3 rodadas → placar → recolher → setup 2 → distribuir sujo às cegas → jogada cega com empate). Parâmetros: `?step=N&hold=1` (para no passo N), `?speed=N`, `?quality=low`, `?engine=1` (usa `Truco.Engine` para a mão de 4), `?nocardtex=1` (testa o baralho de reserva). Expõe `window.__preview = { done, step, stepName, idle, holding, plays, sfx, errors }` e `window.__scene`.
- Exemplo: `node tools/cdp.mjs --url "tools/preview-scene.html?step=2&hold=1" --width 390 --height 844 --mobile --until "__preview.holding" --shot tmp/cena.png`.
- Cena com personagens da ficha: `preview-scene.html?specs=[null,{...Vini...},{...}]` (spec completo dos assentos 1, 2, 3; `null` mantém o padrão).
- Avatares: `tools/preview-avatars.html` — `?mode=grid` (elenco variado + a prévia do modal com seletores e botões de gesto), `?mode=matrix` (cabelo × acessório, `&view=head|side|front`), `?mode=outfits`, `?mode=signals` (um avatar por gesto), `?mode=preview&w=380&h=440` (só o modal), `?mode=custom&cells=[{label,view,spec,signal,gaze}]` (`gaze` = [x,y,z] no referencial do avatar; `view` também aceita `profile`, perfil puro). `&t=0.45` congela no instante t (para screenshot); espera `__avp.ready`. Sinais na câmera do jogo: `preview-scene.html?step=1&hold=1` e `__scene.avatarAct(2, 'piscar')`.
