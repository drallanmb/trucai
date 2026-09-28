# Áudio gravado do TrucAÍ

Esta pasta guarda os áudios gravados que **substituem** os sons sintetizados do jogo. Sem nenhum arquivo aqui, o jogo funciona igual (tudo sintetizado).

- `sfx/<nome>.mp3` — efeitos: `shuffle`, `deal`, `flip`, `place`, `slide`, `bean`, `win`, `lose`, `tie`, `call`, `click`, `hover`.
- `vozes/<id do personagem>/<momento>-<n>.mp3` — falas (n = posição da frase na ficha). Ex.: `vozes/vini/truco-1.mp3`.
- `vozes/voce/` — gritos de quem joga (`truco-1.mp3`, `aceitar-1.mp3`, …).
- `ROTEIRO.csv` — todas as falas com o nome exato do arquivo e o texto a gravar (gerado).
- `manifest.js` — lista do que existe (gerado; não edite à mão).

Depois de colocar ou tirar arquivos, rode na raiz do projeto:

```sh
node tools/audio-manifest.mjs   # atualiza manifest.js e ROTEIRO.csv
node tools/build.mjs            # (opcional) embute os áudios no arquivo único / Artifact
```

Guia completo, com a lista dos efeitos, dicas para o ElevenLabs e as falas de cada personagem: `docs/AUDIO.md`.
