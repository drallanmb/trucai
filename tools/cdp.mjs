#!/usr/bin/env node
// Harness de teste no navegador (Chrome headless + DevTools Protocol), sem dependências.
//
// Uso:
//   node tools/cdp.mjs --url <url|arquivo> [--width 1280 --height 800 --mobile]
//                      [--steps steps.json | --steps-json '[...]']
//                      [--until "<expr JS>" --timeout 120000] [--wait 3000]
//                      [--shot out.png] [--shot-every 5000 --shots-dir dir]
//                      [--eval "<expr JS>"] [--fail-on-error] [--block "<padrão>[,<padrão>]"]
//
// Passos (steps): lista de objetos executados em ordem:
//   {"wait": 1500}                       espera ms
//   {"until": "window.__truco && ...", "timeout": 60000}   espera expressão ficar truthy
//   {"eval": "expr"}                     avalia e guarda o resultado
//   {"click": [x, y]}                    clique do mouse em px CSS (evite: depende do layout e das fontes)
//   {"clickSel": ".btn-truco"}           clique no centro do 1º elemento visível que casa com o seletor
//   {"clickText": ["button", "Continuar"]}  clique no 1º elemento visível do seletor cujo texto contém o trecho
//   {"clickHand": 0}                     clique na carta i da mão 3D (window.__truco.handPoints())
//   {"moveHand": 0}                      só passa o mouse sobre a carta i (hover)
//   {"move": [x, y]}                     move o mouse
//   {"key": "Enter"}                     tecla
//   {"shot": "caminho.png"}              screenshot
//   {"resize": [w, h, mobile?]}          muda viewport
//   {"loop": {"until": "expr", "timeout": 90000, "when": [["cond", [passos...]], ...]}}
//                                        repete até "until"; a cada volta roda os passos do 1º "when"
//                                        verdadeiro (para reagir ao que os bots fizerem)
// clickSel/clickText/clickHand/moveHand esperam o alvo aparecer (até "timeout", padrão 8000 ms); se não
// aparecer, registram {"missing": ...} em evals e marcam timedOut.
//
// --block: falha as requisições cujo URL casa com o padrão (curinga *), ex.: "*fonts.googleapis.com*"
// para testar sem as fontes do Google.
//
// Saída: JSON em stdout { console:[...], exceptions:[...], evals:[...], shots:[...], timedOut }
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) a[key] = true;
    else { a[key] = next; i++; }
  }
  return a;
}

const args = parseArgs(process.argv);
if (!args.url) { console.error('faltou --url'); process.exit(2); }
let url = args.url;
if (!/^[a-z]+:/i.test(url)) {
  const [p, q] = url.split('?');
  url = pathToFileURL(resolve(p)).href + (q ? '?' + q : '');
}
const width = +(args.width || 1280), height = +(args.height || 800);
if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
  console.error('tamanho inválido: --width ' + args.width + ' --height ' + args.height);
  process.exit(2);
}
const mobile = !!args.mobile;

let steps = [];
if (args.steps) steps = JSON.parse(readFileSync(args.steps, 'utf8'));
if (args['steps-json']) steps = JSON.parse(args['steps-json']);
if (args.wait) steps.unshift({ wait: +args.wait });
if (args.until) steps.push({ until: args.until, timeout: +(args.timeout || 120000) });
if (args.eval) steps.push({ eval: args.eval });
if (args.shot) steps.push({ shot: args.shot });

// Fila global: no máximo CDP_MAX (padrão 2) Chromes headless ao mesmo tempo na máquina inteira,
// não importa quantos agentes/processos chamem este script. Cada Chrome com WebGL por software
// consome muita CPU e memória; sem limite, vários em paralelo já travaram o computador.
const LOCK_DIR = fileURLToPath(new URL('../tmp/cdp-locks/', import.meta.url));
const MAX_CHROMES = Math.max(1, +(process.env.CDP_MAX || 2));
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
async function acquireSlot() {
  mkdirSync(LOCK_DIR, { recursive: true });
  const t0 = Date.now();
  for (;;) {
    for (let i = 0; i < MAX_CHROMES; i++) {
      const file = join(LOCK_DIR, `slot-${i}`);
      try {
        writeFileSync(file, String(process.pid), { flag: 'wx' });
        return file;
      } catch {
        let owner = 0;
        try { owner = +readFileSync(file, 'utf8'); } catch {}
        if (owner && !pidAlive(owner)) { try { rmSync(file, { force: true }); } catch {} }
      }
    }
    if (Date.now() - t0 > 20 * 60 * 1000) throw new Error('fila do Chrome: esperou mais de 20 min por uma vaga');
    await new Promise(r => setTimeout(r, 500));
  }
}
const slotFile = await acquireSlot();
function releaseSlot() { try { rmSync(slotFile, { force: true }); } catch {} }
process.on('exit', releaseSlot);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { releaseSlot(); process.exit(130); });

const userDir = mkdtempSync(join(tmpdir(), 'cdp-truco-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${userDir}`,
  // CDP_GPU=1 usa a placa de vídeo (Metal) em vez do WebGL por software — para medir desempenho real.
  ...(process.env.CDP_GPU === '1' ? ['--use-angle=metal', '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
  '--ignore-gpu-blocklist',
  '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
  '--disable-extensions', '--disable-background-networking', '--disable-component-update',
  '--renderer-process-limit=2', '--js-flags=--max-old-space-size=1024',
  '--allow-file-access-from-files', `--window-size=${width},${height}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
// Se o harness cair por qualquer motivo (erro de protocolo, exceção), o Chrome não pode ficar órfão.
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch {} try { rmSync(userDir, { recursive: true, force: true }); } catch {} });
process.on('unhandledRejection', (e) => { console.error('cdp: ' + ((e && e.message) || e)); process.exit(1); });
process.on('uncaughtException', (e) => { console.error('cdp: ' + ((e && e.message) || e)); process.exit(1); });

const out = { url, console: [], exceptions: [], evals: [], shots: [], timedOut: false };
let finished = false;
function finish(code) {
  if (finished) return; finished = true;
  try { chrome.kill('SIGKILL'); } catch {}
  try { rmSync(userDir, { recursive: true, force: true }); } catch {}
  releaseSlot();
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(code);
}
const hardTimeout = setTimeout(() => { out.timedOut = true; out.exceptions.push({ text: 'hard timeout (harness)' }); finish(3); }, +(args['hard-timeout'] || 600000));

const wsUrl = await new Promise((res, rej) => {
  let buf = '';
  chrome.stderr.on('data', d => {
    buf += d.toString();
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) res(m[1]);
  });
  chrome.on('exit', c => rej(new Error('chrome saiu: ' + c + '\n' + buf)));
  setTimeout(() => rej(new Error('chrome não abriu DevTools\n' + buf)), 20000);
});

const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let nextId = 1;
const pending = new Map();
const listeners = [];
ws.onmessage = ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  } else if (msg.method) listeners.forEach(l => l(msg));
};
function send(method, params = {}, sessionId) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);

const fmtArg = a => a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : (a.description || a.type);
listeners.push(msg => {
  if (msg.sessionId !== sessionId) return;
  if (msg.method === 'Runtime.consoleAPICalled') {
    out.console.push({ type: msg.params.type, text: msg.params.args.map(fmtArg).join(' ').slice(0, 2000) });
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    out.exceptions.push({ text: (d.exception && d.exception.description) || d.text, url: d.url, line: d.lineNumber });
  } else if (msg.method === 'Log.entryAdded') {
    const e = msg.params.entry;
    if (e.level === 'error' || e.level === 'warning') out.console.push({ type: 'log-' + e.level, text: (e.text + ' ' + (e.url || '')).slice(0, 1000) });
  }
});

await S('Runtime.enable'); await S('Log.enable'); await S('Page.enable');
if (args.block) {
  const patterns = String(args.block).split(',').map((p) => p.trim()).filter(Boolean);
  out.blocked = [];
  listeners.push((msg) => {
    if (msg.sessionId !== sessionId || msg.method !== 'Fetch.requestPaused') return;
    out.blocked.push(msg.params.request.url.slice(0, 200));
    S('Fetch.failRequest', { requestId: msg.params.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
  });
  await S('Fetch.enable', { patterns: patterns.map((urlPattern) => ({ urlPattern })) });
}
await S('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
if (mobile) await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

// --cpu-profile arquivo.json: grava um perfil de CPU (formato do DevTools) do carregamento até o fim dos passos.
if (args['cpu-profile']) { await S('Profiler.enable'); await S('Profiler.setSamplingInterval', { interval: 500 }); await S('Profiler.start'); }
const loaded = new Promise(r => listeners.push(m => { if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') r(); }));
await S('Page.navigate', { url });
await Promise.race([loaded, new Promise(r => setTimeout(r, 30000))]);

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function evaluate(expr) {
  const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { error: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
  return r.result.value;
}
// Centro (px CSS) do alvo de um passo de clique, ou null se ainda não existe/está invisível.
function targetExpr(st) {
  if (st.clickHand !== undefined || st.moveHand !== undefined) {
    const i = st.clickHand !== undefined ? st.clickHand : st.moveHand;
    return `(() => { const pts = window.__truco && __truco.handPoints ? __truco.handPoints() : null;
      const p = pts && pts[${Number(i)}]; return p && isFinite(p.x) && isFinite(p.y) ? { x: p.x, y: p.y } : null; })()`;
  }
  const sel = JSON.stringify(st.clickSel !== undefined ? st.clickSel : st.clickText[0]);
  const text = st.clickText ? JSON.stringify(String(st.clickText[1]).toLowerCase()) : 'null';
  // Texto: primeiro o elemento com o texto exato, depois o que contém o trecho ("Jogar" ≠ "Como jogar").
  return `(() => { const want = ${text};
    const seen = [];
    for (const el of document.querySelectorAll(${sel})) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || el.closest('[inert]')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const t = (el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const p = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      if (want === null || t === want) return p;
      if (t.includes(want)) seen.push(p);
    }
    return seen[0] || null; })()`;
}

async function mouseClick(x, y) {
  await S('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await S('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function shot(path) {
  const r = await S('Page.captureScreenshot', { format: 'png' });
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, Buffer.from(r.data, 'base64'));
  out.shots.push(resolve(path));
}

let shotTimer = null;
if (args['shot-every']) {
  const dir = args['shots-dir'] || 'tmp/shots';
  let n = 0;
  shotTimer = setInterval(() => { shot(join(dir, `shot-${String(n++).padStart(3, '0')}.png`)).catch(() => {}); }, +args['shot-every']);
}

async function runSteps(list) {
  for (const st of list) {
    if (st.wait) await sleep(st.wait);
    else if (st.until) {
      const t0 = Date.now(), to = st.timeout || 60000;
      let ok = false;
      while (Date.now() - t0 < to) {
        const v = await evaluate(st.until);
        if (v && !v.error) { ok = true; break; }
        await sleep(250);
      }
      if (!ok) { out.timedOut = true; out.evals.push({ until: st.until, result: 'TIMEOUT' }); }
    } else if (st.loop) {
      // Repete até "until": a cada volta roda os passos do 1º "when" cuja condição for verdadeira.
      const L = st.loop, t0 = Date.now(), to = L.timeout || 60000;
      let ok = false, turns = 0;
      while (Date.now() - t0 < to && turns < (L.max || 500)) {
        const done = await evaluate(L.until);
        if (done && !done.error) { ok = true; break; }
        for (const [cond, body] of L.when || []) {
          const v = await evaluate(cond);
          if (v && !v.error) { turns++; await runSteps(body); break; }
        }
        await sleep(L.every || 250);
      }
      if (!ok) { out.timedOut = true; out.evals.push({ loop: L.until, result: 'TIMEOUT', turns }); }
    } else if (st.eval) out.evals.push({ expr: st.eval.slice(0, 200), result: await evaluate(st.eval) });
    else if (st.click) await mouseClick(st.click[0], st.click[1]);
    else if (st.clickSel !== undefined || st.clickText || st.clickHand !== undefined || st.moveHand !== undefined) {
      const expr = targetExpr(st);
      const t0 = Date.now(), to = st.timeout || 8000;
      let p = null;
      while (Date.now() - t0 < to) {
        const v = await evaluate(expr);
        if (v && !v.error) { p = v; break; }
        await sleep(150);
      }
      const what = st.clickSel !== undefined ? { clickSel: st.clickSel } : st.clickText ? { clickText: st.clickText } : st.clickHand !== undefined ? { clickHand: st.clickHand } : { moveHand: st.moveHand };
      if (!p) { out.timedOut = true; out.evals.push(Object.assign({ missing: true, result: 'TIMEOUT' }, what)); }
      else if (st.moveHand !== undefined) await S('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
      else await mouseClick(p.x, p.y);
    } else if (st.move) await S('Input.dispatchMouseEvent', { type: 'mouseMoved', x: st.move[0], y: st.move[1] });
    else if (st.key) {
      await S('Input.dispatchKeyEvent', { type: 'keyDown', key: st.key });
      await S('Input.dispatchKeyEvent', { type: 'keyUp', key: st.key });
    } else if (st.shot) await shot(st.shot);
    else if (st.resize) await S('Emulation.setDeviceMetricsOverride', { width: st.resize[0], height: st.resize[1], deviceScaleFactor: 1, mobile: !!st.resize[2] });
  }
}

try {
  await runSteps(steps);
} catch (e) {
  out.exceptions.push({ text: 'harness: ' + e.message });
}
if (shotTimer) clearInterval(shotTimer);
if (args['cpu-profile']) {
  try { const { profile } = await S('Profiler.stop'); writeFileSync(args['cpu-profile'], JSON.stringify(profile)); out.cpuProfile = resolve(args['cpu-profile']); } catch (e) { out.exceptions.push({ text: 'profile: ' + e.message }); }
}
clearTimeout(hardTimeout);
const failed = args['fail-on-error'] && (out.exceptions.length > 0 || out.console.some(c => c.type === 'error') || out.timedOut);
finish(failed ? 1 : 0);
