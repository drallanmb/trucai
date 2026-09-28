# TrucAÍ — Ideias para depois da primeira versão

## 1. Efeito "galáxia do Seis" — ✅ feito (27/09, `js/gfx/galaxy.js`, `scene.galaxySix()`)

**Pedido:** quando alguém gritar **"Seis!"**, aparece em cima da mesa um efeito inspirado na abertura da página do GPT‑6 Astra (openai.com/pt-BR/index/gpt-6-astra).

**Como é o efeito de referência** (observado na página em 27/09/2026):
1. Fundo de estrelas espalhadas: pontos brilhantes com halo suave (bokeh), a maioria branco-azulada e alguns laranja-quentes, de vários tamanhos.
2. As estrelas se juntam e começam a girar.
3. Elas formam uma **galáxia espiral cujo braço se curva num "6"**: o miolo brilhante é a barriga do 6 e o braço sobe como a perna do número.
4. A galáxia continua girando devagar.

**Como fica no jogo:**
- Ao evento `call` com `to === 6`, as estrelas surgem espalhadas sobre a mesa, em penumbra, e em ~1,5 s se organizam num "6" espiral flutuando acima do centro da mesa, virado para a câmera. O 6 brilha e gira por ~1 s e depois se desfaz em poeira de estrelas, que cai na mesa e some.
- Implementação: `THREE.Points` com blending aditivo e um shader simples. Cada partícula tem uma posição inicial aleatória e uma posição-alvo amostrada numa curva em forma de 6 (espiral logarítmica para a barriga + arco para a perna), com ruído e tamanhos variados. A interpolação é feita no shader por um uniform `progress`, então sai barato e mantém os 60 fps.
- Respeitar `prefers-reduced-motion` (versão curta, sem giro) e a qualidade `low` (menos partículas).
- **Só a ideia visual.** Nada de texto, logo ou nome "GPT"/"Astra" na mesa.
- Pode virar uma família: um efeito para cada grito (Truco, Seis, Nove, Doze), cada um com a sua cara.

## 2. Personagens como modelo

Ver `docs/PERSONAGENS.md`: ficha de personagem, tela "Criar personagem", elenco e relações. Fica para depois de testar o jogo.
