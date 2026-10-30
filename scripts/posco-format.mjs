// POSCO Wholesale format filled with the active orders: the file the bot uploads to POSCO and the
// one "Descargar Formato" gives (same function, so both are always the same)
import XLSX from 'xlsx';

const esc = (value) => String(value ?? '').trim();
export const dateMinusDays = (value, days) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

export function buildWorkbook(orders, templatePath) {
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
