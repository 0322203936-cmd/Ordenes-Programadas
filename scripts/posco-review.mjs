import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import XLSX from 'xlsx';
import { buildWorkbook } from './posco-format.mjs';

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
const datePlusDays = (value, days) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

function advanceProcessedOrders(sourceOrders, processedAt) {
  return sourceOrders.map((order) => {
    if (order.active === false || !order.startDate) return order;
    const previousLoadDate = order.startDate;
    const nextLoadDate = datePlusDays(previousLoadDate, 7);
    return {
      ...order,
      startDate: nextLoadDate,
      orderNo: `${esc(order.client)} - ${nextLoadDate.split('-').reverse().join('/')}`,
      lastProcessedLoadDate: previousLoadDate,
      lastProcessedAt: processedAt
    };
  });
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
const workbook = buildWorkbook(orders, templatePath);
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
  if (!(await mode.count())) throw new Error('No se encontró el selector Formato en el diálogo Import excel.');
  await mode.selectOption('pacifica2');
  const selectedMode = esc(await mode.locator('option:checked').textContent());
  if (!/Pacifica\s*-\s*Andres Terriquez/i.test(selectedMode)) {
    throw new Error(`Formato POSCO incorrecto: ${selectedMode || 'sin selección'}.`);
  }
  console.log(`Archivo cargado y formato seleccionado: ${selectedMode}.`);
  await screenshot(page, '03-archivo-cargado.png');
  const uploadButton = modal.getByRole('button', { name: /^Upload$/i });
  await uploadButton.waitFor({ state: 'visible', timeout: 15000 });
  const enabledUntil = Date.now() + 15000;
  while (!(await uploadButton.isEnabled())) {
    if (Date.now() >= enabledUntil) throw new Error('El botón Upload no se habilitó después de seleccionar el archivo y el formato.');
    await page.waitForTimeout(250);
  }
  await uploadButton.click();
  await page.waitForTimeout(8000);
  await screenshot(page, '04-revision-posco.png');

  const updateButton = page.getByRole('button', { name: 'Actualizar', exact: true });
  await updateButton.waitFor({ state: 'visible', timeout: 30000 });
  const updateEnabledUntil = Date.now() + 30000;
  while (!(await updateButton.isEnabled())) {
    if (Date.now() >= updateEnabledUntil) throw new Error('El botón Actualizar no se habilitó en POSCO.');
    await page.waitForTimeout(250);
  }
  await updateButton.click();
  await page.getByText('Ordenes Actualizadas', { exact: true }).waitFor({ state: 'visible', timeout: 120000 });
  await screenshot(page, '05-actualizado-posco.png');

  const processedAt = new Date().toISOString();
  const advancedOrders = advanceProcessedOrders(orders, processedAt);
  await writeFile(ordersPath, `${JSON.stringify(advancedOrders, null, 2)}\n`);
  await writeFile(resolve(root, 'execution-log.json'), `${JSON.stringify({
    processedAt,
    loadDates: orders.filter((order) => order.active !== false && order.startDate).map((order) => order.startDate),
    workflowRun: process.env.GITHUB_RUN_ID || null
  }, null, 2)}\n`);
  console.log(`POSCO actualizó las órdenes. Ciclo registrado y fechas avanzadas ${orders.length ? '7 días' : ''}.`);
} finally {
  await browser.close();
}
