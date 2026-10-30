import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4170);
const execFileAsync = promisify(execFile);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

async function readJsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2_000_000) throw new Error('La configuración es demasiado grande.');
  }
  return JSON.parse(body || '{}');
}

async function dispatchPoscoWorkflow(orders) {
  const ordersFile = join(root, 'orders.json');
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
  await execFileAsync(gh, ['workflow', 'run', 'posco-review.yml', '--repo', '0322203936-cmd/Ordenes-Programadas', '--ref', 'master', '--field', 'orders_file=orders.json'], { cwd: root });
}

createServer(async (req, res) => {
  if (req.method === 'POST' && (req.url || '').split('?')[0] === '/api/execute-orders') {
    try {
      const payload = await readJsonBody(req);
      if (!Array.isArray(payload.orders) || payload.orders.length === 0) throw new Error('No hay órdenes para ejecutar.');
      await dispatchPoscoWorkflow(payload.orders);
      res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, message: 'Workflow de POSCO enviado a GitHub Actions.' }));
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
