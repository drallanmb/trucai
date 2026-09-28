#!/usr/bin/env node
// TrucAÍ — build opcional, sem dependências.
//
//   node tools/build.mjs
//
// Gera, a partir de index.html:
//   dist/cafe-truco.html  arquivo único: css/style.css e todos os js/*.js locais embutidos.
//                         three.js (jsDelivr) e Google Fonts continuam vindo da CDN.
//   dist/artifact.html    o mesmo conteúdo sem <!doctype>/<html>/<head>/<body>: começa com <meta charset>
//                         e <meta viewport>, depois <title>, os <link>s/<noscript>/<style> do <head> na
//                         ordem original, o markup e os <script>s (para publicar como Artifact).
//
//   node tools/build.mjs --check
//
// Gera tudo em memória e compara com dist/: sai com 0 se estiver igual e com 1 ("dist desatualizado")
// se algum arquivo faltar ou diferir. Não escreve nada.
//
// Áudio gravado (docs/AUDIO.md): no lugar de audio/manifest.js entra um manifesto gerado na hora a partir
// dos arquivos que existem em audio/ (tools/audio-manifest.mjs), com cada arquivo embutido como data: URI
// — assim o arquivo único e o Artifact tocam o áudio sem depender da pasta. Avisa se passar de ~10 MB.
//
// Código embutido não pode fechar a tag antes da hora: "</script" vira "<\/script" (equivalente em
// strings, regex e comentários de JS) e "</style" é recusado no CSS. "<!--" em JS embutido também é
// recusado, porque muda o jeito como o HTML lê o script.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan as scanAudio, manifestText, MIME } from './audio-manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const AUDIO_MANIFEST = 'audio/manifest.js';
const AUDIO_WARN_BYTES = 10 * 1024 * 1024;

function fail(message) {
  console.error('build: ' + message);
  process.exit(1);
}

function isLocal(url) {
  return !/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url) && !/^(?:data|blob):/i.test(url);
}

function readLocal(rel) {
  const clean = rel.split(/[?#]/)[0];
  const path = join(ROOT, clean);
  if (!existsSync(path)) fail('arquivo não encontrado: ' + clean);
  return { path: clean, text: readFileSync(path, 'utf8') };
}

function inlineScript(rel) {
  const { path, text } = readLocal(rel);
  if (/<!--/.test(text)) fail(path + ' contém "<!--", que quebra o script embutido');
  const safe = text.replace(/<\/(script)/gi, '<\\/$1');
  return '<script>\n' + safe.replace(/\s+$/, '') + '\n//# sourceURL=' + path + '\n</script>';
}

function inlineStyle(rel) {
  const { path, text } = readLocal(rel);
  if (/<\/style/i.test(text)) fail(path + ' contém "</style", que quebra o estilo embutido');
  return '<style>\n' + text.replace(/\s+$/, '') + '\n</style>';
}

/** Manifesto de áudio com os arquivos embutidos (data: URI). -> { script, count, bytes } */
function inlineAudioManifest() {
  const { manifest, bytes } = scanAudio(ROOT);
  let count = 0;
  const dataUri = (rel) => {
    const ext = (rel.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
    count++;
    return 'data:' + (MIME[ext] || 'application/octet-stream') + ';base64,' + readFileSync(join(ROOT, rel)).toString('base64');
  };
  const text = manifestText(manifest, dataUri);
  return { script: '<script>\n' + text.replace(/\s+$/, '') + '\n//# sourceURL=' + AUDIO_MANIFEST + '\n</script>', count, bytes };
}

function build() {
  const audio = { count: 0, bytes: 0 };
  const source = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const counts = { scripts: 0, styles: 0 };

  let html = source.replace(/<link\b[^>]*>/gi, (tag) => {
    const rel = /\brel\s*=\s*["']?stylesheet/i.test(tag);
    const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!rel || !href || !isLocal(href)) return tag;
    counts.styles++;
    return inlineStyle(href);
  });

  html = html.replace(/<script\b([^>]*)>\s*<\/script>/gi, (tag, attrs) => {
    const src = (attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!src || !isLocal(src)) return tag;
    counts.scripts++;
    if (src.split(/[?#]/)[0] === AUDIO_MANIFEST) {
      const a = inlineAudioManifest();
      audio.count = a.count;
      audio.bytes = a.bytes;
      return a.script;
    }
    return inlineScript(src);
  });

  if (!counts.scripts) fail('nenhum script local encontrado em index.html');
  if (/<script\b[^>]*\bsrc\s*=\s*["'](?!https?:)/i.test(html)) fail('sobrou script local sem embutir');

  // Versão Artifact: metas de charset/viewport (sem elas o celular abre a página com 980 px de largura),
  // título, depois links/noscript/estilos do <head> na ordem original e o conteúdo do <body>.
  const head = (html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i) || [])[1];
  const body = (html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i) || [])[1];
  if (head === undefined || body === undefined) fail('index.html sem <head> ou <body>');
  const title = (head.match(/<title\b[^>]*>[\s\S]*?<\/title>/i) || [])[0];
  if (!title) fail('index.html sem <title>');
  const metas = head.match(/<meta\b[^>]*(?:charset|name=["']viewport["'])[^>]*>/gi) || [];
  if (!metas.some((m) => /charset/i.test(m)) || !metas.some((m) => /viewport/i.test(m))) {
    fail('index.html sem <meta charset> ou <meta name="viewport">');
  }
  // <noscript> inteiro (o <link> de dentro não pode virar um <link> solto e bloqueante).
  const headItems = head.match(/<noscript\b[^>]*>[\s\S]*?<\/noscript>|<link\b[^>]*>|<style\b[^>]*>[\s\S]*?<\/style>/gi) || [];
  const artifact = [...metas, title, ...headItems, body.trim()].join('\n') + '\n';

  // Conferências finais: nada de fechamento de <script> perdido dentro do código.
  for (const [file, text] of [['dist/cafe-truco.html', html], ['dist/artifact.html', artifact]]) {
    const opens = (text.match(/<script\b/gi) || []).length;
    const closes = (text.match(/<\/script>/gi) || []).length;
    if (opens !== closes) fail(file + ': ' + opens + ' <script> para ' + closes + ' </script>');
  }
  if (/^\s*<!doctype|<html\b|<head\b|<body\b/i.test(artifact)) fail('artifact.html ainda tem doctype/html/head/body');
  if (!/^<meta\b[^>]*charset/i.test(artifact)) fail('artifact.html precisa começar com <meta charset>');

  return { counts, audio, files: { 'cafe-truco.html': html, 'artifact.html': artifact } };
}

function check() {
  const { files } = build();
  const stale = [];
  for (const name of Object.keys(files)) {
    const path = join(DIST, name);
    if (!existsSync(path) || readFileSync(path, 'utf8') !== files[name]) stale.push('dist/' + name);
  }
  if (stale.length) {
    console.error('build --check: dist desatualizado (' + stale.join(', ') + '): rode node tools/build.mjs');
    process.exit(1);
  }
  console.log('build --check: dist/ em dia');
}

function write() {
  const { counts, audio, files } = build();
  mkdirSync(DIST, { recursive: true });
  for (const name of Object.keys(files)) writeFileSync(join(DIST, name), files[name]);
  const kb = (t) => (Buffer.byteLength(t) / 1024).toFixed(0) + ' KB';
  console.log('build: ' + counts.scripts + ' scripts e ' + counts.styles + ' folha(s) de estilo embutidos');
  console.log('  dist/cafe-truco.html  ' + kb(files['cafe-truco.html']));
  console.log('  dist/artifact.html    ' + kb(files['artifact.html']));
  const mb = (audio.bytes / 1048576).toFixed(1);
  console.log('  áudio gravado: ' + audio.count + ' arquivo(s) embutido(s), ' + mb + ' MB (data: URI)');
  if (audio.bytes > AUDIO_WARN_BYTES) {
    console.warn('build: AVISO — o áudio embutido passa de 10 MB (' + mb + ' MB). O arquivo único fica pesado para abrir e');
    console.warn('       o Artifact tem limite de 16 MB: exporte em MP3 mono 64–96 kbps ou grave menos variações.');
  }
}

if (process.argv.includes('--check')) check();
else write();
