# TrucAÍ

Truco paulista com **manilha limpa e suja**, todo em 3D, numa mesa de ferro na calçada de um boteco de São Paulo à noite. Você joga com e contra bots com personalidade. No 2×2, o parceiro padrão é o **Vini** (dev da AI Coders, de boné e óculos, fala de programação no meio do boteco) — dá para escolher outro parceiro no menu —, e os adversários são a **Bia** (estudante, atrevida no blefe) e o **Seu Tião** (bigodão, blefador). No 1×1, o adversário padrão é o Tião. A **Dona Cida**, o **Juninho** e a **Rosa** também estão no menu. Cada um é uma ficha de personagem, e você pode criar os seus (veja [Personagens](#personagens)).

Feito em HTML + [three.js](https://threejs.org) r159, sem servidor, sem build obrigatório e sem dependências npm. Texturas das cartas, cenário, personagens e sons são gerados por código; se você gravar efeitos e falas (por exemplo no ElevenLabs), eles substituem os sintetizados — veja [`docs/AUDIO.md`](docs/AUDIO.md).

## Como abrir

- **Direto do arquivo:** abra `index.html` no navegador (duplo clique serve; funciona em `file://`).
- **Arquivo único:** rode `node tools/build.mjs` e abra `dist/cafe-truco.html`. É o jogo inteiro num arquivo só, bom para mandar para alguém.

É preciso internet na primeira abertura: o three.js vem do jsDelivr e as fontes (Shrikhand, Barlow, Barlow Condensed) do Google Fonts. Enquanto carrega, a página mostra "TrucAÍ — arrumando a mesa…". As fontes não seguram a página: sem elas o jogo abre com fontes do sistema e troca quando elas chegam. Sem o three.js a mesa 3D não abre e aparece um aviso; se o navegador não abrir o WebGL, o aviso pede para ligar a aceleração por hardware ou trocar de navegador.

Testado no Google Chrome (inclusive headless, em tamanho de desktop, tablet e celular). Outros navegadores com WebGL e Web Audio devem funcionar, mas não foram testados.

## Como jogar

No menu inicial você escolhe:

| Opção | Valores |
|---|---|
| Modo | **2×2** com parceiro (padrão) ou **1×1** mano a mano |
| Quem senta à mesa | 1×1: o adversário; 2×2: o parceiro (à sua frente) e os adversários da direita e da esquerda. Padrão no 2×2: Vini (parceiro, à sua frente), Bia (esquerda) e Tião (direita); no 1×1, Tião. O parceiro padrão é o Vini, mas qualquer personagem pode ser escolhido |
| Baralho | **Limpo** — 24 cartas, padrão (Q J K A 2 3) · **Sujo** — 40 cartas (entram 4 5 6 7) |
| Partida | **1 jogo** até 12 pontos · **Melhor de 3** |
| Dificuldade | Fácil · Médio · Difícil (os adversários; o parceiro joga no mínimo no médio) |
| Velocidade | Calma · Normal · Rápida |
| Qualidade gráfica | Alta · Leve (sem sombras suaves, menos partículas). Sem preferência salva, celular e aparelho com pouca memória começam no Leve |
| Som, Voz, Destacar manilhas, Explicar os sinais | liga/desliga |

As escolhas ficam guardadas no navegador.

### Controles

| Ação | Mouse / toque | Teclado |
|---|---|---|
| Jogar uma carta | clique (ou toque) na carta da sua mão | `1`, `2`, `3` |
| Pedir truco / seis / nove / doze | botão **TRUCO!** (o nome muda com o valor) | `T` |
| Jogar a próxima carta encoberta | botão **Encobrir** (só aparece quando pode) | `E` |
| Responder a um pedido | **Cai!** (aceitar) · **SEIS!** (aumentar) · **Corro** | `C` · `S` · `R` (ou `Tab` + `Enter`) |
| Mão de onze | **Jogar** · **Correr** | `J` · `R` |
| Pausar / menu | ícone ☰ | `Esc` |
| Regras | ícone **?** | — |
| Som | ícone do alto-falante | — |

No menu de pausa, **Continuar** (ou `Esc`) volta ao jogo e já aplica o que você mudou em som, voz, destaque das manilhas, explicação dos sinais, velocidade e qualidade. Modo, baralho, partida, dificuldade e quem senta à mesa só valem numa partida nova: se você mexer neles, o botão principal vira **Nova partida com essas opções**. **Nova partida** recomeça com as opções marcadas, sem recarregar a página. Os diálogos de pedido e de mão de onze têm o link **Como funciona?**, que abre as regras por cima.

### Regras resumidas

A regra completa, com fontes e casos de teste, está em [`docs/RULES.md`](docs/RULES.md). O resumo:

- **Times:** no 2×2 você e o Vini (sentado à sua frente, o parceiro padrão) contra Tião e Bia. Joga-se no sentido anti-horário. Cada um recebe 3 cartas.
- **Vira e manilha:** depois de dar as cartas, vira-se uma carta. A **manilha** é o posto seguinte ao da vira, em círculo: Q → J → K → A → 2 → 3 → Q (no sujo: 4 → 5 → 6 → 7 → Q → J → K → A → 2 → 3 → 4). O naipe da vira não importa.
- **Força das manilhas:** Zap (♣ paus) > Copas (♥) > Espadilha (♠ espadas) > Pica-fumo (♦ ouros). Elas ganham de qualquer outra carta.
- **Cartas comuns:** 3 > 2 > A > K > J > Q (no sujo, depois vêm 7 > 6 > 5 > 4). O naipe não conta: cartas do mesmo posto **cangam** (empatam).
- **Rodadas:** a mão tem até 3 rodadas; ganha a mão quem fizer 2. Empatou a 1ª: a 2ª decide (se empatar de novo, a 3ª decide). Alguém venceu a 1ª e depois empatou (na 2ª ou na 3ª): leva quem venceu a 1ª. Três empates: ninguém marca (na mão de ferro, joga-se outra mão de ferro). **Pé** é quem deu as cartas; **mão**, quem joga primeiro.
- **Valor da mão:** 1 ponto. Na sua vez, antes de jogar, você pode pedir **Truco** (3). O outro time aceita (**Cai!**), corre (você leva o valor que valia antes) ou aumenta: **Seis** (6), **Nove** (9), **Doze** (12). Um time nunca aumenta duas vezes seguidas.
- **Carta encoberta:** a partir da 2ª rodada, quem não abre a rodada pode jogar a carta virada para baixo. Ela vale menos que tudo e não é revelada.
- **Mão de onze:** o time com 11 pontos vê as próprias cartas e as do parceiro e decide: **jogar** (a mão vale 3) ou **correr** (o outro time ganha 1). Ninguém pede truco.
- **Mão de ferro:** 11 a 11. Todos jogam **às cegas**, escolhendo a carta pela posição; quem vencer a mão leva o jogo.
- **Fim:** vence quem chegar a **12 pontos**. No melhor de 3, leva quem ganhar 2 jogos; o placar volta a 0×0 a cada jogo.

No 2×2, quando o seu time precisa responder a um pedido, quem decide é você; o parceiro dá o conselho dele dentro do diálogo (e o botão sugerido fica marcado). O diálogo também mostra as cartas que já estão na mesa, com quem jogou cada uma.

**Sinais do parceiro.** Como no truco de verdade, logo depois de dar as cartas o seu parceiro faz um sinal com o rosto se tiver carta forte (Zap, Copas, Espadilha, Pica-fumo ou um 3): um gesto só, o da carta mais forte. Com **Explicar os sinais** ligado, o jogo diz o que o gesto quer dizer ("Vini piscou — tem o Zap"). Os adversários não sinalizam, e não há sinal na mão de ferro nem na mão de onze do seu time.

## Personagens

Todo mundo que senta à mesa é descrito por uma **ficha**: nome, história, aparência (peças prontas e cores), jeito de jogar (estilo + blefe e cautela de 0 a 10), voz (tom e velocidade), falas por momento, sinais para o parceiro e relações com os outros. O guia completo, com todos os campos e o formato, está em [`docs/PERSONAGENS.md`](docs/PERSONAGENS.md).

- **No jogo:** menu → **Personagens**. Veja ou duplique os personagens do jogo, crie um do zero ou cole uma ficha; a prévia 3D mostra o personagem na hora e dá para testar o grito de truco, os sinais e a voz. **Salvar** guarda em "Meus personagens" (no navegador); **Copiar ficha** copia o texto para mandar a alguém. Depois escolha quem senta em cada lugar em **Quem senta à mesa**.
- **Num arquivo:** as fichas do jogo ficam em `personagens/` (`vini.js`, o exemplo completo; `tiao.js`, `bia.js`, `cida.js`, `juninho.js` e `rosa.js`, a ficha mínima). Para acrescentar alguém, copie um exemplo para `personagens/<id>.js` e ponha `<script src="personagens/<id>.js"></script>` no `index.html`, depois das outras fichas. A ficha mais simples é `Truco.personagem({ nome: 'Rosa' })`.

A ficha nunca quebra o jogo: valor que não existe vira o padrão, com um aviso em português ("blefe precisa ser um número de 0 a 10 e veio 15. Usei 10."), e só a falta do nome impede o personagem de entrar. O jogo lê a ficha sem executá-la como código.

## Parâmetros de teste (URL)

Acrescente ao endereço, por exemplo `index.html?skipMenu=1&players=2&deck=sujo`.

| Parâmetro | Efeito |
|---|---|
| `autoplay=1` | o seu lugar também é jogado por um bot (partida sozinha) |
| `skipMenu=1` | começa a partida direto, sem o menu |
| `speed=N` | multiplica a velocidade das animações e do "pensar" dos bots (ex.: `12`) |
| `seed=N` | semente fixa: embaralhamento e decisões dos bots se repetem |
| `players=2` ou `4` | 1×1 ou 2×2 |
| `deck=limpo` ou `sujo` | baralho |
| `format=single` ou `bestOf3` | 1 jogo ou melhor de 3 |
| `difficulty=facil`, `medio` ou `dificil` | dificuldade dos bots |
| `quality=low` ou `high` | qualidade gráfica |
| `mute=1` | sem som e sem voz |
| `startScore=A,B` | placar inicial (0 a 11 cada), ex.: `11,7` para cair direto na mão de onze e `11,11` na mão de ferro |

Os parâmetros da URL valem por cima das preferências salvas.

Para inspeção, a página expõe `window.__truco`:

- `state()`: cópia do estado do motor;
- `decision()`: o que o jogo espera agora;
- `waiting()`: o que se espera do humano (`'play'`, `'callResponse'`, `'maoDeOnze'`, `'matchEnd'` ou `null`);
- `phase()`: `'menu'`, `'playing'`, `'paused'` ou `'matchOver'`;
- `events` e `errors`: os eventos da partida atual e os erros capturados;
- `handPoints()`: posição na tela das cartas da sua mão;
- `seatPos(seat)`: posição na tela da cabeça de cada jogador;
- `settings()`: configurações em uso (som, voz, destaque, velocidade, qualidade, lugares…);
- `cast()`: ids dos personagens sentados em cada lugar; `signals`: sinais do parceiro feitos na partida;
- `controller`: o controlador da partida.

## Desenvolvimento

```
index.html           página do jogo (ordem de carga dos scripts)
css/style.css        estilos do HUD e da página
js/core/             regras (rules.js), motor puro (engine.js), bots (ai.js) e fichas de personagem (personagens.js)
personagens/         fichas dos personagens do jogo (uma por arquivo, carregadas pelo index.html)
js/gfx/              cena 3D: tween, cardtex, table, world, avatars, avatarpreview, cards3d, scene
js/ui/               HUD (hud.js) e áudio (audio.js: sintetizado, ou gravado quando houver arquivo)
audio/               áudio gravado opcional: sfx/, vozes/<personagem>/, manifest.js (gerado) e ROTEIRO.csv — docs/AUDIO.md
js/main.js           controlador da partida (Truco.Game)
docs/                arquitetura, regras, direção visual e contratos internos da cena
tests/               testes em node --test
tools/               build, teste de fumaça, harness do Chrome e páginas de prévia
```

Cada arquivo é um script clássico que pendura seu módulo em `window.Truco` (veja [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)). O motor é puro e determinístico; a cena, o HUD e o áudio só apresentam o que o motor decide.

### Testes

```sh
node --test tests/          # regras, motor, bots, personagens, controlador, tween, cenário, avatares, áudio
node tools/build.mjs        # gera dist/cafe-truco.html e dist/artifact.html
node tools/build.mjs --check  # sai com erro se dist/ estiver desatualizado
node tools/smoke.mjs        # partidas automáticas no Chrome headless + sessão humana roteirizada
```

- `tests/main.test.js` roda o controlador com o motor e os bots reais e uma cena/HUD falsos: partidas inteiras em autoplay, um "humano" de roteiro que clica, usa as teclas, pede truco, encobre e responde, mão de onze, mão de ferro, pausa, reinício e bot com defeito.
- `tools/smoke.mjs` usa `tools/cdp.mjs` (Chrome headless, sem dependências; no máximo 2 Chromes na máquina, numa fila global). Primeiro confere `build --check`. Joga 1×1 e 2×2, limpo e sujo, em 1280×800 e 390×844 (celular), e também o `dist/cafe-truco.html` e o `dist/artifact.html` no celular (se existirem). Falha se houver exceção, `console.error`, erro em `__truco.errors`, partida que não termina, rolagem horizontal ou viewport de celular ignorado. Também roda uma sessão com cliques e teclas reais (menu, truco, resposta, carta da mão 3D, encobrir, pausa, regras, nova partida) e um caso da tela Personagens (cria, salva, senta o personagem como parceiro e joga até o fim). Screenshots em `tmp/smoke/<caso>/`. Opções: `--only <trecho>`, `--concurrency N`, `--speed N`, `--block-fonts` (derruba o Google Fonts).
- A sessão humana mira elementos (seletor ou texto do botão) e as cartas pela posição que a cena informa (`__truco.handPoints()`), sem coordenadas fixas, e reage ao que os bots fizerem; vale com ou sem as fontes do Google. Se algo não aparecer, o caso aponta qual passo faltou. Rode um caso por vez: `node tools/smoke.mjs --only humano --concurrency 1`.
- Prévias isoladas: `tools/preview-scene.html`, `tools/preview-cards.html`, `tools/preview-hud.html`, `tools/preview-audio.html`.

O Chrome usado pelo harness fica em `/Applications/Google Chrome.app` (macOS); em outro sistema, defina `CHROME_PATH`.
