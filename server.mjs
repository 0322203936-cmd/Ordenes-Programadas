import './scripts/utc.mjs';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import XLSX from 'xlsx';
import { buildWorkbook } from './scripts/posco-format.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4170);
const execFileAsync = promisify(execFile);
const repo = '0322203936-cmd/Ordenes-Programadas';
const workflow = 'posco-review.yml';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

async function readJsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2_000_000) throw new Error('La configuración es demasiado grande.');
  }
  return JSON.parse(body || '{}');
}

async function syncLatestOrders() {
  const git = process.platform === 'win32' ? 'git.exe' : 'git';
  await execFileAsync(git, ['pull', '--rebase', 'origin', 'master'], { cwd: root });
}

async function rejectProcessedDuplicates(incomingOrders) {
  const current = JSON.parse(await readFile(join(root, 'orders.json'), 'utf8'));
  const currentById = new Map(current.map((order) => [order.id, order]));
  const duplicates = incomingOrders.filter((order) => {
    const stored = currentById.get(order.id);
    return stored && order.startDate && stored.startDate && stored.startDate > order.startDate;
  });
  if (duplicates.length) {
    throw new Error(`Estas órdenes ya fueron procesadas para ${duplicates.map((order) => order.client || order.id).join(', ')}. Recarga la aplicación antes de ejecutar nuevamente.`);
  }
}

async function ghJson(args) {
  const gh = process.platform === 'win32' ? 'gh.exe' : 'gh';
  const result = await execFileAsync(gh, args, { cwd: root });
  return JSON.parse(result.stdout || 'null');
}

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function waitForWorkflowRun(startedAt) {
  const started = new Date(startedAt).getTime() - 2000;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const runs = await ghJson(['run', 'list', '--workflow', workflow, '--repo', repo, '--event', 'workflow_dispatch', '--limit', '10', '--json', 'databaseId,status,conclusion,createdAt']);
    const run = runs.find((candidate) => new Date(candidate.createdAt).getTime() >= started);
    if (run) return String(run.databaseId);
    await delay(2000);
  }
  throw new Error('GitHub Actions recibió la ejecución, pero no se pudo localizar su identificador.');
}

async function waitForWorkflow(runId) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const run = await ghJson(['run', 'view', runId, '--repo', repo, '--json', 'status,conclusion']);
    if (run.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error(`El workflow de POSCO terminó con estado: ${run.conclusion || 'falló'}.`);
      return;
    }
    await delay(5000);
  }
  throw new Error('El workflow de POSCO tardó más de 15 minutos y se canceló la espera.');
}

// ---- how far ahead orders can be loaded: weeks (cycles) go Tuesday..Monday; an execution loads at most
// the NEXT cycle (e.g. on Friday 30/10 the loads of 06/11 and 09/11). Later loads wait for their week.
const MS_DAY = 86400000;
const isoPlus = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * MS_DAY).toISOString().slice(0, 10);
const cycleStart = (iso) => isoPlus(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() - 2 + 7) % 7));
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tijuana' }).format(new Date());
const loadLimit = () => isoPlus(cycleStart(todayIso()), 13); // last day (Monday) of the next cycle
const fmt = (iso) => iso.split('-').reverse().join('/');
function splitByWindow(orders) {
  const limit = loadLimit();
  const pending = orders.filter((order) => order.active !== false && order.startDate);
  return { limit, now: pending.filter((order) => order.startDate <= limit), later: pending.filter((order) => order.startDate > limit) };
}

// keeps every order (paused ones, later ones) and replaces the processed ones; each order remembers
// which loads went to POSCO and when (processedHistory, last 10)
function mergeProcessed(shared, updated, startedAt) {
  const byId = new Map(updated.map((order) => [order.id, order]));
  const merged = shared.map((order) => byId.get(order.id) || order);
  for (const order of updated) if (!shared.some((item) => item.id === order.id)) merged.push(order);
  return merged.map((order) => {
    if (!order.lastProcessedLoadDate || !order.lastProcessedAt || order.lastProcessedAt < startedAt) return order;
    const history = (order.processedHistory || []).filter((entry) => entry.loadDate !== order.lastProcessedLoadDate);
    history.push({ loadDate: order.lastProcessedLoadDate, at: order.lastProcessedAt });
    return { ...order, processedHistory: history.slice(-10) };
  });
}

async function dispatchPoscoWorkflow(incoming) {
  const ordersFile = join(root, 'orders.json');
  const { limit, now: orders, later } = splitByWindow(incoming);
  if (!orders.length) {
    const next = later.map((order) => order.startDate).sort()[0];
    throw new Error(`Ya se cargó todo lo de la próxima semana. La siguiente carga (${fmt(next)}) se podrá ejecutar a partir del martes ${fmt(isoPlus(cycleStart(next), -7))}.`);
  }
  await syncLatestOrders();
  await rejectProcessedDuplicates(orders);
  // the bot gets only what goes now; paused and later orders stay in the shared list
  await writeFile(ordersFile, `${JSON.stringify(orders, null, 2)}\n`, 'utf8');
  const git = process.platform === 'win32' ? 'git.exe' : 'git';
  const gh = process.platform === 'win32' ? 'gh.exe' : 'gh';
  await execFileAsync(git, ['add', 'orders.json'], { cwd: root });
  try {
    await execFileAsync(git, ['commit', '-m', 'Actualiza ordenes para revision POSCO'], { cwd: root });
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`;
    if (!/nothing to commit|working tree clean/i.test(output)) throw error;
  }
  await execFileAsync(git, ['push', 'origin', 'master'], { cwd: root });
  const startedAt = new Date().toISOString();
  await execFileAsync(gh, ['workflow', 'run', workflow, '--repo', repo, '--ref', 'master', '--field', 'orders_file=orders.json'], { cwd: root });
  const runId = await waitForWorkflowRun(startedAt);
  let failure = null;
  try { await waitForWorkflow(runId); } catch (error) { failure = error; }
  await syncLatestOrders();
  const updatedOrders = JSON.parse(await readFile(ordersFile, 'utf8'));
  // the workflow can fail AFTER POSCO was updated (e.g. the email): what was processed is kept anyway
  const processed = updatedOrders.filter((order) => order.lastProcessedAt && order.lastProcessedAt >= startedAt);
  if (failure && !processed.length) throw failure;
  const merged = mergeProcessed(await readSharedOrders(), updatedOrders, startedAt);
  await writeSharedOrders(merged);
  return { runId, updatedOrders: merged, warning: failure ? `POSCO sí se actualizó, pero un paso posterior falló (${failure.message}). Revisa el correo de confirmación en GitHub Actions.` : null, limit };
}

// The orders everyone sees: data/orders.json (kept on this computer, not in git);
// until the first save it starts from the repository's orders.json
const sharedOrdersFile = join(root, 'data', 'orders.json');
async function readSharedOrders() {
  try { return JSON.parse(await readFile(sharedOrdersFile, 'utf8')); } catch {}
  return JSON.parse(await readFile(join(root, 'orders.json'), 'utf8'));
}
async function writeSharedOrders(orders) {
  await mkdir(join(root, 'data'), { recursive: true });
  await writeFile(sharedOrdersFile, `${JSON.stringify(orders, null, 2)}\n`, 'utf8');
}
function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

createServer(async (req, res) => {
  const apiPath = (req.url || '').split('?')[0];
  if (apiPath === '/api/orders' && req.method === 'GET') {
    try { sendJson(res, 200, await readSharedOrders()); } catch (error) { sendJson(res, 500, { error: error.message }); }
    return;
  }
  // the POSCO format filled with the active orders (the same file the bot uploads)
  if (apiPath === '/api/formato' && req.method === 'GET') {
    try {
      const workbook = buildWorkbook(await readSharedOrders(), join(root, 'Formato_POSCO_Wholesale.xlsx'));
      const body = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      res.writeHead(200, {
        'Content-Type': types['.xlsx'],
        'Content-Disposition': `attachment; filename="POSCO Wholesale - Ordenes recurrentes.xlsx"`,
        'Cache-Control': 'no-store'
      });
      res.end(body);
    } catch (error) { sendJson(res, 400, { error: error.message }); }
    return;
  }
  if (apiPath === '/api/orders' && req.method === 'PUT') {
    try {
      const payload = await readJsonBody(req);
      if (!Array.isArray(payload.orders)) throw new Error('Órdenes inválidas.');
      await writeSharedOrders(payload.orders);
      sendJson(res, 200, { ok: true });
    } catch (error) { sendJson(res, 400, { error: error.message }); }
    return;
  }
  if (req.method === 'POST' && apiPath === '/api/execute-orders') {
    try {
      const payload = await readJsonBody(req);
      if (!Array.isArray(payload.orders) || payload.orders.length === 0) throw new Error('No hay órdenes para ejecutar.');
      const result = await dispatchPoscoWorkflow(payload.orders);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, runId: result.runId, orders: result.updatedOrders, warning: result.warning, message: 'POSCO actualizó las órdenes y el ciclo fue registrado.' }));
    } catch (error) {
      console.error('No se pudo enviar el workflow POSCO:', error);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, error: error.message || 'No se pudo iniciar GitHub Actions.' }));
    }
    return;
  }
  const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const file = normalize(join(root, relative));
  if (!file.startsWith(root)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Órdenes Automáticas disponible en http://127.0.0.1:${port}`);
});
