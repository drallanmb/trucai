# TrucAÍ — Direção visual e sonora

## ⚠️ ATUALIZAÇÃO v2 (27/09) — o cenário agora é um BOTECO PAULISTANO. Esta seção PREVALECE sobre a seção "Conceito" abaixo e sobre qualquer instrução anterior que fale em "padaria", feltro verde ou lousa de padaria.

Pedido do usuário: "um buteco paulistano", com um ambiente em que dê para **identificar que é São Paulo ao fundo**, o **chão com o ladrilho da calçada de São Paulo**, **mesinha de bar dobrável de ferro (estilo mesa de cervejaria) ou mesa de plástico**, **estilo cerveja**, e uma **xicrinha de café** (lembrança das xicrinhas do café da manhã de lanchonete) **perto da mesa**.

**Composição da cena** (mesa na calçada, na porta do boteco — clássico de SP):
- **Chão**: o piso da calçada paulistana — ladrilho hidráulico preto e branco com o **contorno do mapa do estado de São Paulo** (o desenho de 1966 que cobre as calçadas da cidade). Textura procedural em canvas: placas quadradas de ~40 cm, cada uma com o mapa estilizado do estado (forma do estado de SP simplificada, em preto sobre branco e/ou branco sobre preto, alternando/rotacionando em padrão), com rejunte, desgaste, manchas e brilho de chão molhado. A mesa fica em cima desse piso.
- **Mesa**: mesa quadrada de **ferro dobrável pintada de vermelho** (~70×70 cm), com a marca **fictícia** de cerveja "**Garoa**" (logo em letra cursiva branca + faixa amarela; nunca use marcas reais como Brahma/Skol/Antarctica) no centro do tampo, tinta com arranhões, bordas dobradas, marcas redondas de copo e condensação. Pés de ferro em X/cantoneira dobráveis. As cartas são jogadas direto sobre o tampo vermelho (continua legível: cartas creme sobre vermelho). **Isto substitui o tampo de feltro/madeira** — quem cuidar do ambiente pode e deve alterar a mesa (table.js/scene.js) para isso, mantendo slots, monte e placar funcionando.
- **Cadeiras**: cadeiras de ferro dobráveis vermelhas combinando (com a mesma marca fictícia no encosto) atrás dos avatares.
- **Fundo (atrás do parceiro/adversário do topo)**: a **rua e a cidade de São Paulo à noite**: calçada continua, guia, rua com asfalto molhado refletindo luzes, **poste com luz de sódio laranja**, **orelhão** (a concha laranja/azul do telefone público), **placa de rua azul típica de SP** (retângulo azul, texto branco, ex.: "R. AUGUSTA" com o bairro "Consolação" embaixo), e no horizonte o **skyline**: prédios com janelas acesas, o **Edifício Copan** (fachada ondulada em S), um prédio alto tipo **Edifício Itália**, e **torres de antena da Paulista com luzes vermelhas piscando**. **Garoa** leve (partículas finas de chuva visíveis contra a luz do poste). De vez em quando um farol de carro passa ao longe.
- **Um dos lados (atrás de um adversário)**: a **fachada aberta do boteco**, com **porta de aço de enrolar** levantada, luz quente de dentro: **balcão** de fórmica/inox, **estufa de salgados** (coxinha, pastel, kibe — formas simples), prateleira com garrafas de pinga/cachaça e espelho, **TV num suporte de parede** passando futebol (retângulo verde com pontinhos se mexendo), **ventilador de teto**, azulejos brancos pequenos até meia altura, **freezer horizontal** de cerveja (marca fictícia Garoa), plaquinha "**FIADO SÓ AMANHÃ**", e um quadro de preços ("Cerveja 600 ml R$ 12 · Pinga R$ 5 · Porção de calabresa R$ 30 · Cafezinho R$ 3"). Letreiro pintado à mão na fachada: "**TRUCAÍ — BAR E LANCHES**" (Shrikhand).
- **Toldo** do boteco se estende sobre a mesa; dele pende a **lâmpada** (luminária simples de alumínio ou lâmpada nua com bocal) que faz o cone de luz quente com sombras sobre a mesa (SpotLight). Luz de sódio da rua como rim light laranja; luz fria da estufa/TV de dentro do bar.
- **Na mesa (fora das zonas de cartas/placar)**: **garrafa de 600 ml** âmbar com rótulo Garoa dentro de um **porta-garrafa térmico** (isopor/neoprene), **dois copos americanos** com cerveja (dourada, com espuma) — copo americano = vidro facetado característico; **porção de amendoim** ou torresmo num pratinho de alumínio; **paliteiro**; **porta-guardanapo de alumínio** triangular com guardanapos de papel; algumas **tampinhas** soltas.
- **Xicrinha de café perto da mesa**: uma **xicrinha pequena de cerâmica branca e grossa, com pires**, estilo das xicrinhas do café da manhã de lanchonete dos anos 90, com cafezinho preto e **vapor** subindo. Colocar **perto da mesa, não em cima**: por exemplo sobre um **engradado de cerveja de plástico** (caixa com as garrafas vazias) ao lado da mesa, servindo de mesinha auxiliar, bem visível pela câmera. Sem logotipo real de nenhuma rede; pode ter um friso colorido discreto.
- **Placar**: no lugar dos feijões, **tampinhas de cerveja** (tampa coroa com a borda serrilhada, douradas/prateadas com miolo colorido Garoa): tigelinha/copo com tampinhas por time e fileira de 12 posições. (Trocar só a geometria/material do marcador; a lógica do placar continua igual.)
- Tudo procedural (canvas/geometria), sem assets externos. Manter 60 fps.

- **Verso das cartas**: preto liso com o símbolo de três quadrados vazados brancos, sobrepostos na diagonal, no centro; sem texto. Já implementado em `js/gfx/cardtex.js` — não trocar.

A paleta continua válida, mas o "--felt" deixa de ser o tampo: o tampo é vermelho de mesa de cervejaria `#B3261E` com logo branco/amarelo `#F2C230`. Sons: acrescentar ao ambiente tilintar de garrafa/copo e burburinho de boteco.

### Atualização v3 (27/09)
- Nome do jogo: **TrucAÍ** (letreiro "TRUCAÍ · BAR E LANCHES", lousa e menu).
- **Piso**: placas de 25 cm com 8×8 quadradinhos em relevo, brancas, pretas ou divididas na diagonal, formando as faixas em zigue-zague da calçada paulistana (foto de referência do usuário) — substitui o "mapa de SP".
- **Chuva** só ao fundo, na rua; nada cai sob o toldo nem sobre a mesa.
- **Câmera** mais baixa, na altura de quem está sentado (~35° em paisagem).
- **Mesa padrão 2×2**: Vini (parceiro padrão, boné preto pra frente com os três quadrados, barba, óculos fininho), Bia à esquerda, Tião à direita.
- **Easter eggs nas cartas**: Dama de Copas homenageando o Hermes Agent, bananinha nos 2 (Nano Banana 2), Clawd no Ás de Espadas.

## Conceito (v1 — substituído pela atualização acima onde houver conflito)

Uma mesa de truco no fundo de uma **padaria/boteco paulistano, à noite**. Luz âmbar de uma luminária pendente de alumínio sobre a mesa, o resto do salão em penumbra quente. Na mesa: feltro verde-garrafa gasto com borda de madeira escura, **copo americano** com café pingado, xícara de cafezinho no pires, **açucareiro de vidro com tampa de metal**, **porta-guardanapo de alumínio**, e o placar marcado com **feijões** (tentos) — cada time tem sua tigelinha e sua fileira de feijões. Ao fundo, parede de **azulejos** até meia altura, um **letreiro pintado à mão "TRUCAÍ"** e uma lousa com preços ("Cafezinho R$ 3,00 · Pingado R$ 5,00 · Pão na chapa R$ 7,00").

Tudo em 3D real (Three.js), com sombras, reflexos no vidro/metal, vapor saindo do café, poeira dançando no cone de luz.

## Paleta (tema único escuro — escolha deliberada, não tem modo claro)

| Token | Hex | Uso |
|---|---|---|
| `--ink` | `#17110D` | fundo geral, texto sobre creme |
| `--espresso` | `#2B1D14` | painéis do HUD (com ~88% opacidade) |
| `--crema` | `#EBDDBF` | texto principal sobre escuro |
| `--paper` | `#F7F1E3` | papel das cartas, botões claros |
| `--felt` | `#1E4A38` | feltro da mesa |
| `--brass` | `#C9A15B` | dourado: destaques, manilhas, bordas finas |
| `--truco` | `#D2402F` | vermelho do grito de TRUCO, botão principal, naipes vermelhos |
| `--muted` | `#A8927A` | textos secundários |
| `--good` | `#6FBF73` / `--bad` `#E0694F` | resultados (semânticos) |

Vermelho de naipe nas cartas: `#C0272D`. Preto de naipe: `#1B1B1F`.

## Tipografia

- **Display**: `Shrikhand` (Google Fonts) — lembra letreiro pintado à mão. Só para gritos ("TRUCO!", "SEIS!"), banners ("MÃO DE ONZE"), título "TrucAÍ". Com contorno creme e sombra.
- **UI/texto**: `Barlow` 400/500/600.
- **Números e rótulos**: `Barlow Condensed` 600/700, `font-variant-numeric: tabular-nums`, rótulos em caixa-alta com `letter-spacing: .08em`.
- **Índices das cartas** (canvas): `Barlow Condensed` 700; fallback `"Arial Narrow", Arial, sans-serif`.

## Cena 3D

- Câmera na altura dos olhos do humano (seat 0), olhando a mesa em ~40–50°; leve paralaxe com o mouse/giroscópio; respiração sutil.
- Iluminação: SpotLight quente (≈2700K, `#FFB56B`) da luminária com sombras suaves; hemisférica fraca âmbar/azul-escuro; rim light fria bem sutil para destacar os avatares do fundo; tone mapping ACES, sRGB.
- Texturas procedurais (canvas): veio de madeira, feltro com ruído + normal map, azulejos, lousa.
- Avatares estilizados (low-poly simpáticos, sem rosto realista): cabeça, cabelo, tronco com camisa, braços segurando o leque de cartas (versos). Idle: respiração, olhar para quem joga. Ações: gritar (pulo + inclinação para frente), pensar (mão no queixo/inclinar), vencer/perder.
- Cartas: retângulo arredondado com espessura, frente/verso, sombra; leque na mão; ao jogar, arco com leve giro e "tapa" na mesa; manilhas na mão do humano podem ter brilho dourado sutil (opção "Destacar manilhas").
- Vira: sob o monte, girada 90° e parcialmente para fora (como na mesa real).
- Placar de feijões: 12 posições por time; ao pontuar, feijões voam da tigela para a fileira.

## HUD

- Painéis escuros `--espresso` com borda fina `--brass` a 30%, cantos 10px, sem sombra pesada.
- Topo-esquerda: placar "NÓS 5 × 7 ELES" + "Vale 3". Topo-direita: vira e manilha ("Vira 7♥ · Manilha Q"), marcadores das 3 rodadas (●/○/=).
- Botão **TRUCO!** vermelho, em Shrikhand, grande, com o nome dinâmico (TRUCO!/SEIS!/NOVE!/DOZE!). Botão secundário "Encobrir" (alterna carta virada), só quando permitido.
- Diálogo de resposta: "Tião pediu TRUCO! — vale 3" → [Cai! (aceitar)] [SEIS!] [Corro]. Conselho do parceiro em 2×2 aparece como balão.
- Balões de fala presos aos avatares.
- Menu inicial sobre a cena em câmera lenta: título "TrucAÍ" em Shrikhand, escolha 1×1 / 2×2, dificuldade (Fácil, Médio, Difícil), som, voz, velocidade, "Como jogar".
- Retrato (celular): placar compacto no topo, botões numa faixa acima da mão.
- `prefers-reduced-motion`: sem tranco de câmera, animações mais curtas.

## Som

Sintetizado (WebAudio): embaralhar (rajada de estalos), distribuir (flick), bater carta (thump + papel), virar, feijão (clink), acerto/erro (acordes curtos de violão/cavaquinho sintetizados), grito de truco (voz `speechSynthesis` pt-BR + impacto grave). Ambiente opcional: burburinho baixo de café, xícaras ao longe.
