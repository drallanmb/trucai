#!/usr/bin/env node
// TrucAÍ — teste de fumaça no navegador (Chrome headless via tools/cdp.mjs).
//
//   node tools/smoke.mjs [--concurrency 2] [--only <trecho do nome>] [--speed 12] [--timeout 360000]
//                        [--block-fonts]
//
// Antes de tudo confere se dist/ está em dia (node tools/build.mjs --check); se não estiver, os casos
// dist-* falham (os outros só recebem o aviso).
//
// Roda partidas automáticas completas (?autoplay=1&skipMenu=1) em index.html — 1x1 e 2x2, baralho
// limpo (1 jogo) e sujo (melhor de 3), em 1280x800 e 390x844 (--mobile) — e também em dist/cafe-truco.html
// e dist/artifact.html no celular (gerados por tools/build.mjs, se existirem). Cada partida vai até o
// diálogo de fim de partida.
//
// Também roda uma sessão "humana" roteirizada (cliques e teclas reais via CDP, semente fixa, 1280x800):
// clica Jogar no menu, pede truco pelo botão, joga uma carta clicando na mão 3D, encobre e joga pelas
// teclas E e 1, responde "Cai!" aos pedidos dos bots (os laços reagem ao que eles fizerem, sem depender de
// uma sequência fixa), pausa com Esc e continua, abre "Como jogar" e começa uma nova partida 1x1 pelo
// menu de pausa. Os cliques miram elementos (seletor/texto) e as
// cartas da mão (__truco.handPoints()), não coordenadas fixas: o roteiro vale com ou sem as fontes do
// Google (--block-fonts derruba fonts.googleapis.com para conferir). Se o layout mudar, o caso falha
// dizendo qual passo não aconteceu.
//
// E um caso "personagens-desktop": cria um personagem pela tela Personagens, salva, senta ele como
// parceiro no menu e joga uma partida automática 2x2 até o fim.
//
// Falha (código de saída 1) se houver exceção na página, console.error, erro em window.__truco.errors,
// partida que não termina no tempo ou teto de animação estourado. Screenshots periódicas e finais
// ficam em tmp/smoke/<caso>/.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tmp', 'smoke');

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) a[k.slice(2)] = true;
    else {
      a[k.slice(2)] = next;
      i++;
    }
  }
  return a;
}

const args = parseArgs(process.argv);
const SPEED = Number(args.speed) || 12;
const TIMEOUT = Number(args.timeout) || 360000;
const CONCURRENCY = Math.max(1, Number(args.concurrency) || 2);

const VIEWPORTS = [
  { tag: 'desktop', width: 1280, height: 800, mobile: false },
  { tag: 'mobile', width: 390, height: 844, mobile: true },
];

function cases() {
  const list = [];
  let seed = 101;
  for (const vp of VIEWPORTS) {
    for (const players of [2, 4]) {
      for (const deck of ['limpo', 'sujo']) {
        // No sujo, melhor de 3: partidas mais longas (bots trucam muito e o jogo único costuma ser curto).
        const format = deck === 'sujo' ? 'bestOf3' : 'single';
        list.push({
          name: `p${players}-${deck}${format === 'bestOf3' ? '-bo3' : ''}-${vp.tag}`,
          page: 'index.html',
          query: { players, deck, format, seed: seed++ },
          vp,
        });
      }
    }
  }
  if (existsSync(join(ROOT, 'dist', 'cafe-truco.html'))) {
    list.push({ name: 'dist-p4-limpo-bo3-desktop', page: 'dist/cafe-truco.html', query: { players: 4, deck: 'limpo', format: 'bestOf3', seed: 201 }, vp: VIEWPORTS[0] });
    list.push({ name: 'dist-p2-sujo-mobile', page: 'dist/cafe-truco.html', query: { players: 2, deck: 'sujo', seed: 202 }, vp: VIEWPORTS[1] });
  } else {
    console.log('smoke: dist/cafe-truco.html não existe (rode node tools/build.mjs); pulando o arquivo único.');
  }
  if (existsSync(join(ROOT, 'dist', 'artifact.html'))) {
    // Versão Artifact (sem <html>/<head>): precisa das metas para o celular não abrir com 980 px.
    list.push({ name: 'dist-artifact-mobile', page: 'dist/artifact.html', query: { players: 2, deck: 'limpo', seed: 203 }, vp: VIEWPORTS[1] });
  }
  list.push(humanCase());
  list.push(personagensCase());
  return args.only ? list.filter((c) => c.name.includes(args.only)) : list;
}

// Sessão humana: cliques em elementos (seletor/texto) e nas cartas da mão 3D, nunca em coordenadas fixas.
const W = (kind) => `__truco.waiting && __truco.waiting() === '${kind}'`;
function humanCase() {
  const dir = join(OUT, 'humano-roteiro-desktop');
  const shot = (name) => ({ shot: join(dir, name + '.png') });
  const T = {
    jogar: { clickText: ['.menu-actions button', 'Jogar'] }, // botão Jogar do menu inicial
    cai: { clickSel: '.dialog--call .choice--accept' }, // "Cai!" no diálogo de resposta
    truco: { clickSel: '.btn-truco' }, // botão TRUCO! do turno
    continuar: { clickText: ['.menu-actions button', 'Continuar'] }, // menu de pausa
    regras: { clickSel: '.hud-tools .icon-btn[aria-label="Como jogar"]' },
    umPorUm: { clickText: ['.menu-group[data-key="players"] .seg-opt', '1×1'] }, // opção 1×1 no menu
    novaPartida: { clickSel: '.menu-actions .btn-new' },
  };
  const count = "(t, s, f) => __truco.events.filter(e => e.type === t && e.seat === s && (!f || f(e))).length";
  const D = (k) => `(__truco.decision() || {}).${k}`;
  // Os bots decidem sozinhos: os laços respondem "Cai!" a qualquer pedido e jogam a carta 0 pelo mouse
  // até chegar a situação que o passo seguinte precisa (poder pedir truco, poder encobrir…).
  const answer = (name) => [W('callResponse'), [{ wait: 700 }].concat(name ? [shot(name)] : [], [T.cai, { wait: 600 }])];
  const playCard = [W('play'), [{ clickHand: 0 }, { wait: 700 }]];
  const steps = [
    { until: "document.querySelector('.btn-play')", timeout: 30000 }, { wait: 800 }, shot('01-menu'),
    T.jogar,
    { loop: { until: `${W('play')} && ${D('canCall')}`, timeout: 120000, when: [answer('02-pedido-do-bot'), playCard] } },
    { wait: 1000 }, shot('03-sua-vez'),
    T.truco, { wait: 450 }, shot('04-pediu-truco'),
    { loop: { until: W('play'), timeout: 120000, when: [answer('05-resposta')] } },
    { wait: 900 },
    { moveHand: 0 }, { wait: 500 }, shot('06-hover'),
    { clickHand: 0 }, { wait: 600 }, shot('07-carta-voando'),
    { loop: { until: `${W('play')} && ${D('canFaceDown')}`, timeout: 150000, when: [answer(), playCard] } },
    { wait: 900 },
    { key: 'e' }, { wait: 400 }, shot('08-encobrir'), { key: '1' },
    // Até o humano ter respondido algum pedido com "Cai!" (pede truco sempre que pode, para provocar).
    {
      loop: {
        until: `${W('play')} && (${count})('accept', 0) >= 1`,
        timeout: 240000,
        when: [answer(), [`${W('play')} && ${D('canCall')}`, [T.truco, { wait: 600 }]], [W('play'), [{ key: '1' }, { wait: 700 }]]],
      },
    },
    { wait: 900 },
    { key: 'Escape' }, { wait: 900 }, { eval: '__truco.phase()' }, shot('09-pausa'),
    T.continuar, { wait: 700 }, { eval: '__truco.phase()' },
    { clickHand: 0 }, { wait: 500 },
    T.regras, { wait: 1000 }, { eval: '__truco.phase()' }, shot('10-como-jogar'),
    { key: 'Escape' }, { wait: 700 }, { eval: '__truco.phase()' },
    {
      eval:
        `(() => { const c = ${count}; window.__h1 = { played: c('cardPlayed', 0), faceDown: c('cardPlayed', 0, e => e.faceDown),` +
        ` calls: c('call', 0), accepts: c('accept', 0) }; return JSON.stringify(window.__h1); })()`,
    },
    { loop: { until: W('play'), timeout: 120000, when: [answer()] } },
    { wait: 900 },
    { key: 'Escape' }, { wait: 900 }, T.umPorUm, { wait: 300 },
    // O menu pode passar da altura da tela (rola): traz o botão para a vista antes de clicar.
    { eval: "(() => { const b = document.querySelector('.menu-actions .btn-new'); if (b) b.scrollIntoView({ block: 'center' }); return !!b; })()" },
    { wait: 200 }, T.novaPartida,
    { until: `__truco.state() && __truco.state().players === 2 && (${W('play')} || ${W('callResponse')})`, timeout: 90000 },
    { wait: 900 }, shot('11-nova-partida-1x1'),
    { eval: 'JSON.stringify({ errors: __truco.errors, timeouts: __truco.timeoutLabels || [], players: __truco.state().players, h1: window.__h1 })' },
  ];
  return {
    name: 'humano-roteiro-desktop',
    page: 'index.html',
    query: { seed: 7, speed: 2 },
    human: true,
    vp: VIEWPORTS[0],
    steps,
    check(out) {
      const problems = [];
      for (const miss of out.evals.filter((e) => e.missing)) problems.push('alvo não apareceu: ' + JSON.stringify(miss));
      const phases = out.evals.filter((e) => e.expr === '__truco.phase()').map((e) => e.result);
      const expect = ['paused', 'playing', 'paused', 'playing'];
      if (JSON.stringify(phases) !== JSON.stringify(expect)) problems.push('fases (Esc, Continuar, Como jogar, Esc): ' + JSON.stringify(phases) + ', esperado ' + JSON.stringify(expect));
      const last = out.evals[out.evals.length - 1];
      let rep = null;
      try {
        rep = JSON.parse(last.result);
      } catch (_) {
        problems.push('relatório final ausente: ' + String(JSON.stringify(last)).slice(0, 200));
        return { problems, report: null };
      }
      for (const e of rep.errors) problems.push('__truco.errors: [' + e.where + '] ' + e.message);
      if (rep.players !== 2) problems.push('nova partida 1x1 não começou');
      const h = rep.h1 || {};
      if (!(h.played >= 3)) problems.push('humano jogou ' + h.played + ' cartas (esperado ≥ 3: clique, tecla, clique)');
      if (!(h.faceDown >= 1)) problems.push('carta encoberta pela tecla E não saiu');
      if (!(h.calls >= 1)) problems.push('pedido de truco pelo botão não saiu');
      if (!(h.accepts >= 1)) problems.push('respostas "Cai!" do humano: ' + h.accepts + ' (esperado ≥ 1)');
      const bad = (rep.timeouts || []).filter((l) => l !== 'CardTex.ready');
      if (bad.length) problems.push('teto de tempo estourado em: ' + bad.join(', '));
      return { problems, report: { human: h, players: rep.players } };
    },
  };
}

// Tela "Personagens": cria um personagem pela tela, salva, senta ele como parceiro no 2×2 e joga uma
// partida automática até o fim. Confere que ele estava à mesa e que nada deu erro.
function personagensCase() {
  const dir = join(OUT, 'personagens-desktop');
  const shot = (name) => ({ shot: join(dir, name + '.png') });
  const set = (sel, value) =>
    `(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`;
  const steps = [
    { until: "document.querySelector('.menu-seats select')", timeout: 30000 }, { wait: 600 },
    { clickText: ['.menu-actions button', 'Personagens'] },
    { until: "document.querySelector('.st-create')" }, shot('01-lista'),
    { clickSel: '.st-create' },
    { until: "document.querySelector('.st-editor')" },
    { eval: set('.st-form input.st-input', 'Seu Smoke') },
    { clickText: ['.st-style', 'Blefador'] },
    { wait: 1200 }, shot('02-editor'),
    { clickSel: '.st-save' }, { wait: 300 },
    { clickSel: '.studio-close' },
    { until: "!document.querySelector('.studio-overlay')" },
    { eval: "(() => { const s = document.querySelector('.seat-grid--4 select'); s.value = 'seu-smoke'; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()" },
    { clickText: ['.menu-actions button', 'Jogar'] },
    { until: DONE, timeout: TIMEOUT }, { wait: 900 }, shot('03-fim'),
    { eval: "JSON.stringify({ errors: __truco.errors, timeouts: __truco.timeoutLabels || [], cast: __truco.cast(), names: __truco.controller.session.names, signals: __truco.signals.length })" },
  ];
  return {
    name: 'personagens-desktop',
    page: 'index.html',
    query: { seed: 9, autoplay: 1, speed: SPEED, players: 4 },
    human: true,
    vp: VIEWPORTS[0],
    steps,
    check(out) {
      const problems = [];
      for (const miss of out.evals.filter((e) => e.missing)) problems.push('alvo não apareceu: ' + JSON.stringify(miss));
      const last = out.evals[out.evals.length - 1];
      let rep = null;
      try {
        rep = JSON.parse(last.result);
      } catch (_) {
        problems.push('relatório final ausente: ' + String(JSON.stringify(last)).slice(0, 200));
        return { problems, report: null };
      }
      for (const e of rep.errors) problems.push('__truco.errors: [' + e.where + '] ' + e.message);
      if (!rep.cast || rep.cast[2] !== 'seu-smoke') problems.push('o personagem criado não sentou como parceiro: ' + JSON.stringify(rep.cast));
      const bad = (rep.timeouts || []).filter((l) => l !== 'CardTex.ready');
      if (bad.length) problems.push('teto de tempo estourado em: ' + bad.join(', '));
      return { problems, report: { personagens: rep } };
    },
  };
}

const DONE = "window.__truco && __truco.phase && __truco.phase() === 'matchOver' && __truco.waiting() === 'matchEnd'";
const REPORT =
  'JSON.stringify({ errors: __truco.errors, timeouts: __truco.timeoutLabels || [], events: __truco.events.length,' +
  " hands: __truco.events.filter(e => e.type === 'handStarted').length," +
  " calls: __truco.events.filter(e => e.type === 'call').length," +
  " special: __truco.events.filter(e => e.type === 'handStarted' && e.special).map(e => e.special)," +
  ' score: __truco.state().score, gamesWon: __truco.state().gamesWon, winner: __truco.state().winnerTeam,' +
  " endDialog: !!document.querySelector('.dialog--end'), hScroll: document.documentElement.scrollWidth > innerWidth, vpWidth: innerWidth })";

// Avisos de console que não indicam defeito do jogo (driver de GPU por software, aviso do three).
const BENIGN_CONSOLE = [/GPU stall due to ReadPixels/i, /build\/three(\.min)?\.js" are deprecated/i, /AudioContext was not allowed to start/i];
// Com --block-fonts, a falha proposital das fontes do Google não conta como defeito.
if (args['block-fonts']) BENIGN_CONSOLE.push(/ERR_BLOCKED_BY_CLIENT.*fonts\.(googleapis|gstatic)\.com/i);

function runCase(c) {
  return new Promise((resolveCase) => {
    const dir = join(OUT, c.name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const q = new URLSearchParams(c.human ? c.query : Object.assign({ autoplay: '1', skipMenu: '1', speed: String(SPEED) }, c.query));
    // Melhor de 3 são até três jogos de 12: o limite cresce na mesma proporção.
    const timeout = c.query.format === 'bestOf3' ? TIMEOUT * 3 : TIMEOUT;
    const steps = c.steps || [
      { wait: 1500 },
      { shot: join(dir, 'start.png') },
      { until: DONE, timeout },
      { wait: 900 },
      { eval: REPORT },
      { shot: join(dir, 'end.png') },
    ];
    const stepsFile = join(dir, 'steps.json');
    writeFileSync(stepsFile, JSON.stringify(steps));
    const argv = [
      join(ROOT, 'tools', 'cdp.mjs'),
      '--url', `${c.page}?${q}`,
      '--width', String(c.vp.width),
      '--height', String(c.vp.height),
      '--steps', stepsFile,
      '--shot-every', '6000',
      '--shots-dir', dir,
      '--hard-timeout', String(timeout + 60000),
    ];
    if (c.vp.mobile) argv.push('--mobile');
    if (args['block-fonts']) argv.push('--block', '*fonts.googleapis.com*,*fonts.gstatic.com*');
    const t0 = Date.now();
    const child = spawn(process.execPath, argv, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      const seconds = Math.round((Date.now() - t0) / 1000);
      let out = null;
      try {
        out = JSON.parse(stdout);
      } catch (_) {
        resolveCase({ c, ok: false, seconds, problems: ['saída do cdp.mjs ilegível (código ' + code + '): ' + (stderr || stdout).slice(0, 400)] });
        return;
      }
      writeFileSync(join(dir, 'cdp.json'), JSON.stringify(out, null, 2));
      const problems = [];
      if (out.timedOut) problems.push(c.human ? 'um passo da sessão humana não aconteceu: ' + JSON.stringify(out.evals.find((e) => e.result === 'TIMEOUT')) : 'a partida não terminou em ' + timeout / 1000 + ' s');
      for (const e of out.exceptions) problems.push('exceção: ' + String(e.text).slice(0, 300));
      for (const m of out.console) {
        const bad = m.type === 'error' || m.type === 'log-error';
        if (bad && !BENIGN_CONSOLE.some((re) => re.test(m.text))) problems.push('console ' + m.type + ': ' + m.text.slice(0, 300));
      }
      const evalEntry = out.evals.find((e) => e.expr && e.expr.startsWith('JSON.stringify({ errors'));
      let report = null;
      if (c.check) {
        const res = c.check(out);
        problems.push(...res.problems);
        report = res.report;
      } else if (evalEntry && typeof evalEntry.result === 'string') {
        report = JSON.parse(evalEntry.result);
        for (const e of report.errors) problems.push('__truco.errors: [' + e.where + '] ' + e.message);
        const bad = report.timeouts.filter((l) => l !== 'CardTex.ready');
        if (bad.length) problems.push('teto de tempo estourado em: ' + bad.join(', '));
        if (!report.endDialog) problems.push('diálogo de fim de partida não apareceu');
        if (report.hScroll) problems.push('rolagem horizontal na página');
        if (c.vp.mobile && report.vpWidth > c.vp.width + 10) problems.push('a página ignorou o viewport do celular: innerWidth ' + report.vpWidth);
      } else if (!out.timedOut) {
        problems.push('relatório final ausente: ' + JSON.stringify(evalEntry || null).slice(0, 300));
      }
      resolveCase({ c, ok: problems.length === 0 && code === 0, code, seconds, report, problems, shots: out.shots.length, dir });
    });
  });
}

async function main() {
  const list = cases();
  if (!list.length) {
    console.error('smoke: nenhum caso selecionado');
    process.exit(2);
  }
  mkdirSync(OUT, { recursive: true });
  // dist/ em dia? (sem isso os casos dist-* testariam código velho)
  const check = spawnSync(process.execPath, [join(ROOT, 'tools', 'build.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  const distStale = check.status !== 0;
  if (distStale) console.log('smoke: ' + (check.stderr || check.stdout || 'build --check falhou').trim());
  console.log(`smoke: ${list.length} casos, velocidade ${SPEED}, ${CONCURRENCY} por vez${args['block-fonts'] ? ', sem as fontes do Google' : ''}`);
  const results = [];
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const c = list[next++];
      const r = await runCase(c);
      if (distStale && c.page.startsWith('dist/')) {
        r.ok = false;
        r.problems.unshift('dist/ desatualizado: rode node tools/build.mjs');
      }
      results.push(r);
      const rep = r.report;
      const info = rep && rep.personagens
        ? `mesa: ${rep.personagens.names.join(', ')} · ${rep.personagens.signals} sinal(is) do parceiro`
        : rep && rep.human
        ? `humano: ${rep.human.played} cartas, ${rep.human.faceDown} encoberta(s), ${rep.human.calls} pedido(s), ${rep.human.accepts} "Cai!"`
        : rep
        ? `${rep.hands} mãos, ${rep.calls} pedidos, placar ${rep.score.join('×')}` +
          (c.query.format === 'bestOf3' ? `, jogos ${rep.gamesWon.join('×')}` : '') +
          (rep.special.length ? `, especiais: ${[...new Set(rep.special)].join('/')}` : '')
        : '';
      console.log(`${r.ok ? 'ok  ' : 'FALHA'} ${c.name.padEnd(28)} ${String(r.seconds).padStart(4)} s  ${info}`);
      for (const p of r.problems) console.log('      - ' + p);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
  const failed = results.filter((r) => !r.ok);
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(results.map((r) => ({ name: r.c.name, ok: r.ok, seconds: r.seconds, report: r.report, problems: r.problems })), null, 2));
  console.log(`smoke: ${results.length - failed.length}/${results.length} ok · screenshots em tmp/smoke/<caso>/`);
  process.exit(failed.length ? 1 : 0);
}

main();
