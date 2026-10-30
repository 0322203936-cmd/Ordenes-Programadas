import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const graphUrl = 'https://graph.microsoft.com/v1.0';
const defaultRecipients = [
  'jesus.sandoval@cfbc.co',
  'gaston.gutierrez@cfbc.co',
  'Irene.Machain@Pacifica-farms.com',
  'roberto.gomez@cfbc.co'
];

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

function requiredEnv(...names) {
  for (const name of names) {
    const value = clean(process.env[name]);
    if (value) return value;
  }
  throw new Error(`Falta configurar ${names.join(' o ')} en GitHub Actions.`);
}

function parseRecipients() {
  const configured = clean(process.env.POSCO_ORDER_RECIPIENTS);
  const values = configured ? configured.split(/[;,\r\n]+/) : defaultRecipients;
  const recipients = [];
  const seen = new Set();
  for (const value of values) {
    const address = clean(value).includes('|') ? clean(value).split('|').pop() : clean(value);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      throw new Error(`Destinatario inválido: ${address || '(vacío)'}.`);
    }
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({ address });
  }
  if (!recipients.length) throw new Error('No hay destinatarios configurados.');
  return recipients;
}

async function graphToken() {
  const tenant = requiredEnv('SHAREPOINT_TENANT_ID', 'GRAPH_TENANT_ID');
  const clientId = requiredEnv('SHAREPOINT_CLIENT_ID', 'GRAPH_CLIENT_ID');
  const clientSecret = requiredEnv('SHAREPOINT_CLIENT_SECRET', 'GRAPH_CLIENT_SECRET');
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!response.ok) throw new Error(`Microsoft Graph no autorizó el token (${response.status}).`);
  const payload = await response.json();
  if (!payload.access_token) throw new Error('Microsoft Graph no devolvió un token de acceso.');
  return payload.access_token;
}

function htmlEscape(value) {
  return clean(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fileAttachment(name, contentType, buffer) {
  return {
    '@odata.type': '#microsoft.graph.fileAttachment',
    name,
    contentType,
    contentBytes: buffer.toString('base64')
  };
}

const orders = JSON.parse(await readFile(resolve(root, 'orders-used.json'), 'utf8'));
const execution = JSON.parse(await readFile(resolve(root, 'execution-log.json'), 'utf8'));
const workbookName = 'POSCO Wholesale - Ordenes recurrentes.xlsx';
const workbook = await readFile(resolve(root, 'artifacts', workbookName));
const loadDates = Array.isArray(execution.loadDates) ? execution.loadDates.join(', ') : 'N/D';
const activeOrders = orders.filter((order) => order.active !== false && order.startDate);
const sender = clean(process.env.POSCO_ORDER_SENDER || process.env.MAIL_SENDER) || 'noreply@cfbc.co';
const recipients = parseRecipients();
const token = await graphToken();

const body = `<p>Hola equipo,</p>`
  + `<p>La actualización automática de las órdenes recurrentes se completó correctamente en POSCO.</p>`
  + `<p>Adjunto encontrarán el archivo utilizado para la carga.</p>`
  + `<p><strong>Resumen de la actualización:</strong><br>`
  + `• Load Dates procesadas: <strong>${htmlEscape(loadDates)}</strong><br>`
  + `• Órdenes cargadas: <strong>${activeOrders.length}</strong><br>`
  + '• Estado: <strong>Actualizado correctamente</strong></p>'
  + '<p>El siguiente ciclo quedó programado.</p>'
  + '<p>Saludos.</p>';

const payload = {
  message: {
    subject: `Confirmación de carga POSCO - Órdenes recurrentes - ${loadDates}`,
    body: { contentType: 'HTML', content: body },
    toRecipients: recipients.map(({ address }) => ({ emailAddress: { address } })),
    ccRecipients: [],
    bccRecipients: [],
    attachments: [fileAttachment(
      workbookName,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      workbook
    )]
  },
  saveToSentItems: true
};

const response = await fetch(`${graphUrl}/users/${encodeURIComponent(sender)}/sendMail`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
if (!response.ok) {
  const detail = (await response.text()).slice(0, 500);
  throw new Error(`Microsoft Graph rechazó el correo (${response.status}). ${detail}`);
}
console.log(`Correo de actualización enviado desde ${sender} a ${recipients.map(({ address }) => address).join(', ')}.`);
