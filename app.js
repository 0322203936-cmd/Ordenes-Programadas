const STORAGE_KEY = 'ordenes-automaticas.v1';
const RUNS_KEY = 'ordenes-automaticas.runs.v1';
const DISTRIBUTOR = 'PACIFICA PRODUCE FARMS';
const demoOrders = [
  { client:'Operers', description:'1 x 15 Matricaria Daisy', executionWeekday:'Martes', loadWeekday:'Viernes', flower:'Matricaria', color:'Daisy', boxes:1, stems:15, boxType:'' },
  { client:'Dr Delphinium', description:'3 x 15 Burgundy Snaps', executionWeekday:'Martes', loadWeekday:'Viernes', flower:'Burgundy Snaps', color:'', boxes:3, stems:15, boxType:'' },
  { client:'Dr Delphinium', description:'2 x 10 Safflowers', executionWeekday:'Martes', loadWeekday:'Viernes', flower:'Safflowers', color:'', boxes:2, stems:10, boxType:'' },
  { client:'Dr Delphinium', description:'3 x 10 Marigold Orange', executionWeekday:'Martes', loadWeekday:'Viernes', flower:'Marigold', color:'Orange', boxes:3, stems:10, boxType:'' },
  { client:'Allan Flowers', description:'2 x 15 Matricaria', executionWeekday:'Martes', loadWeekday:'Lunes', flower:'Matricaria', color:'', boxes:2, stems:15, boxType:'' },
  { client:'Allan Flowers', description:'3 x 15 Matricaria', executionWeekday:'Martes', loadWeekday:'Viernes', flower:'Matricaria', color:'', boxes:3, stems:15, boxType:'' },
  { client:'Amy', description:'Veldkamps', executionWeekday:'Martes', loadWeekday:'Viernes', flower:'Veldkamps', color:'', boxes:1, stems:15, boxType:'' }
].map((order, index) => ({ id: `demo-${index + 1}`, distributor:DISTRIBUTOR, customer:'WHOLESALE', weekday:order.loadWeekday, startDate:'2026-11-02', endDate:'', active:true, ...order }));

const $ = (id) => document.getElementById(id);
function buildDescription(order) { return `${order.boxes} x ${order.stems} ${order.flower}${order.color ? ` ${order.color}` : ''}`.trim(); }
function normalizeOrder(order) {
  const loadWeekday = order.loadWeekday || order.weekday || 'Viernes';
  const client = order.client || order.customer || '';
  return { ...order, distributor:DISTRIBUTOR, client, customer:order.client ? (order.customer || 'WHOLESALE') : 'WHOLESALE', executionWeekday:order.executionWeekday || 'Martes', loadWeekday, weekday:loadWeekday, pack:order.pack ?? '', description:order.description || buildDescription(order) };
}
function loadOrders() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(saved) ? saved.map(normalizeOrder) : structuredClone(demoOrders);
  } catch { return structuredClone(demoOrders); }
}
// the orders live on the server (everyone sees the same ones); the browser keeps a copy in case it is offline
function saveOrders() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
  fetch('/api/orders', { method:'PUT', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ orders }) })
    .then(r => { if (!r.ok) throw new Error(); })
    .catch(() => alert('No se pudo guardar en el servidor. Revisa la conexión e intenta de nuevo.'));
}
async function loadServerOrders() {
  try {
    const response = await fetch('/api/orders', { cache:'no-store' });
    if (!response.ok) return;
    const saved = await response.json();
    if (!Array.isArray(saved)) return;
    orders = saved.map(normalizeOrder);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
    render();
  } catch {}
}
function loadRuns() { try { const saved = JSON.parse(localStorage.getItem(RUNS_KEY)); return saved && typeof saved === 'object' ? saved : {}; } catch { return {}; } }
function saveRuns(runs) { localStorage.setItem(RUNS_KEY, JSON.stringify(runs)); }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function formatDate(value) { if (!value) return 'Sin fecha'; return new Intl.DateTimeFormat('es-MX',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'}).format(new Date(`${value}T00:00:00Z`)); }
function dateMinusDays(value, days) { if (!value) return ''; const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - days); return date.toISOString().slice(0,10); }
function buildOrderNo(customer, loadDate) { return customer && loadDate ? `${customer} - ${formatDate(loadDate)}` : ''; }
function weekdayNumber(day) { return {Domingo:0,Lunes:1,Martes:2,Miércoles:3,Jueves:4,Viernes:5,Sábado:6}[day] ?? 5; }
function nextScheduledLoadDate(executionDay, loadDay) {
  const today = new Date(); today.setHours(0,0,0,0);
  const execution = new Date(today);
  let executionOffset = (weekdayNumber(executionDay) - execution.getDay() + 7) % 7;
  if (executionOffset === 0) executionOffset = 7;
  execution.setDate(execution.getDate() + executionOffset);
  const loadOffset = (weekdayNumber(loadDay) - execution.getDay() + 7) % 7;
  execution.setDate(execution.getDate() + loadOffset);
  return execution.toISOString().slice(0,10);
}
function cycleKey(order, date = new Date()) { return `${cycleStartOf(date).toISOString().slice(0,10)}|${order.executionWeekday || 'Martes'}`; }
function datePlusDays(value, days) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0,10); }
function cycleStartOf(date) { const d = new Date(date); d.setHours(0,0,0,0); const diff = (d.getDay() - 2 + 7) % 7; d.setDate(d.getDate() - diff); return d; }
function dateForDay(cycleStart, weekday) { const offsets = {Martes:0,Miércoles:1,Jueves:2,Viernes:3,Sábado:4,Domingo:5,Lunes:6}; const d = new Date(cycleStart); d.setDate(d.getDate() + (offsets[weekday] ?? 0)); return d; }
function activeAt(order, date) { const iso = date.toISOString().slice(0,10); return order.active && order.startDate <= iso && (!order.endDate || order.endDate >= iso); }

let orders = loadOrders();
function render() {
  const filtered = orders;
  $('ordersBody').innerHTML = filtered.map(o => `<tr>
    <td><span class="badge ${o.active?'active':'paused'}">${o.active?'Activa':'Pausada'}</span></td>
    <td class="customer">${esc(o.client)}</td><td>${esc(o.executionWeekday || 'Martes')}</td><td>${esc(o.loadWeekday || o.weekday)}</td>
    <td class="product">${esc(o.flower)}<small>${esc(o.description || o.color || 'Sin descripción')} ${o.boxType ? `· ${esc(o.boxType)}` : ''}</small></td>
    <td class="num">${o.boxes}</td><td class="num">${esc(o.pack || '—')}</td><td class="num">${o.stems}</td>
    <td>${formatDate(o.startDate)}${o.endDate ? ` → ${formatDate(o.endDate)}` : ' → Indefinida'}</td>
    <td><div class="row-actions"><button class="icon-button" data-action="toggle" data-id="${o.id}">${o.active?'Pausar':'Activar'}</button><button class="icon-button" data-action="edit" data-id="${o.id}">Editar</button><button class="icon-button" data-action="delete" data-id="${o.id}">×</button></div></td>
  </tr>`).join('');
  $('emptyState').hidden = filtered.length > 0;
  renderWeeks(orders.filter(o => o.active));
}
function renderWeeks(active) {
  const first = cycleStartOf(new Date());
  $('upcomingWeeks').innerHTML = [0,1,2].map(index => {
    const cycleStart = new Date(first); cycleStart.setDate(cycleStart.getDate()+index*7);
    const lines = active.filter(o => activeAt(o,dateForDay(cycleStart,o.loadWeekday || o.weekday)));
    return `<article class="week-card"><h3>${index===0?'Semana actual':index===1?'Próxima semana':'En 2 semanas'}</h3><div class="week-date">${formatDate(cycleStart.toISOString().slice(0,10))} al ${formatDate(new Date(cycleStart.getTime()+6*86400000).toISOString().slice(0,10))}</div>${lines.length ? lines.map(o=>`<div class="week-line"><span>${esc(o.client)}<small>${esc(o.description || o.flower)}</small></span><strong>${o.boxes} × ${o.stems}</strong></div>`).join('') : '<div class="week-date">Sin órdenes activas</div>'}</article>`;
  }).join('');
}
function updateDerivedFields() {
  $('orderNo').value = buildOrderNo($('client').value.trim(), $('startDate').value);
  $('productionDate').value = dateMinusDays($('startDate').value, 2);
}
function openForm(order) {
  $('dialogTitle').textContent = order ? 'Editar orden' : 'Nueva orden';
  $('orderId').value = order?.id || '';
  $('distributor').value = DISTRIBUTOR;
  $('client').value = order?.client ?? '';
  $('customer').value = order?.customer || 'WHOLESALE';
  $('description').value = order?.description ?? '';
  $('flower').value = order?.flower ?? '';
  $('boxes').value = order?.boxes ?? 1;
  $('pack').value = order?.pack ?? '';
  $('stems').value = order?.stems ?? 1;
  $('executionWeekday').value = order?.executionWeekday || 'Martes';
  $('loadWeekday').value = order?.loadWeekday || order?.weekday || 'Viernes';
  $('startDate').value = order?.startDate || nextScheduledLoadDate('Martes', 'Viernes');
  $('endDate').value = order?.endDate ?? '';
  $('active').checked = order ? order.active : true;
  updateDerivedFields();
  $('orderDialog').showModal();
}
async function executeOrders() {
  const pendingOrders = orders.filter(order => order.active && order.startDate);
  if (!pendingOrders.length) return alert('No hay órdenes activas listas para ejecutar.');
  const button = $('executeOrders');
  button.disabled = true;
  button.textContent = 'Procesando en POSCO...';
  try {
    const response = await fetch('/api/execute-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders: pendingOrders })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'No se pudo iniciar GitHub Actions.');
    if (Array.isArray(result.orders)) {
      orders = result.orders.map(normalizeOrder);
      saveOrders();
      render();
    }
    alert(`POSCO actualizó las órdenes correctamente. El ciclo quedó registrado y las fechas avanzaron 7 días. Run: ${result.runId || 'completado'}`);
  } catch (error) {
    alert(`No se pudo ejecutar el bot: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Ejecutar órdenes';
  }
}
function downloadFormat() {
  const link = document.createElement('a');
  link.href = './Formato_POSCO_Wholesale.xlsx';
  link.download = 'POSCO Wholesale - Formato.xlsx';
  document.body.appendChild(link); link.click(); link.remove();
}

$('newOrder').addEventListener('click',()=>openForm());
$('downloadFormat').addEventListener('click', downloadFormat);
$('executeOrders').addEventListener('click', executeOrders);
$('closeDialog').addEventListener('click', () => $('orderDialog').close('cancel'));
$('cancelOrder').addEventListener('click', () => $('orderDialog').close('cancel'));
$('client').addEventListener('input', updateDerivedFields);
$('startDate').addEventListener('input', updateDerivedFields);
$('executionWeekday').addEventListener('change', () => { if (!$('orderId').value) { $('startDate').value = nextScheduledLoadDate($('executionWeekday').value, $('loadWeekday').value); updateDerivedFields(); } });
$('loadWeekday').addEventListener('change', () => { if (!$('orderId').value) { $('startDate').value = nextScheduledLoadDate($('executionWeekday').value, $('loadWeekday').value); updateDerivedFields(); } });
$('ordersBody').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const order = orders.find(o=>o.id===button.dataset.id); if (!order) return;
  if (button.dataset.action==='toggle') order.active=!order.active;
  if (button.dataset.action==='edit') return openForm(order);
  if (button.dataset.action==='delete' && confirm('¿Eliminar esta orden recurrente?')) orders=orders.filter(o=>o.id!==order.id);
  saveOrders(); render();
});
$('orderForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = {
    orderId:$('orderId').value,
    client:$('client').value,
    description:$('description').value,
    boxes:$('boxes').value,
    pack:$('pack').value,
    stems:$('stems').value,
    executionWeekday:$('executionWeekday').value,
    loadWeekday:$('loadWeekday').value,
    startDate:$('startDate').value,
    endDate:$('endDate').value,
    flower:$('flower').value
  };
  const boxes = Number(data.boxes), stems = Number(data.stems);
  if (!Number.isInteger(boxes) || boxes < 1 || !Number.isInteger(stems) || stems < 1) return alert('Cajas y Stems deben ser números enteros mayores que cero.');
  if (data.endDate && data.endDate < data.startDate) return alert('La fecha final no puede ser anterior a la fecha de inicio.');
  const order = { id:data.orderId || crypto.randomUUID(), distributor:DISTRIBUTOR, client:data.client.trim(), customer:'WHOLESALE', description:data.description.trim(), orderNo:buildOrderNo(data.client.trim(), data.startDate), executionWeekday:data.executionWeekday, loadWeekday:data.loadWeekday, weekday:data.loadWeekday, flower:data.flower.trim(), color:'', boxes, pack:data.pack.trim(), stems, boxType:'', startDate:data.startDate, endDate:data.endDate, active:$('active').checked };
  const index=orders.findIndex(o=>o.id===order.id); if(index>=0) orders[index]=order; else orders.push(order);
  saveOrders(); $('orderDialog').close(); render();
});
render();
loadServerOrders();
