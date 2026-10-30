import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import XLSX from 'xlsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(root, 'artifacts');
const poscoUrl = process.env.POSCO_URL || 'http://3.132.9.174/Posco/';
const poscoUser = process.env.POSCO_USER;
const poscoPassword = process.env.POSCO_PASSWORD;
const ordersPath = resolve(root, process.env.ORDERS_FILE || 'orders.json');
const templatePath = resolve(root, process.env.TEMPLATE_FILE || 'Formato_POSCO_Wholesale.xlsx');

if (!poscoUser || !poscoPassword) {
  throw new Error('Faltan POSCO_USER y POSCO_PASSWORD en los secretos de GitHub Actions.');
}

const esc = (value) => String(value ?? '').trim();
const dateMinusDays = (value, days) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

function buildWorkbook(orders) {
  const workbook = XLSX.readFile(templatePath, { cellStyles: true, cellDates: true });
  const sheet = workbook.Sheets['New Order'] || workbook.Sheets[workbook.SheetNames[0]];
  const templateRow = 1;
  const endColumn = 12;
  const templateCells = Array.from({ length: endColumn + 1 }, (_, column) =>
    sheet[XLSX.utils.encode_cell({ r: templateRow, c: column })] || {}
  );
  const rows = orders.filter((order) => order.active !== false && order.startDate).map((order) => [
    'PACIFICA PRODUCE FARMS',
    'WHOLESALE',
    esc(order.description),
    esc(order.orderNo) || `${esc(order.client)} - ${order.startDate.split('-').reverse().join('/')}`,
    '',
    esc(order.flower),
    '',
    new Date(`${order.startDate}T00:00:00`),
    Number(order.boxes),
    esc(order.pack),
    Number(order.stems),
    new Date(`${dateMinusDays(order.startDate, 2)}T00:00:00`),
    ''
  ]);
  if (!rows.length) throw new Error('orders.json no contiene órdenes activas con startDate.');

  const oldRange = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : { e: { r: 1 } };
  for (let row = 1; row <= Math.max(oldRange.e.r, rows.length); row++) {
    for (let column = 0; column <= endColumn; column++) {
      delete sheet[XLSX.utils.encode_cell({ r: row, c: column })];
    }
  }
  rows.forEach((values, rowIndex) => values.forEach((value, column) => {
    const template = templateCells[column];
    const cell = { ...template, v: value };
    cell.t = value instanceof Date ? 'd' : typeof value === 'number' ? 'n' : 's';
    sheet[XLSX.utils.encode_cell({ r: rowIndex + 1, c: column })] = cell;
  }));
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: endColumn } });
  return workbook;
}

async function screenshot(page, name) {
  await page.screenshot({ path: resolve(outputDir, name), fullPage: true });
}

async function clickVisibleText(page, value) {
  const candidates = [
    page.getByRole('button', { name: value, exact: true }),
    page.getByRole('link', { name: value, exact: true }),
    page.getByText(value, { exact: true })
  ];
  for (const candidate of candidates) {
    for (let index = 0; index < await candidate.count(); index += 1) {
      const element = candidate.nth(index);
      if (await element.isVisible()) {
        await element.click({ timeout: 15000 });
        return;
      }
    }
  }
  throw new Error(`No se encontró el control visible ${value} en POSCO.`);
}

async function loginToPosco(page) {
  const userInput = page.locator('input[placeholder*="usuario@email.com" i], input[type="text"]').first();
  const passwordInput = page.locator('input[placeholder*="Password" i], input[type="password"]').first();
  await userInput.waitFor({ state: 'visible', timeout: 60000 });
  await passwordInput.waitFor({ state: 'visible', timeout: 60000 });
  await userInput.fill(poscoUser);
  await passwordInput.fill(poscoPassword);
  await clickVisibleText(page, 'Iniciar Sesión');
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await passwordInput.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log('Sesión POSCO iniciada.');
}

async function openOrdersSection(page) {
  await clickVisibleText(page, 'Ordenes');
  await page.waitForTimeout(800);
  const route = page.locator('a[href="#/revisar-ordenes"]:visible').first();
  await route.waitFor({ state: 'visible', timeout: 15000 });
  await route.click({ timeout: 15000 });
  await page.waitForURL('**/#/revisar-ordenes', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
}

await mkdir(outputDir, { recursive: true });
const orders = JSON.parse(await readFile(ordersPath, 'utf8'));
const workbook = buildWorkbook(orders);
const uploadPath = resolve(outputDir, 'POSCO Wholesale - Ordenes recurrentes.xlsx');
XLSX.writeFile(workbook, uploadPath);
await writeFile(resolve(outputDir, 'orders-used.json'), JSON.stringify(orders, null, 2));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
try {
  await page.goto(poscoUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await screenshot(page, '01-posco-inicio.png');

  await loginToPosco(page);
  await openOrdersSection(page);
  await screenshot(page, '02-ordenes.png');

  // En esta ruta el botón Revisar Archivo pertenece al módulo Revisar Órdenes.
  await clickVisibleText(page, 'Revisar Archivo');
  const modal = page.locator('app-modal').filter({ hasText: 'Import excel' });
  const fileInput = modal.locator('input[type="file"]');
  await fileInput.setInputFiles(uploadPath);
  const mode = modal.locator('select[name="upload_mode"]');
  if (await mode.count()) await mode.selectOption('pacifica2');
  await screenshot(page, '03-archivo-cargado.png');
  await modal.getByRole('button', { name: /^Upload$/i }).click();
  await page.waitForTimeout(8000);
  await screenshot(page, '04-revision-posco.png');
  console.log('POSCO quedó en revisión. No se pulsó Actualizar.');
} finally {
  await browser.close();
}
