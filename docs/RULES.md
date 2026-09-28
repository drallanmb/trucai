> **Mapeamento para o código (ler primeiro).** Este documento é a fonte da verdade das regras. No código, os identificadores seguem `docs/ARCHITECTURE.md` (em inglês):
> - `posto` → `rank` (`'4'..'7','Q','J','K','A','2','3'`); `naipe` → `suit`: paus=`'clubs'`, copas=`'hearts'`, espadas=`'spades'`, ouros=`'diamonds'`; id da carta = rank + letra do naipe (`'Qc'`, `'3h'`).
> - `baralho: 'limpo'|'sujo'` → `options.deck: 'limpo'|'sujo'` (padrão `'limpo'`); `formatoPartida` → `options.format: 'single'|'bestOf3'` (padrão `'single'`).
> - Time 0 = seats 0 e 2 ("Nós", humano no seat 0); time 1 = seats 1 e 3 ("Eles"). `proximo(s) = (s+1) % N` (anti-horário).
> - Pedido = ação `CALL`; respostas `ACCEPT` / `RUN` / `RAISE`; mão de onze = `MAO_DE_ONZE {accept}`.
> - O motor implementa **as regras padrão** (seções 1–11 e Apêndice B). Do Apêndice A, são obrigatórias só as chaves `deck` e `format`; as demais variantes não precisam ser implementadas.

# Especificação de Regras: Truco Paulista com "Manilha Limpa" (v1.0)

Documento normativo para implementar o motor de regras.
- **DEVE** marca uma regra obrigatória, **NÃO DEVE** uma proibição e **PODE** uma permissão.
- Nomes de código aparecem `entre crases`.
- Quando uma regra se apoia em inferência e não em fonte explícita, isso está indicado.
- O comportamento padrão é o descrito nas seções 1 a 11. Tudo o que for alternativo fica no Apêndice A (Variantes), acionado por configuração.

---

## 0. Resumo das decisões canônicas

| Tema | Decisão canônica | Justificativa curta |
|---|---|---|
| Significado de "manilha limpa" | Manilha **nova** (definida pela vira) + **baralho limpo** de 24 cartas | Nenhuma fonte usa esse termo. A leitura mais coerente junta os termos atestados "baralho/truco limpo" e "manilha nova". O resultado equivale ao "Truco Paulista Limpo" do app Truco Animado. O baralho sujo (40) fica como opção. |
| Formato | 2x2 (padrão); 1x1 como opção | O 2x2 é o formato canônico em todos os regulamentos. |
| Sentido do jogo | Anti-horário (joga em seguida quem está à **direita**) | Regulamentos paulistas: SINSEP, AABB-SP, UFSC, ASFO/UNESP e Pagat. |
| Vira 3 no baralho limpo | Manilha = Dama (Q) | Fecha o ciclo Q→J→K→A→2→3→Q. É inferência: nenhuma fonte trata o caso literalmente. |
| Carta encoberta | Proibida na 1ª rodada e para quem abre qualquer rodada. Vale −1: nunca vence nem empata. | Consenso sobre a 1ª rodada. A proibição para quem abre garante ao menos uma carta aberta por rodada. |
| Quem abre depois de rodada empatada | Quem pôs na mesa a **primeira** das cartas empatadas mais altas | É a regra mais específica (UFSC, AABB-SP, Pagat na parte geral). |
| Três rodadas empatadas | Ninguém pontua | Maioria: Jogatina, Copag, MegaJogos, Jogos do Rei, FPT, AABB, UFFS. |
| Quando pedir truco | Só na própria vez, antes de jogar a carta | Jogatina, MegaJogos, AABB-SP e Jogos do Rei. |
| Aumento depois de aceitar | Permitido (6/9/12 na própria vez, respeitando a alternância) | A AABB/UFSC restringe apenas **quem** pode aumentar, não **quando**. |
| Mão de onze | O time com 11 vê as cartas do parceiro e decide JOGAR (vale 3) ou CORRER (adversário +1). Ninguém pede truco. | Consenso. |
| Truco na mão de onze ou de ferro | Ação ilegal, bloqueada na interface e rejeitada pelo motor | É a forma mais segura para jogo digital. A penalidade existe como variante. |
| Mão de ferro (11x11) | Fechada (às cegas), sem truco, sem correr. Vale 1. Empate total leva a nova mão de ferro. | É o padrão dos apps e dos regulamentos mais citados. |
| Fim | Vence o jogo quem chega a 12 pontos ou mais. Partida padrão = 1 jogo; "melhor de 3" como opção. | O jogo de 12 é a unidade universal nas fontes. O melhor de 3 é típico de torneio. |

---

## 1. Significado de "manilha limpa"

### 1.1 O que as fontes dizem

O termo exato "manilha limpa" **não aparece** em nenhum dos lugares pesquisados:
- regulamentos: GameTrack, AABB-SP, SINSEP, ICT-Unesp/ASFO, UFFS, ATB/CAASP;
- enciclopédias: Wikipédia pt e en, Pagat;
- opções de apps: Jogatina, MegaJogos, Copag Play, TrucoON, Truco Inteligente, Truco Animado, Truco Blyts.

Os termos que existem de fato descrevem **duas dimensões independentes**:

| Dimensão | Valor | Sinônimos atestados | Definição |
|---|---|---|---|
| Composição do baralho | **Limpo** | meio baralho, baralho vazio, truco limpo | 24 cartas: Q, J, K, A, 2, 3 × 4 naipes |
| Composição do baralho | **Sujo** | baralho cheio, baralho completo, truco sujo | 40 cartas: 4, 5, 6, 7, Q, J, K, A, 2, 3 × 4 naipes |
| Sistema de manilha | **Nova** | variável, móvel, "puxada pela vira" | A manilha muda a cada mão conforme a vira (truco paulista) |
| Sistema de manilha | **Velha** | fixa | Manilhas sempre 4♣ > 7♥ > A♠ > 7♦, sem vira (truco mineiro) |

O GameTrack e a AABB-SP dizem que o truco paulista pode ser jogado com baralho sujo ou limpo. O Truco Inteligente e o TrucoON tratam baralho e manilha como ajustes independentes, o que dá 4 combinações.

### 1.2 Decisão

**"Truco paulista, manilha limpa" = manilha nova (definida pela vira) + baralho limpo de 24 cartas.**

- É a única combinação que junta "limpo" com o sistema de manilha do paulista, e corresponde ao "Truco Paulista Limpo" do Truco Animado.
- Todas as demais regras (pontuação 1/3/6/9/12, mão de onze, mão de ferro, empates) são as do Truco Paulista padrão. "Limpo" muda **apenas** a composição do baralho.
- O baralho **sujo** de 40 cartas é o padrão mais tradicional do paulista (Jogatina, MegaJogos, Copag, SINSEP, Wikipédia). O motor **DEVE** suportá-lo pela configuração `baralho: 'sujo'`.

### 1.3 Diferença para outras variantes

| Variante | Baralho | Manilha | Relação com esta especificação |
|---|---|---|---|
| **Paulista limpo** (este documento) | 24 | Nova (vira) | Padrão |
| Paulista sujo | 40 | Nova (vira) | Opção `baralho: 'sujo'` |
| Paulista com manilha fixa (Copag Play) | 40 | Fixa (4♣, 7♥, A♠, 7♦) | Fora do escopo |
| Truco mineiro | 40, ou limpo com as manilhas fixas mantidas (27 cartas) | Fixa | Fora do escopo |
| Truco argentino/uruguaio | 40 (com 8/9 em alguns casos), envido, flor | Fixa, própria | Fora do escopo |

### 1.4 Ponto a confirmar com o usuário

Como o termo é ambíguo, a interface **DEVE** expor a opção "Baralho: Limpo (24) / Sujo (40)", com Limpo como padrão. Se o usuário quis dizer "paulista padrão com manilha da vira", basta trocar para Sujo.

---

## 2. Baralho

### 2.1 Composição

- **Limpo (padrão):** 24 cartas = {Q, J, K, A, 2, 3} × {♣ Paus, ♥ Copas, ♠ Espadas, ♦ Ouros}. Ficam fora: 4, 5, 6, 7, 8, 9, 10 e curingas.
- **Sujo (opção):** 40 cartas = {4, 5, 6, 7, Q, J, K, A, 2, 3} × 4 naipes. Ficam fora: 8, 9, 10 e curingas.
- Nomes dos postos: Q = Dama, J = Valete, K = Rei, A = Ás. **No truco o Valete (J) vale mais que a Dama (Q).**
- Representação sugerida:
  - `{ posto: 'Q'|'J'|'K'|'A'|'2'|'3'|'4'|'5'|'6'|'7', naipe: 'paus'|'copas'|'espadas'|'ouros' }`
  - id textual, por exemplo `"Q-paus"`.

### 2.2 Contagens por mão (aritmética derivada)

| Formato | Distribuídas | Vira | Monte (limpo) | Monte (sujo) |
|---|---|---|---|---|
| 1x1 (2 jogadores) | 6 | 1 | 17 | 33 |
| 2x2 (4 jogadores) | 12 | 1 | 11 | 27 |
| 3x3 (6, opcional) | 18 | 1 | 5 | 21 |

### 2.3 Embaralhamento

- A cada nova mão, **todas** as cartas voltam ao baralho, que é embaralhado por inteiro.
- O embaralhamento usa Fisher–Yates com RNG uniforme, que deve aceitar semente para permitir testes.
- O baralho **NÃO DEVE** ser embaralhado entre as rodadas de uma mesma mão.
- O corte é apenas cosmético (ver 3.4).

---

## 3. Jogadores, parceiros, disposição, sentido, carteador, mão e rotação

### 3.1 Jogadores e times

- `N ∈ {4 (padrão), 2}`. O valor 6 existe como variante.
- Há sempre **2 times**, e cada jogador recebe 3 cartas.
- Os assentos são `s = 0..N-1`, e `time(s) = s % 2`.
  - Time 0 (assentos pares) inclui o humano, no assento 0. Na interface, "Nós".
  - Time 1 (assentos ímpares). Na interface, "Eles".
- 2x2: parceiros frente a frente, `{0,2}` contra `{1,3}`, alternados com os adversários.
- 1x1: `{0}` contra `{1}`, frente a frente.

### 3.2 Numeração e sentido

- Os assentos são numerados em **ordem anti-horária vista de cima**: `s+1` é o jogador sentado **à direita** de `s`.
- `proximo(s) = (s + 1) % N`.
- Esse sentido vale para distribuir, jogar e girar o carteador.
- Mapeamento visual sugerido para a cena 3D (2x2), com a câmera atrás do humano:

| Assento | Posição na tela | Quem é |
|---|---|---|
| 0 | Frente/baixo | Humano |
| 1 | Direita | Adversário |
| 2 | Fundo/topo | Parceiro |
| 3 | Esquerda | Adversário |

- No 1x1: assento 0 embaixo, assento 1 em cima.

### 3.3 Carteador ("pé")

- O **primeiro** carteador da partida é sorteado uniformemente entre os assentos.
- O carteador é chamado de **"pé"**.

### 3.4 Corte

- Quem corta é o jogador à **esquerda** do pé: `(pe - 1 + N) % N`.
- O corte é só animação: **NÃO** altera a aleatoriedade já produzida pelo embaralhamento.

### 3.5 "O mão"

- **O mão** é `(pe + 1) % N`, o jogador à direita do pé.
- Ele é o primeiro a receber cartas e **abre a 1ª rodada**. O pé joga por último na 1ª rodada.
- Atenção ao gênero:
  - "**a mão**" é a distribuição inteira, disputada em até 3 rodadas (`Mao` no código);
  - "**o mão**" é o jogador que abre (`jogadorMao` no código).

### 3.6 Rotação entre mãos

- Ao fim de **toda** mão, o baralho passa para a direita: `pe = (pe + 1) % N`. Assim, quem era "o mão" passa a ser o pé, e o novo mão é o jogador seguinte.
- A rotação acontece em todos os casos:
  - mão vencida normalmente;
  - mão encerrada porque alguém correu;
  - três empates;
  - mão de onze em que o time correu.
- Numa partida de vários jogos, a rotação **continua** de um jogo para o outro. Ela não é sorteada de novo.

---

## 4. Distribuição, vira e manilha

### 4.1 Sequência de uma mão

1. Recolher as cartas e embaralhar (2.3).
2. Fazer o corte (cosmético).
3. Distribuir 3 cartas fechadas a cada jogador, começando pelo **mão** e seguindo em sentido anti-horário até o pé.
   - A animação pode dar 1 a 1 ou 3 a 3 (o padrão de torneio, o "tombo"). Isso não muda o resultado.
4. Revelar a **vira**: a carta do topo do monte restante, virada para cima.
5. Calcular a manilha (4.3).
6. Determinar o tipo da mão (`normal | onze | ferro`, seção 9) e seguir o fluxo correspondente.

### 4.2 Vira

- A vira fica visível no centro da mesa durante toda a mão. A mão de ferro tem uma variante com vira oculta.
- A vira **não pertence** a nenhum jogador, **não** é jogada e **não** participa de nenhuma rodada.
- O **naipe da vira é irrelevante**. Apenas o posto importa.

### 4.3 Determinação da manilha (sequência circular)

```
ORDEM_LIMPO = [Q, J, K, A, 2, 3]
ORDEM_SUJO  = [4, 5, 6, 7, Q, J, K, A, 2, 3]
postoManilha = ORDEM[(indice(vira.posto) + 1) % ORDEM.length]
```

| Vira (limpo) | Q | J | K | A | 2 | 3 |
|---|---|---|---|---|---|---|
| **Manilha** | J | K | A | 2 | 3 | **Q** |

| Vira (sujo) | 4 | 5 | 6 | 7 | Q | J | K | A | 2 | 3 |
|---|---|---|---|---|---|---|---|---|---|---|
| **Manilha** | 5 | 6 | 7 | Q | J | K | A | 2 | 3 | **4** |

- As **4 cartas** do posto da manilha (uma de cada naipe) são as manilhas da mão, estejam elas na mão de alguém ou no monte.
- Como a vira é de outro posto, as 4 manilhas sempre existem no baralho.
- No limpo, "vira 3 → manilha Q" é **inferência** a partir de duas coisas:
  - a regra do sujo "vira 3 → manilhas voltam ao menor posto (4)";
  - a indicação de que no limpo "a escala começa na dama" (Truco Inteligente).

### 4.4 Ordem dos naipes (só entre manilhas) e apelidos

Da mais forte para a mais fraca: **Paus ♣ > Copas ♥ > Espadas ♠ > Ouros ♦**. O mnemônico é "PA-CO-ES-OU".

| Naipe | Força entre manilhas | Nome canônico na interface | Sinônimos regionais |
|---|---|---|---|
| Paus ♣ | 3 (maior) | **Zap** | Gato, Zorro |
| Copas ♥ | 2 | **Copas** | Copeta, Copilha, Escopeta, Copão |
| Espadas ♠ | 1 | **Espadilha** | Espada, Espadão |
| Ouros ♦ | 0 (menor) | **Pica-fumo** | Mole, Picafumo, Ourinho, Salmoura |

---

## 5. Hierarquia de força e empate de cartas

### 5.1 Regra geral

1. As **manilhas** valem mais que qualquer carta comum, inclusive o 3. Entre si, obedecem à ordem de naipe (4.4). **Duas manilhas nunca empatam.**
2. As **cartas comuns** (todas as que não são manilha) seguem esta ordem, da maior para a menor, **sem considerar o naipe**:
   - limpo: 3 > 2 > A > K > J > Q;
   - sujo: 3 > 2 > A > K > J > Q > 7 > 6 > 5 > 4.

   O posto que virou manilha sai da ordem comum durante aquela mão.
3. **Empate de cartas ("cangar"):** duas cartas comuns do mesmo posto têm força idêntica, por exemplo 3♣ = 3♦. O naipe **nunca** desempata cartas comuns.
4. **Carta encoberta** tem força −1. Nunca vence e nunca empata.

### 5.2 Função de força

```js
const ORDEM = { limpo: ['Q','J','K','A','2','3'], sujo: ['4','5','6','7','Q','J','K','A','2','3'] };
const FORCA_NAIPE = { ouros: 0, espadas: 1, copas: 2, paus: 3 };

function forca(jogada, postoManilha, baralho) {
  if (jogada.encoberta) return -1;
  const c = jogada.carta;
  if (c.posto === postoManilha) return 100 + FORCA_NAIPE[c.naipe];   // 100..103
  return ORDEM[baralho].indexOf(c.posto);                             // limpo 0..5, sujo 0..9
}
```

### 5.3 Exemplos de hierarquia completa (da menor para a maior)

- Limpo, vira K (manilha A): Q < J < K < 2 < 3 < A♦ < A♠ < A♥ < A♣.
- Limpo, vira 3 (manilha Q): J < K < A < 2 < 3 < Q♦ < Q♠ < Q♥ < Q♣.
- Sujo, vira 5 (manilha 6): 4 < 5 < 7 < Q < J < K < A < 2 < 3 < 6♦ < 6♠ < 6♥ < 6♣.

---

## 6. Rodadas (vazas)

### 6.1 Estrutura

- Uma mão tem **até 3 rodadas**.
- Em cada rodada, cada jogador joga **exatamente 1 carta**, em ordem anti-horária a partir do **abridor** da rodada.
- A rodada só é apurada depois que os N jogadores jogaram. Não há apuração antecipada dentro da rodada, nem mesmo quando o Zap já foi jogado.

### 6.2 Abridor

- 1ª rodada: o **mão** (3.5).
- 2ª e 3ª rodadas: o jogador `S[0]` da rodada anterior (6.5). Isso vale para vitória e para empate.

### 6.3 A vez do jogador

Na sua vez, o jogador:
1. **PODE** iniciar um pedido de truco ou aumento, se as condições de 8.3 forem satisfeitas;
2. **DEVE** jogar uma das cartas que tem na mão, aberta, ou encoberta quando isso for permitido (6.6).

Além disso:
- **Não há** obrigação de seguir naipe nem de jogar carta maior. A escolha é livre.
- Enquanto houver pedido pendente, **ninguém** joga carta. O jogo fica suspenso até a resposta.

### 6.4 Apuração da rodada

O mesmo algoritmo vale para 1x1 e 2x2:

```js
function resolverRodada(jogadas /* em ordem de jogo */, postoManilha, baralho) {
  const abertas = jogadas.filter(j => !j.encoberta);            // sempre >= 1 (ver 6.6)
  const F = Math.max(...abertas.map(j => forca(j, postoManilha, baralho)));
  const S = abertas.filter(j => forca(j, postoManilha, baralho) === F); // em ordem de jogo
  const times = new Set(S.map(j => j.time));
  return {
    resultado: times.size === 1 ? S[0].time : 'EMPATE',
    proximoAbridor: S[0].jogador,
  };
}
```

- **2x2:** só importa a maior carta aberta de cada time. As cartas que não são a maior da rodada não afetam nada, mesmo que duas delas sejam iguais.
- **Parceiros com a mesma maior carta** (por exemplo 3 e 3 do time 0, com o time 1 abaixo): **não** há empate. O time vence, e o jogador vencedor é o parceiro que jogou primeiro.
- **Empate** acontece somente quando S contém jogadores **dos dois times**. Como manilhas nunca empatam, isso só é possível com cartas comuns do mesmo posto.
- **1x1:** a rodada tem 2 cartas. Há empate se ambas são comuns do mesmo posto.

### 6.5 Quem abre a rodada seguinte

`proximoAbridor = S[0].jogador`, o primeiro jogador, em ordem de jogada, entre os que empataram na maior força.
- Rodada vencida: abre quem jogou a carta vencedora. Se foram parceiros com cartas iguais, abre o que jogou primeiro.
- Rodada empatada: abre quem pôs na mesa a **primeira** das cartas empatadas mais altas.
- No 1x1, depois de um empate, isso equivale a "abre quem abriu a rodada empatada".

### 6.6 Carta encoberta (coberta, "no escuro")

| Situação | Permitido? |
|---|---|
| 1ª rodada, qualquer jogador | **NÃO** |
| 2ª ou 3ª rodada, jogador que **abre** a rodada | **NÃO**: a primeira carta de toda rodada é aberta |
| 2ª ou 3ª rodada, demais jogadores | **SIM** |
| Depois de rodada empatada | **SIM** (padrão FPT/ATB; há variante no Apêndice A) |
| Mão de onze | **SIM** (regra geral; há variante no Apêndice A) |
| Mão de ferro fechada | **NÃO** se aplica: ninguém vê as próprias cartas |

- A carta encoberta é colocada face para baixo e **não** é revelada aos outros jogadores, nem no fim da mão. O motor conhece a carta, mas os bots adversários **NÃO DEVEM** ter acesso a ela.
- Força −1: é desconsiderada na apuração (6.4).
- Por que o abridor não pode encobrir: a regra resolve a frase ambígua "a primeira carta da rodada nunca pode ser encoberta" (Truco Inteligente) e a regra ASFO/UNESP. Além disso, garante ao menos uma carta aberta por rodada, evitando uma rodada toda encoberta, caso que nenhuma fonte resolve.

### 6.7 Informação pública

- Cartas abertas já jogadas são informação pública durante a mão. A interface **PODE** mantê-las visíveis diante de cada jogador.
- Cartas não jogadas quando a mão termina **NÃO DEVEM** ser reveladas.

---

## 7. Resolução da mão (incluindo todos os empates)

### 7.1 Algoritmo

Aplicado depois de **cada** rodada. `r` é a lista de resultados até o momento, com valores `0`, `1` ou `'EMPATE'`.

```js
function resolverMao(r) {
  const v0 = r.filter(x => x === 0).length;
  const v1 = r.filter(x => x === 1).length;
  const e  = r.filter(x => x === 'EMPATE').length;
  if (v0 === 2) return 0;
  if (v1 === 2) return 1;
  if (e >= 1 && v0 + v1 >= 1) return r.find(x => x !== 'EMPATE'); // time da PRIMEIRA rodada vencida
  if (r.length === 3) return 'NINGUEM';                             // 3 empates
  return null;                                                      // joga a próxima rodada
}
```

### 7.2 Tabela completa de casos

X e Y são os dois times, e E indica empate. Cada caso vale também com os papéis trocados.

| 1ª | 2ª | 3ª | Vencedor da mão | Observação |
|---|---|---|---|---|
| X | X | — | X | A 3ª não é jogada |
| X | Y | X | X | |
| X | Y | Y | Y | |
| X | Y | E | **X** | Empate na 3ª: vence quem ganhou a 1ª |
| X | E | — | **X** | Empate na 2ª: vence quem ganhou a 1ª; a 3ª não é jogada |
| E | X | — | **X** | Empate na 1ª: a 2ª decide; a 3ª não é jogada |
| E | E | X | **X** | 1ª e 2ª empatadas: a 3ª decide |
| E | E | E | **Ninguém** | Nenhum ponto, nem o valor trucado |

Além da tabela:
- Em qualquer momento, **correr** de um pedido encerra a mão (8.7).
- Na mão de onze, correr na decisão inicial também encerra a mão (9.2).

### 7.3 Quem abre depois de um empate

É o jogador que pôs na mesa a **primeira** das cartas empatadas mais altas (6.5).

Exemplo 2x2, ordem de jogo 0, 1, 2, 3, baralho limpo, vira Q (manilha J):

| Jogador | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| Carta | K | 3♠ | 3♥ | 2 |

S = {1, 2}, com os dois times representados, então a rodada **empata**. **O jogador 1 abre** a próxima rodada.

### 7.4 Fim antecipado

- A mão termina **no instante** em que o resultado fica decidido: 2 vitórias, ou 1 vitória com 1 empate.
- As cartas restantes não são jogadas nem reveladas.
- A 3ª rodada só acontece em dois casos: 1–1, ou 1ª e 2ª empatadas.

### 7.5 Pontuação

- O time vencedor da mão soma o **valor vigente** (`valor`, seção 8).
- Com três empates, ninguém soma nada, e o jogo segue para a próxima mão com rotação normal.

---

## 8. Truco e aumentos

### 8.1 Escada de valores

| Pedido | Valor antes | Valor se aceito | Se o desafiado correr, quem pediu ganha | Fala típica |
|---|---|---|---|---|
| **Truco** | 1 | 3 | 1 | "Truco!" |
| **Seis** | 3 | 6 | 3 | "Seis!", "Meio-pau!" |
| **Nove** | 6 | 9 | 6 | "Nove!", "Nove neles!" |
| **Doze** | 9 | 12 | 9 | "Doze!", "Queda!" |

- Os únicos valores possíveis de uma mão são 1, 3, 6, 9 e 12.
- Cada pedido sobe **exatamente um degrau**. **NÃO** se pode pular, repetir nem voltar.
- Não existe valor acima de 12.
- Na mão seguinte, o valor volta a 1, exceto na mão de onze (9.2).

### 8.2 Estado da aposta, por mão

```
valor             ∈ {1,3,6,9,12}   // último valor ACEITO
ultimoPedidoPor   ∈ {null, 0, 1}   // time que fez o último pedido nesta mão
pendente          = null | { porTime, proposto }
pedidoIniciadoNestaVez: boolean     // zera quando a vez passa
tipoMao           ∈ {'normal','onze','ferro'}
```

### 8.3 Quem pode pedir e quando

O jogador J **PODE** pedir se, e somente se, todas as condições abaixo forem verdadeiras:
1. é a vez de J e ele ainda não jogou carta nesta vez;
2. `pendente === null`;
3. `tipoMao === 'normal'`;
4. `valor < 12`;
5. `time(J) !== ultimoPedidoPor` (alternância);
6. `!pedidoIniciadoNestaVez`: cada vez comporta no máximo **uma** sequência de pedido iniciada pelo jogador da vez. Qualquer aumento adicional deveria ter sido dado como resposta.

Observações:
- Vale em qualquer rodada, inclusive na primeira carta da mão ("trucar de mão").
- O parceiro de J **NÃO** pode pedir na vez de J.
- Não há outra restrição por placar (8.9).

### 8.4 Respostas

Só o time desafiado responde (`1 - pendente.porTime`). Ele tem 3 opções:

| Resposta | Efeito |
|---|---|
| **ACEITAR** ("Cai!", "Venha!", "Manda!", "Aceito!") | `valor = pendente.proposto`; `pendente = null`. O jogo retoma com o **mesmo** jogador da vez, que agora joga sua carta. |
| **CORRER** ("Corro!", "Não quero!") | A mão termina imediatamente. O time `pendente.porTime` ganha `valor`, o último valor aceito (8.7). As cartas não são reveladas. |
| **AUMENTAR** (só se `pendente.proposto < 12`) | Aceita e sobe ao mesmo tempo: `valor = pendente.proposto`; `pendente = { porTime: timeDesafiado, proposto: próximo(valor) }`; `ultimoPedidoPor = timeDesafiado`. Agora o outro time responde, com as mesmas 3 opções. |

- A resposta ao **Doze** é só ACEITAR ou CORRER.
- CORRER **não** é uma ação livre: só existe como resposta a um pedido pendente ou na decisão da mão de onze.

### 8.5 Quem responde (1x1 e 2x2)

- **1x1:** o adversário.
- **2x2:** o pedido é do **time**. Qualquer jogador do time desafiado pode responder, e vale a **primeira** resposta dada. Implementação:
  - Se o humano está no time desafiado, **o humano responde**. O bot parceiro **PODE** emitir uma fala de sugestão, que não o vincula.
  - Caso contrário, responde o **respondente designado**: o primeiro jogador do time desafiado em ordem de jogo a partir do jogador da vez. No pedido inicial, esse é o adversário à direita de quem pediu.
- O time que pediu nunca responde ao próprio pedido.

### 8.6 Depois do aceite

- A vez **não muda**: o jogador que estava para jogar quando a sequência começou joga sua carta.
- Por causa da condição 8.3(6), ele não inicia novo pedido nesta mesma vez.

### 8.7 Pontos quando alguém corre

`pontos = valor`, o último valor aceito. O valor proposto e pendente não conta.

Exemplos, com os times A e B:
- A pede truco, B corre: A ganha **1**.
- A pede truco, B pede seis, A corre: B ganha **3**, porque ao pedir seis B já tinha aceitado o 3.
- A pede truco, B pede seis, A pede nove, B pede doze, A corre: B ganha **9**.

### 8.8 Alternância e aumento posterior

- Um time **nunca** aumenta duas vezes seguidas. Só pode aumentar o time que **não** fez o último pedido.
- A única sequência que leva a 12 é: time 1 pede truco, time 2 pede seis, time 1 pede nove, time 2 pede doze, e o time 1 aceita ou corre.
- **Aumento posterior (padrão):** o time com direito de aumentar pode fazê-lo em dois momentos:
  - como resposta imediata (AUMENTAR);
  - **mais tarde na mesma mão**, na vez de qualquer um de seus jogadores, antes de jogar a carta, via 8.3.

  Exemplo: A pede truco e B aceita (vale 3). Na próxima vez de um jogador de B, ele pode pedir "Seis!". Depois disso, só A pode pedir nove.

### 8.9 Limites perto de 12

- O valor máximo de uma mão é 12.
- **Não há** restrição de pedido por placar. Um time com 10 pontos (ou qualquer placar abaixo de 11) **PODE** trucar e aumentar, mesmo que o valor passe do necessário para vencer.
- O placar **PODE** ultrapassar 12. Por exemplo, 10 + 3 = 13 vence.
- Quando algum time tem 11, a mão é de onze ou de ferro e **nenhum** pedido é permitido (seção 9).

### 8.10 Pseudocódigo

```js
const PROXIMO = { 1: 3, 3: 6, 6: 9, 9: 12 };

function podePedir(m, j) {
  return m.vez === j && !m.jogouNestaVez && !m.pedidoIniciadoNestaVez
      && m.pendente === null && m.tipoMao === 'normal'
      && m.valor < 12 && m.ultimoPedidoPor !== time(j);
}
function pedir(m, j) {
  m.pendente = { porTime: time(j), proposto: PROXIMO[m.valor] };
  m.ultimoPedidoPor = time(j);
  m.pedidoIniciadoNestaVez = true;
}
function responder(m, timeResp, resp) {
  const p = m.pendente;                       // exige timeResp === 1 - p.porTime
  if (resp === 'ACEITAR') { m.valor = p.proposto; m.pendente = null; }
  else if (resp === 'CORRER') { encerrarMao(m, { vencedor: p.porTime, pontos: m.valor }); }
  else if (resp === 'AUMENTAR' && p.proposto < 12) {
    m.valor = p.proposto;
    m.pendente = { porTime: timeResp, proposto: PROXIMO[m.valor] };
    m.ultimoPedidoPor = timeResp;
  } else throw new Error('Resposta inválida');
}
```

---

## 9. Mão de onze e mão de ferro

### 9.1 Tipo da mão

O tipo é determinado no início de cada mão, a partir do placar do jogo:

```js
function tipoDaMao(placar) {            // placar[t] < 12 garantido (senão o jogo acabou)
  const a = placar[0] === 11, b = placar[1] === 11;
  return (a && b) ? 'ferro' : (a || b) ? 'onze' : 'normal';
}
```

### 9.2 Mão de onze (exatamente um time com 11)

O time com 11 é chamado aqui de **T11**. A mão segue esta ordem:

1. **Distribuição e vira** normais (seção 4).
2. **Visão das cartas:** os jogadores de T11 veem as cartas uns dos outros, **só neste momento**.
   - Se o humano está em T11, a interface mostra a ele as 3 cartas do parceiro até a decisão e depois as oculta de novo.
   - O time adversário não vê nem mostra nada.
   - No 1x1, não há parceiro: o jogador decide só com as próprias cartas.
3. **Decisão**, antes de qualquer carta ser jogada:
   - **JOGAR:** `valor = 3` desde o início, e a mão segue normalmente a partir do mão.
   - **CORRER:** o adversário ganha **+1** imediatamente. Nenhuma rodada é jogada, as cartas são recolhidas sem revelação e a rotação é normal. A próxima mão será de novo mão de onze, ou mão de ferro se o adversário chegar a 11.
   - **Quem decide:** o humano, se estiver em T11. Caso contrário, o bot designado: o primeiro jogador de T11 em ordem de jogo a partir do mão. Vale a primeira resposta.
   - O time adversário **não decide** e **não pode correr**.
4. **Pedidos proibidos a todos.** Nenhum dos dois times pode pedir truco, seis, nove ou doze. A interface **DEVE** desabilitar os botões, e o motor **DEVE** rejeitar a ação como inválida.
   - **E se alguém pedir?** No padrão, é impossível: a ação é bloqueada.
   - No modo "realista" (Apêndice A), a penalidade canônica é a **derrota imediata no jogo do time que pediu** (MegaJogos, Jogos do Rei, SuperCacheta, Pagat).
5. **Resultado:**
   - T11 vence: +3, chega a 14 ou mais e **vence o jogo**.
   - O adversário vence: +3.
   - Três rodadas empatadas: ninguém pontua (padrão; há variante), e a próxima mão é de novo mão de onze.
6. **Carta encoberta:** segue a regra geral (6.6).

Como o placar pode chegar a 11x11:
- o T11 corre e o adversário, que tinha 10, recebe +1;
- o adversário com 8 vence uma mão de onze (+3).

### 9.3 Mão de ferro (11x11)

1. **Distribuição normal.** A vira fica **visível** (padrão).
2. **Modo fechada (padrão):** todas as cartas ficam face para baixo, **inclusive para o próprio dono**.
   - Na sua vez, o jogador escolhe uma das posições de carta sem ver o valor.
   - A carta é revelada, face para cima, ao ser jogada, e vale normalmente com a manilha da vira.
   - Os bots escolhem uma posição uniformemente ao acaso.
3. **Não há** visão das cartas do parceiro, decisão de jogar ou correr, pedidos nem carta encoberta.
4. **Valor 1.** O valor é irrelevante: quem vencer a mão chega a 12 e **vence o jogo**.
5. **Três empates:** ninguém pontua, e joga-se **nova mão de ferro** com rotação normal, até haver um vencedor.
6. **E se alguém pedir truco?** No padrão, é bloqueado e rejeitado. No modo "realista", o time infrator perde o jogo (SINSEP).

---

## 10. Fim de jogo e de partida

### 10.1 Jogo

- O jogo termina ao fim da mão em que algum time atinge **12 pontos ou mais**.
- Não há vitória simultânea, porque só um time pontua por mão.
- O motor guarda o placar real (por exemplo 13 ou 14). A interface **PODE** exibir `min(placar, 12)`.

### 10.2 Partida

- **Padrão:** a partida é **1 jogo** de 12 pontos.
- **Opção `melhorDe3`:** vence quem ganhar 2 jogos.
  - Ao fim de cada jogo, o placar de pontos volta a 0x0.
  - O 3º jogo só é disputado se estiver 1x1.
  - A rotação do pé continua de um jogo para o outro.
  - A interface **DEVE** manter um placar de jogos vencidos.
- **Justificativa:** o jogo de 12 é a unidade universal nas fontes. O melhor de 3 (UFFS, Queluz, ASFO/UNESP, AABB) é formato de torneio e fica como opção, porque torna a sessão mais longa.

### 10.3 "Queda"

A palavra tem 3 usos nas fontes:
1. a **fala** de pedido de 12 ("Queda!");
2. cada jogo de 12 numa série melhor de 3 (UFFS, Queluz);
3. um marcador de 2 jogos vencidos (truco473).

Por isso **NÃO** se usa "queda" como nome interno: use `Jogo` para a disputa de 12 e `Partida` para o conjunto de jogos. Nas falas, "Queda!" = pedir doze.

---

## 11. Glossário e expressões para as falas dos bots

### 11.1 Glossário

| Termo | Significado |
|---|---|
| a mão | Uma distribuição de cartas, disputada em até 3 rodadas |
| o mão | Jogador à direita do pé; abre a 1ª rodada |
| pé | Quem deu as cartas; joga por último na 1ª rodada |
| rodada / vaza | Cada jogador joga 1 carta |
| jogo | Disputa até 12 pontos |
| partida | Conjunto de jogos (1, ou melhor de 3) |
| tento | Ponto |
| vira | Carta virada que define a manilha |
| manilha | As 4 cartas do posto seguinte ao da vira |
| Zap / Copas (Copeta) / Espadilha / Pica-fumo | Manilha de paus / copas / espadas / ouros |
| casal maior / casal preto / casal vermelho | Zap + Copas / Zap + Espadilha / Copas + Pica-fumo |
| cangar / melar / embuchar / empachar | Empatar uma rodada ("cangou!") |
| trucar / trucar de mão | Pedir truco / pedir truco já na 1ª rodada |
| retrucar / aumentar | Responder a um pedido com o próximo degrau |
| meio-pau | Pedido de seis |
| queda | Na fala: pedido de doze (ver 10.3) |
| correr / fugir | Recusar um pedido |
| cair / mandar / vir | Aceitar um pedido ("mandar cair") |
| encoberta / coberta / no escuro | Carta jogada virada para baixo, que não vale nada (força −1: nunca vence nem empata) |
| mão de onze | Mão em que só um time tem 11 |
| mão de ferro | Mão em que os dois times têm 11 |
| baralho limpo / sujo | 24 cartas (Q a 3) / 40 cartas (4 a 3) |
| manilha nova / velha | Definida pela vira / fixa (mineiro) |
| marreco | Novato, perdedor (provocação) |
| barbudo | O Rei |
| dama sem calça | Mão fraca (gíria) |
| casinha de caboclo | Armadilha (aviso ou provocação) |
| pé frio | Azarado |
| "a primeira vai à missa" | Bordão: vencer a 1ª rodada é decisivo |

### 11.2 Falas por evento

| Evento | Falas (com fonte) |
|---|---|
| Pedir truco | "Truco!", "Truco, ladrão!", "Truco, marreco!" |
| Pedir seis | "Seis!", "É seis!", "Meio-pau!" |
| Pedir nove | "Nove!", "Nove neles!" |
| Pedir doze | "Doze!", "Queda!" |
| Confiança ao subir | "Ferro neles!" |
| Aceitar | "Cai!", "Venha!", "Manda!", "Aceito!", "Joga!" |
| Correr | "Corro!", "Não quero!" |
| Rodada empatada | "Cangou!", "Melou!", "Embuchou!", "Empachou!" |
| Vencer a 1ª rodada | "A primeira vai à missa!" |
| Comentários subjetivos (permitidos) | "Estou com uma mão boa", "De quem é o três?", "Quem fez a primeira?" |
| Provocações | "Marreco!", "Pé frio!", "Casinha de caboclo...", "Casal maior!" (ao mostrar Zap e Copas) |

Algumas falas não têm fonte:
- "Tá fraco", "É dez" e "Desce!" são folclore não confirmado. Se usadas, devem ser marcadas como tal.
- As falas de decisão da mão de onze ("Vamos jogar!" / "Corro!") são sugestão livre.

### 11.3 Falas a evitar

- Palavras que imitam "truco", como "Jorge", "Truca", "Troco", "Turco", "Suco" e "seis-tão loucos". Em torneio, são proibidas ou valem como pedido. Os bots **NÃO DEVEM** usá-las.
- "Parda", termo do truco uruguaio e argentino. Em paulista se diz "cangou" ou "melou".
- Ordens que orientam o parceiro, como "Mata!" ou "Deixa pra mim!". São proibidas em torneio e vazariam informação.

### 11.4 Sinais (opcional, cosmético, para animações 3D)

Segundo a Copag:

| Sinal | Significado |
|---|---|
| Piscar | Zap |
| Levantar as sobrancelhas | Copas |
| Bochecha estufada pela língua | Espadilha |
| Ponta da língua | Pica-fumo |
| Levantar um ombro | Um três |
| Levantar os dois ombros | Par de três |
| Encher as bochechas de ar | "Tô cheio de manilha" |

Os adversários também veem esses sinais, que podem ser blefe. Em torneio, sinais são permitidos e palavras de orientação são proibidas (FPT/ATB).

---

## 12. Fontes

**Regulamentos e textos de regra**
- AABB-SP: https://aabbsp.com.br/storage/0%202022/07.%20JULHO/Regulamento%20Truco.pdf
- UFSC (casin): https://casin.paginas.ufsc.br/files/2010/10/Regras_Truco_Paulista.txt
- SINSEP: https://www.sinsep.com.br/wp-content/uploads/2017/04/Regras-de-Truco.pdf
- ICT-Unesp / ASFO: https://www.ict.unesp.br/Home/sobreoict/fundacoeseassociacoes/asfo/regulamento-de-truco-2019.pdf
- UFFS: https://site-antigo-2025.uffs.edu.br/pastas-ocultas/bd/pro-reitoria-de-assuntos-estudantis/arquivos/regulamento-truco-paulista/@@download/file
- ATB / OAB-CAASP: https://www.caasp.org.br/siteold/JAP/doc/Regulamentos/Truco/Regulamento.pdf
- Prefeitura de Queluz: https://queluz.sp.gov.br/wp-content/uploads/2026/01/REGULAMENTO-TORNEIO-TRUCO.pdf
- Toledo Prudente: https://portal.toledoprudente.edu.br/upload/usuarios/2139/trabalhos/Regras-Truco.pdf
- Sindimoc: https://sindimoc.com.br/media/documentos/TORNEIO_DE_TRUCO.pdf
- Regulamento BA24: https://afiasoccer.com/wp-content/uploads/2024/11/Regulamento-Truco-BA24.pdf
- Federação Paulista de Truco (via Wayback): http://web.archive.org/web/20200117082258/http://www.trucofpt.com.br:80/site/index.php?option=com_content&task=view&id=14&Itemid=27
- Federação Paulista de Truco (via Wayback): http://web.archive.org/web/20161221044214/http://www.trucofpt.com.br/site/index.php?option=com_content&task=view&id=13&Itemid=26
- GameTrack: http://www.gametrack.com.br/jogos/carteado/instrucoes/truco_paulista.asp

**Sites de regras, portais e apps**
- Jogatina: https://www.jogatina.com/regras-como-jogar-truco.html
- Jogatina (PDF): https://s3.amazonaws.com/static.jogatina.com/downloads/truco-paulista/regras-truco-paulista.pdf
- MegaJogos (regras): https://www.megajogos.com.br/truco-online/regras
- MegaJogos (blog): https://blog.megajogos.com.br/guia-definitivo-sobre-o-truco/
- MegaJogos (blog): https://blog.megajogos.com.br/conheca-melhor-as-regras-do-truco/
- Copag: https://blog.copag.com.br/a-copag/afinal-como-se-joga-o-truco-paulista
- Copag (sinais): https://blog.copag.com.br/curiosidades/conheca-todos-os-sinais-do-truco-e-tornese-o-grande-vencedor
- Copag (gírias): https://blog.copag.com.br/a-copag/como-jogar-e-quais-sao-as-principais-girias-de-truco
- Truco Inteligente: https://www.trucointeligente.com.br/regras.html
- Truco Inteligente: https://www.trucointeligente.com.br/download.html
- Truco Inteligente: https://www.trucointeligente.com.br/
- TrucoON: https://trucoon.com.br/jogo/
- SuperCacheta: https://supercacheta.com.br/truco/o-que-e-truco-limpo/
- SuperCacheta: https://supercacheta.com.br/truco/o-que-e-truco-sujo/
- SuperCacheta: https://supercacheta.com.br/truco/regras-do-truco-paulista/
- SuperCacheta: https://supercacheta.com.br/truco/mao-de-11-no-truco/
- SuperCacheta: https://supercacheta.com.br/truco/regras-do-truco-oficial/
- Jogos do Rei (regras): https://www.jogosdorei.com.br/regras-truco.php
- Jogos do Rei (blog): https://www.jogosdorei.com.br/blog/2026/07/08/tabela-truco-paulista-pontos-como-chegar-aos-12/
- Jogos do Rei (blog): https://www.jogosdorei.com.br/blog/2026/07/14/como-pedir-truco-iniciante-escada-pontos/
- Jogos do Rei (blog): https://www.jogosdorei.com.br/blog/2026/04/21/mao-de-onze-truco-paulista/
- Jogos do Rei (blog): https://www.jogosdorei.com.br/blog/2026/03/28/glossario-do-truco-paulista-14-termos-essenciais-para-dominar-o-jogo/
- Jogos do Rei (blog): https://www.jogosdorei.com.br/blog/2026/09/24/girias-do-truco/
- Clube do Truco: https://clubedotruco.com.br/regras-truco-paulista.html
- Clube do Truco: https://clubedotruco.com.br/como-jogar-truco.html
- truco473: https://truco473.com/como_jogar.html
- labigalini: https://www.labigalini.com.br/truco/index3.html
- GamaJogos: https://gamajogos.com.br/regras-do-truco.html
- GipsyTeam: https://www.gipsyteam.com.br/poker/regras-do-truco
- Trevo 7 Folhas: https://trevo-7folhas.blogspot.com/p/regras-oficiais-do-truco.html
- Boteco do Valente: http://botecodovalente.blogspot.com/2011/02/regras-de-truco.html
- Master Clube Recanto do Galo: http://mastercluberecantodogalo-mcrg.blogspot.com/p/regras-do-truco-paulista.html
- Jornal da Nova: https://jornaldanova.com.br/noticia/466665/truco-seis-ladrao
- Truco Animado (App Store): https://apps.apple.com/us/app/truco-animado-cartas-online/id1064941472
- App Store: https://apps.apple.com/br/app/id1407294341
- Copag Play (App Store): https://apps.apple.com/BR/app/id904271979
- Truco Blyts (App Store): https://apps.apple.com/us/app/truco-blyts/id732850167
- Google Play (web2mil): https://play.google.com/store/apps/details?id=air.com.web2mil.trucoPaulista
- Google Play (trucopro): https://play.google.com/store/apps/details?id=air.br.com.trucopro.mobile

**Enciclopédias**
- Wikipédia pt: https://pt.wikipedia.org/wiki/Truco
- Wikipédia en: https://en.wikipedia.org/wiki/Truco
- Pagat: https://www.pagat.com/put/truco_br.html

---

## Apêndice A: Variantes (opcionais)

Todas ficam **desligadas** por padrão, exceto onde o padrão está indicado.

| Chave de configuração | Padrão | Alternativas | Fonte das alternativas |
|---|---|---|---|
| `baralho` | `'limpo'` (24) | `'sujo'` (40), o paulista tradicional | Jogatina, MegaJogos, Copag, SINSEP |
| `jogadores` | `4` | `2` (1x1); `6` (3x3: times por `s%2`, compara a maior carta de cada trio; no limpo sobram 5 cartas no monte) | UFSC, Jogatina, Wikipédia, ATB |
| `manilhaVira2Pula3` (só no sujo) | `false` | Vira 2 → manilha 4, evitando o 3 como manilha | Wikipédia pt (uso caseiro) |
| `sentido` | `'antihorario'` | `'horario'` (espelhado; o mão fica à esquerda do pé) | MegaJogos online, Jogos do Rei |
| `aberturaAposEmpate` | `'primeiraCartaEmpatada'` | `'quemAbriuRodada'` / `'maoDaMao'` / `'quemEmpatou'` (o segundo a pôr a carta igual) | Pagat (seção paulista) / Wikipédia pt, CAXIM-UFG / truco473, SINSEP |
| `tresEmpates` | `'ninguem'` | `'timeDoPe'` (o time que deu as cartas vence) / `'timeDoMao'` / `'valorPassaAdiante'` | SINSEP, ASFO / Wikipédia pt / Pagat |
| `pedidoSomenteNaVez` | `true` | `false` (pedido a qualquer momento) | SINSEP, ASFO, GamaJogos, Wikipédia pt |
| `aumentoPosterior` | `true` | `false` (6/9/12 só como resposta imediata) | Leitura restritiva de Jogatina e Copag |
| `encoberta.abridorPode` | `false` | `true` (no escuro a partir da 2ª rodada para qualquer jogador; decisão de projeto sem fonte: rodada toda encoberta = empate) | labigalini |
| `encoberta.aposEmpate` | `true` | `false` | SINSEP; Pagat ("some") |
| `encoberta.naMaoDeOnze` | `true` | `false` | truco473 |
| `obrigarMaiorAposEmpate` | `false` | `true` (depois de empate na 1ª, é obrigatório jogar a maior carta aberta) | SINSEP, truco473, CAXIM-UFG |
| `cartaExposta` | `false` | `true`: quem trucou com carta adversária já aberta na rodada perde a mão se essa rodada empatar e alguma das cartas empatadas foi jogada antes do pedido | FPT, ATB, Sindimoc, UNESP |
| `pedidoEmOnzeOuFerro` | `'bloqueado'` | `'perdeJogo'` (o infrator perde) / `'perde3'` / `'perde1'` | MegaJogos, Jogos do Rei, SuperCacheta, Pagat / Wikipédia pt, ATB / SINSEP, ASFO |
| `maoDeOnze.decisao` | `'primeiraResposta'` | `'conjunta'` (se um aceita e outro recusa, vale a recusa) | Jogos do Rei, SuperCacheta |
| `maoDeOnze.ambosVeem` | `false` | `true` (os dois times veem as cartas dos parceiros) | Wikipédia pt |
| `maoDeOnze.empateTotal` | `'ninguem'` | `'adversarioGanha3'` / `'redistribui'` | FPT, ATB, Wikipédia pt / Sindimoc |
| `maoDeFerro.modo` | `'fechada'` | `'aberta'` (cada um vê só as próprias cartas) / `'soPrimeiraNoEscuro'` | AABB-SP / SINSEP |
| `maoDeFerro.viraOculta` | `false` | `true` (a vira só é revelada depois das N cartas da 1ª rodada) | SINSEP |
| `maoDeFerro.valor` | `1` | `3` (irrelevante para o resultado) | GamaJogos |
| `maoDeFerro.empateTotal` | `'novaMaoDeFerro'` | `'timeDoPe'` | SINSEP, ASFO |
| `formatoPartida` | `'jogoUnico'` | `'melhorDe3'` / `'melhorDe5'` | UFFS, Queluz, ASFO / AABB-SP, CAASP |
| `primeiroCarteador` | `'sorteio'` | `'maiorCartaTirada'` / `'moeda'` | Queluz / UFFS |
| `exibirPlacarLimitado` | `true` | `false` (mostra 13, 14…) | Implementação |

---

## Apêndice B: Configuração padrão e fluxo do motor

```js
const REGRAS_PADRAO = {
  baralho: 'limpo', jogadores: 4, sentido: 'antihorario',
  manilhaVira2Pula3: false,
  aberturaAposEmpate: 'primeiraCartaEmpatada',
  tresEmpates: 'ninguem',
  pedidoSomenteNaVez: true, aumentoPosterior: true,
  encoberta: { rodada1: false, abridorPode: false, aposEmpate: true, naMaoDeOnze: true },
  obrigarMaiorAposEmpate: false, cartaExposta: false,
  pedidoEmOnzeOuFerro: 'bloqueado',
  maoDeOnze: { verParceiro: true, ambosVeem: false, valorJogar: 3, pontosCorrer: 1,
               decisao: 'primeiraResposta', empateTotal: 'ninguem' },
  maoDeFerro: { modo: 'fechada', viraOculta: false, valor: 1, empateTotal: 'novaMaoDeFerro' },
  pontosJogo: 12, formatoPartida: 'jogoUnico', exibirPlacarLimitado: true,
  primeiroCarteador: 'sorteio',
};
```

Fluxo de uma mão, como máquina de estados:

```
INICIO_MAO → EMBARALHAR → DISTRIBUIR → VIRAR → CALC_MANILHA → tipoDaMao(placar)
  normal → RODADA(1)
  onze   → MOSTRAR_CARTAS_PARCEIRO(T11) → DECISAO_ONZE
              JOGAR  → valor=3 → RODADA(1)
              CORRER → pontua(adversário,1) → FIM_MAO
  ferro  → (cartas ocultas a todos) → RODADA(1)

RODADA(k): vez = abridor
  AGUARDANDO_ACAO(vez): {PEDIR (se podePedir) | JOGAR_CARTA(carta, encoberta?)}
    PEDIR → AGUARDANDO_RESPOSTA(time desafiado): {ACEITAR | CORRER | AUMENTAR}
        ACEITAR  → AGUARDANDO_ACAO(vez)  [mesmo jogador; sem novo pedido nesta vez]
        AUMENTAR → AGUARDANDO_RESPOSTA(outro time)
        CORRER   → pontua(pendente.porTime, valor) → FIM_MAO
    JOGAR_CARTA → se todos jogaram: resolverRodada → r.push(resultado)
                    w = resolverMao(r)
                    w ∈ {0,1}   → pontua(w, valor) → FIM_MAO
                    w = NINGUEM → FIM_MAO (tipo ferro com empate total: nova mão de ferro)
                    w = null    → RODADA(k+1) com abridor = proximoAbridor
                  senão: vez = proximo(vez)

FIM_MAO → se algum placar >= 12: FIM_JOGO (placar de jogos; talvez FIM_PARTIDA)
          senão: pe = (pe+1)%N → INICIO_MAO
```

---

## Apêndice C: Casos de teste de referência

Os casos usam baralho limpo e 2x2, salvo indicação. A ordem de jogo 0, 1, 2, 3 significa que o jogador 0 abre. Times: 0 = {0, 2} e 1 = {1, 3}.

1. **Manilha.**
   - Limpo: vira 3 → Q; vira K → A; vira Q → J.
   - Sujo: vira 3 → 4; vira 7 → Q.
2. **Força** (limpo, vira K, manilha A): A♣ > A♥ > A♠ > A♦ > 3♣ = 3♦ > 2 > K > J > Q.
3. **Empate entre times** (vira Q): cartas K, 3♠, 3♥, 2 → EMPATE; próximo abridor = 1.
4. **Parceiros iguais** (vira Q): cartas 3♣, 2, 3♦, K → vence o time 0; próximo abridor = 0.
5. **Encoberta** (2ª rodada, vira A, manilha 2, abridor 0):
   - 0 joga J aberta, 1 encoberta, 2 encoberta, 3 joga Q aberta → vence o time 0 (J > Q); próximo abridor = 0.
   - O jogador 0 tentar encobrir → ação inválida.
   - Qualquer jogador tentar encobrir na 1ª rodada → ação inválida.
6. **Resolução da mão:**
   - [0, EMPATE] → 0, sem 3ª rodada.
   - [EMPATE, 1] → 1.
   - [0, 1, EMPATE] → 0.
   - [EMPATE, EMPATE, 1] → 1.
   - [EMPATE, EMPATE, EMPATE] → ninguém pontua, mesmo com valor 3.
7. **Corrida:**
   - Time 0 pede truco, time 1 corre → time 0 +1.
   - Time 0 truco, time 1 seis, time 0 corre → time 1 +3.
   - Time 0 truco, time 1 seis, time 0 nove, time 1 doze, time 0 corre → time 1 +9.
8. **Alternância:**
   - Depois de "time 0 truco, time 1 aceita", `podePedir` é falso para os jogadores do time 0 e verdadeiro para um jogador do time 1 na sua vez.
   - Depois de "time 1 seis, time 0 aceita", só o time 0 pode pedir nove.
9. **Limite:** valor 12 → `podePedir` é falso para todos. Placar 10x5 com mão de 3 vencida pelo time 0 → 13x5, fim de jogo; a interface exibe 12x5.
10. **Mão de onze:**
    - Placar 11x7, T11 corre → 11x8, e a próxima mão é de onze.
    - Placar 11x8, T11 joga e perde → 11x11, e a próxima mão é de ferro.
    - Placar 11x7, T11 joga e vence → 14x7, fim de jogo.
    - Em qualquer mão de onze, `podePedir` é falso para todos os 4 jogadores.
11. **Mão de ferro:**
    - Nenhum jogador vê as próprias cartas, e `podePedir` é falso para todos.
    - Com três empates, o placar segue 11x11, `pe` avança e começa nova mão de ferro.
12. **Rotação:** pé = 3 → o mão é 0. Na mão seguinte, pé = 0 e o mão é 1, inclusive quando a mão anterior terminou por corrida ou com três empates.