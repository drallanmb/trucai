#!/usr/bin/env node
// TrucAÍ — manifesto do áudio gravado (docs/AUDIO.md), sem dependências.
//
//   node tools/audio-manifest.mjs
//
// Varre a pasta audio/ e reescreve:
//   audio/manifest.js   script clássico que define Truco.AUDIO_MANIFEST = { sfx: {...}, vozes: {...} } com os
//                       arquivos que EXISTEM. O jogo abre por file:// (sem fetch), então é por ele que o
//                       js/ui/audio.js sabe o que tocar. Carregado no index.html antes de js/ui/audio.js.
//   audio/ROTEIRO.csv   roteiro de gravação: personagem, momento, arquivo, texto (todas as falas das
//                       fichas em personagens/*.js e os gritos de quem joga), para gravar em lote.
//
// Arquivos aceitos: .mp3 (recomendado), .m4a, .ogg, .wav, .webm. Com o mesmo nome em dois formatos, vale o
// primeiro desta lista. Efeitos: audio/sfx/<nome>.<ext> (nome = um dos sons de Truco.Audio.SOUNDS).
// Falas: audio/vozes/<id do personagem>/<momento>-<n>.<ext> (n = posição da frase em falas[momento], de 1).
//
//   node tools/audio-manifest.mjs --check   só confere: sai com 1 se o manifest.js ou o ROTEIRO.csv estiver velho.
//
// Também é importado por tools/build.mjs (que embute os arquivos como data: URI) e pelos testes.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, extname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const EXTS = ['.mp3', '.m4a', '.ogg', '.wav', '.webm'];
export const MIME = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.webm': 'audio/webm' };

const require = createRequire(import.meta.url);

/** Sons do jogo (Truco.Audio.SOUNDS), direto do js/ui/audio.js. */
export function soundNames(root = ROOT) {
  const A = require(join(root, 'js/ui/audio.js'));
  return A.SOUNDS.slice();
}

/** Personagens das fichas listadas no index.html (na mesma ordem), já normalizados. */
export function loadCharacters(root = ROOT) {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const files = [...html.matchAll(/<script\s+src="(personagens\/[^"]+\.js)"/g)].map((m) => m[1]);
  const P = require(join(root, 'js/core/personagens.js'));
  if (!P.lista().length) for (const f of files) require(join(root, f));
  return { P, list: P.lista().filter((p) => p.origem !== 'meu') };
}

/** Gritos fixos de quem joga (assento 0), de js/main.js (Game.HUMAN_CLIPS): [{ chave, texto }]. */
export function humanClips(root = ROOT) {
  try {
    require(join(root, 'js/core/rules.js'));
    require(join(root, 'js/core/engine.js'));
    require(join(root, 'js/core/ai.js'));
    const Game = require(join(root, 'js/main.js'));
    return Object.keys(Game.HUMAN_CLIPS).map((texto) => ({ chave: Game.HUMAN_CLIPS[texto], texto }));
  } catch (_) {
    return [];
  }
}

function listDir(dir) {
  try {
    return readdirSync(dir).filter((f) => !f.startsWith('.'));
  } catch (_) {
    return [];
  }
}

// Arquivos de áudio de uma pasta: { chave: 'nome.ext' } (formato preferido quando há dois).
function audioFiles(dir) {
  const out = {};
  for (const f of listDir(dir).sort()) {
    const ext = extname(f).toLowerCase();
    if (EXTS.indexOf(ext) < 0) continue;
    const path = join(dir, f);
    try {
      if (!statSync(path).isFile() || statSync(path).size === 0) continue;
    } catch (_) {
      continue;
    }
    const key = basename(f, extname(f));
    if (!out[key] || EXTS.indexOf(ext) < EXTS.indexOf(extname(out[key]).toLowerCase())) out[key] = f;
  }
  return out;
}

/**
 * Varre audio/ e devolve { manifest: { sfx, vozes }, avisos: string[], bytes }. Caminhos relativos à raiz
 * do jogo ('audio/sfx/call.mp3'). Nomes que não batem com um som ou uma fala viram aviso (mas entram).
 */
export function scan(root = ROOT, opts = {}) {
  const dirAudio = join(root, 'audio');
  const sounds = opts.sounds || soundNames(root);
  const avisos = [];
  let bytes = 0;
  const size = (rel) => {
    try {
      return statSync(join(root, rel)).size;
    } catch (_) {
      return 0;
    }
  };
  const sfx = {};
  const found = audioFiles(join(dirAudio, 'sfx'));
  for (const key of Object.keys(found)) {
    const rel = 'audio/sfx/' + found[key];
    if (sounds.indexOf(key) < 0) {
      avisos.push(rel + ': não há efeito chamado “' + key + '” (efeitos: ' + sounds.join(', ') + '). Ignorado.');
      continue;
    }
    sfx[key] = rel;
    bytes += size(rel);
  }
  const vozes = {};
  const known = opts.characters || null; // { id: Set(chaves) }
  for (const id of listDir(join(dirAudio, 'vozes')).sort()) {
    const dir = join(dirAudio, 'vozes', id);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch (_) {
      continue;
    }
    const got = audioFiles(dir);
    const keys = Object.keys(got);
    if (!keys.length) continue;
    vozes[id] = {};
    for (const key of keys) {
      const rel = 'audio/vozes/' + id + '/' + got[key];
      if (known && !known[id]) avisos.push(rel + ': não conheço o personagem “' + id + '” (a pasta tem que ser o id da ficha).');
      else if (known && !known[id].has(key)) avisos.push(rel + ': “' + key + '” não é uma fala da ficha de ' + id + ' (veja audio/ROTEIRO.csv).');
      vozes[id][key] = rel;
      bytes += size(rel);
    }
  }
  return { manifest: { sfx, vozes }, avisos, bytes };
}

/** Texto do audio/manifest.js. `src(rel)` troca o caminho (o build passa data: URIs). */
export function manifestText(manifest, src = (rel) => rel) {
  const lines = [
    '// Gerado por tools/audio-manifest.mjs — NÃO edite à mão: rode `node tools/audio-manifest.mjs`.',
    '// Arquivos de áudio gravado que existem em audio/ (docs/AUDIO.md). Vazio = tudo sintetizado.',
    '(function (root) {',
    "  'use strict';",
    '  const Truco = (root.Truco = root.Truco || {});',
    '  Truco.AUDIO_MANIFEST = {',
    '    sfx: {',
  ];
  for (const k of Object.keys(manifest.sfx)) lines.push('      ' + JSON.stringify(k) + ': ' + JSON.stringify(src(manifest.sfx[k])) + ',');
  lines.push('    },', '    vozes: {');
  for (const id of Object.keys(manifest.vozes)) {
    lines.push('      ' + JSON.stringify(id) + ': {');
    for (const k of Object.keys(manifest.vozes[id])) lines.push('        ' + JSON.stringify(k) + ': ' + JSON.stringify(src(manifest.vozes[id][k])) + ',');
    lines.push('      },');
  }
  lines.push('    },', '  };', "})(typeof window !== 'undefined' ? window : globalThis);", '');
  return lines.join('\n');
}

const csvCell = (v) => (/[",\n;]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));

/** Linhas do roteiro: [{ personagem, id, momento, arquivo, texto }] — personagens do jogo + 'voce'. */
export function roteiro(root = ROOT) {
  const { P, list } = loadCharacters(root);
  const rows = [];
  for (const p of list) {
    for (const f of P.arquivosDeFala(p)) {
      rows.push({ personagem: p.nome, id: p.id, momento: f.para ? f.momento + ' (para ' + f.para + ')' : f.momento, arquivo: f.arquivo, texto: f.texto });
    }
  }
  const nomes = { 'truco-1': 'truco', 'seis-1': 'seis', 'nove-1': 'nove', 'doze-1': 'doze', 'aceitar-1': 'aceitar', 'correr-1': 'correr', 'maoDeOnzeJoga-1': 'maoDeOnzeJoga' };
  for (const h of humanClips(root)) {
    // O controlador grita em caixa-alta ("TRUCO!"); no roteiro vai como se fala ("Truco!").
    const texto = h.texto === h.texto.toUpperCase() ? h.texto.charAt(0) + h.texto.slice(1).toLowerCase() : h.texto;
    rows.push({ personagem: 'Você (quem joga)', id: 'voce', momento: nomes[h.chave] || h.chave, arquivo: 'audio/vozes/voce/' + h.chave + '.mp3', texto });
  }
  return rows;
}

export function roteiroCsv(rows) {
  return ['personagem,momento,arquivo,texto'].concat(rows.map((r) => [r.personagem, r.momento, r.arquivo, r.texto].map(csvCell).join(','))).join('\n') + '\n';
}

/** Chaves de fala conhecidas por personagem (para os avisos do scan). */
export function knownKeys(rows) {
  const out = {};
  for (const r of rows) {
    (out[r.id] = out[r.id] || new Set()).add(basename(r.arquivo, '.mp3'));
  }
  return out;
}

function main() {
  const rows = roteiro(ROOT);
  const { manifest, avisos, bytes } = scan(ROOT, { characters: knownKeys(rows) });
  const files = { 'audio/manifest.js': manifestText(manifest), 'audio/ROTEIRO.csv': roteiroCsv(rows) };
  if (process.argv.includes('--check')) {
    const stale = Object.keys(files).filter((f) => !existsSync(join(ROOT, f)) || readFileSync(join(ROOT, f), 'utf8') !== files[f]);
    if (stale.length) {
      console.error('audio-manifest --check: desatualizado (' + stale.join(', ') + '): rode node tools/audio-manifest.mjs');
      process.exit(1);
    }
    console.log('audio-manifest --check: em dia');
    return;
  }
  mkdirSync(join(ROOT, 'audio'), { recursive: true });
  for (const f of Object.keys(files)) writeFileSync(join(ROOT, f), files[f]);
  const nVozes = Object.values(manifest.vozes).reduce((n, v) => n + Object.keys(v).length, 0);
  console.log('audio-manifest: ' + Object.keys(manifest.sfx).length + ' efeito(s) e ' + nVozes + ' fala(s) gravada(s), ' + (bytes / 1048576).toFixed(2) + ' MB');
  const porId = {};
  for (const r of rows) porId[r.id] = porId[r.id] || { nome: r.personagem, total: 0, feitas: 0 };
  for (const r of rows) {
    porId[r.id].total++;
    const key = basename(r.arquivo, '.mp3');
    if (manifest.vozes[r.id] && manifest.vozes[r.id][key]) porId[r.id].feitas++;
  }
  for (const id of Object.keys(porId)) console.log('  ' + porId[id].nome + ': ' + porId[id].feitas + '/' + porId[id].total + ' falas');
  console.log('  audio/manifest.js e audio/ROTEIRO.csv (' + rows.length + ' falas no roteiro) atualizados');
  for (const a of avisos) console.warn('  aviso: ' + a);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
