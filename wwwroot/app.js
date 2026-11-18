const $ = id => document.getElementById(id);
const page = ({ '/': 'production', '/production': 'production', '/issuance': 'issuance', '/traceability': 'traceability' })[location.pathname] || 'production';
let batches = [], warehouses = [], selected = '', busy = false, operation = null, batchView = null;
let mapping = { level: 'cartons', pallet: '', carton: '', search: '', page: 1, pageSize: 50 };
const status = { Packed: 'Đã đóng pallet', Dispatched: 'Đã xuất nhà máy', Received: 'Đã có kết quả nhận' };
function el(tag, text, className) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (className) e.className = className; return e; }
function notice(text, error = false) { for (const id of ['notice', 'batch-notice']) { $(id).textContent = text; $(id).className = error ? 'error' : ''; } }
function showPage() {
  for (const [id, owner] of Object.entries({ 'production-overview': 'production', production: 'production', issuance: 'issuance', traceability: 'traceability' }))
    $(id).hidden = owner !== page;
  for (const [id, owner] of Object.entries({ 'nav-production': 'production', 'nav-issuance': 'issuance', 'nav-traceability': 'traceability' }))
    $(id).setAttribute('aria-current', owner === page ? 'page' : 'false');
}
function signedIn(user) {
  $('session-loading').hidden = true; $('login').hidden = true; $('workspace').hidden = false; $('main-nav').hidden = false; showPage(); $('session').replaceChildren(el('span', user.fullName || user.name || 'Admin'));
  const logout = el('button', 'Đăng xuất'); logout.onclick = () => run(async () => { await api('/api/session/logout', 'POST'); location.reload(); }); $('session').append(logout);
}
async function api(path, method = 'GET', body, key) {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'Traceability', ...(key ? { 'Idempotency-Key': key } : {}) }, body: body == null ? undefined : JSON.stringify(body) });
  if (response.status === 401) { $('session-loading').hidden = true; $('workspace').hidden = true; $('login').hidden = false; $('main-nav').hidden = true; $('session').replaceChildren(); throw new Error('Vui lòng đăng nhập bằng tài khoản Admin FSCM.'); }
  if (!response.ok) { let message = 'Yêu cầu thất bại (' + response.status + ').'; try { const data = await response.json(); message = data.message || data.detail || message; } catch {} throw new Error(message); }
  return response.status === 204 ? null : response.json();
}
async function run(action) { if (busy) return; busy = true; document.body.classList.add('busy'); notice('Đang xử lý…'); try { await action(); if ($('notice').textContent === 'Đang xử lý…') notice(''); } catch (e) { notice(e.message, true); } finally { busy = false; document.body.classList.remove('busy'); } }
function table(headers, rows) {
  const wrap = el('div', null, 'table-wrap'), t = el('table'), head = el('tr'); headers.forEach(h => head.append(el('th', h))); const thead = el('thead'); thead.append(head); t.append(thead);
  const body = el('tbody'); rows.forEach(cells => { const tr = el('tr'); cells.forEach(value => { const td = el('td'); td.append(value instanceof Node ? value : el('span', value ?? '—')); tr.append(td); }); body.append(tr); });
  t.append(body); wrap.append(t); if (!rows.length) wrap.append(el('div', 'Chưa có dữ liệu.', 'empty')); return wrap;
}
function button(text, action) { const b = el('button', text); b.type = 'button'; b.onclick = () => run(action); return b; }
function link(text, href) { const a = el('a', text, 'button'); a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; }
function code(value) { return el('code', value); }
function date(value) { if (!value) return '—'; const parts = value.slice(0, 10).split('-'); return parts.reverse().join('/'); }
function detail(label, value) { const p = el('p', label); p.append(el('b', value)); return p; }
function batchLabelUrl(id, cartons = false) { return '/api/batches/' + encodeURIComponent(id) + '/labels' + (cartons ? '?cartons=true' : ''); }
function batchActions(id) { const actions = el('div', null, 'row-actions'); actions.append(button('Xem chi tiết', () => openBatch(id)), link('In QR mẻ', batchLabelUrl(id))); return actions; }
function warehouseName(id) { return warehouses.find(w => w.id === id)?.name || 'Chưa phát hành'; }
async function refresh() {
  batches = await api('/api/batches');
  $('stats').replaceChildren(...[['Mẻ sản xuất gần đây', batches.length], ['Pallet đã đóng', batches.reduce((n, b) => n + b.pallets.length, 0)], ['Pallet chờ kho nhận', batches.reduce((n, b) => n + b.pallets.filter(p => p.status === 'Dispatched').length, 0)]].map(([label, value]) => { const d = el('div', label, 'stat'); d.append(el('strong', value)); return d; }));
  $('batches').replaceChildren(table(['Batch', 'SKU / line', 'NSX / HSD', 'Pallet / carton / sản phẩm', 'Thao tác'], batches.map(b => [code(b.batch.code), b.sku + ' · ' + b.batch.productionLine, date(b.batch.productionDate) + ' / ' + date(b.batch.expirationDate), `${b.pallets.length} / ${b.cartonCount} / ${b.unitCount}`, batchActions(b.batch.id)])));
  if (selected && $('batch-dialog').open) await openBatch(selected, false);
}
function saveBatchView() {
  const params = new URLSearchParams({ batch: selected, level: mapping.level, page: String(mapping.page) });
  for (const key of ['pallet', 'carton', 'search']) if (mapping[key]) params.set(key, mapping[key]);
  history.replaceState(null, '', location.pathname + location.search + '#' + params.toString());
}
async function openBatch(id, reset = true) {
  const changed = id !== selected;
  if (reset || changed) mapping = { level: 'cartons', pallet: '', carton: '', search: '', page: 1, pageSize: 50 };
  selected = id; batchView = null;
  $('batch-title').textContent = 'Đang tải chi tiết mẻ…'; $('batch-detail').replaceChildren(); $('mapping-results').replaceChildren();
  if (!$('batch-dialog').open) $('batch-dialog').showModal();
  const loaded = await api('/api/batches/' + encodeURIComponent(id));
  if (!$('batch-dialog').open || selected !== id) return;
  batchView = loaded; renderBatch(); await loadMapping(); notice('');
}
function renderBatch() {
  const view = batchView, section = $('batch-detail'); if (!view) return;
  $('batch-title').textContent = view.batch.code;
  const info = el('div', null, 'detail-grid');
  info.append(detail('SKU / sản phẩm', view.sku + ' · ' + view.productName), detail('Nhà máy / line', view.batch.factoryCode + ' · ' + view.batch.productionLine),
    detail('NSX / HSD', date(view.batch.productionDate) + ' / ' + date(view.batch.expirationDate)),
    detail('Tổng mã đã cấp', `${view.pallets.length} pallet · ${view.cartonCount} carton · ${view.unitCount} sản phẩm`), detail('Đóng gói', view.batch.unitsPerCarton + ' sản phẩm/carton'));
  const labels = el('div', null, 'row-actions label-actions');
  labels.append(link('In QR mẻ (batch + pallet)', batchLabelUrl(view.batch.id)), link('In QR đầy đủ (kèm carton)', batchLabelUrl(view.batch.id, true)));
  section.replaceChildren(info, labels);
  // Each packed pallet is ticked in its own row; the warehouse and the submit button sit above the table.
  const packed = view.pallets.some(p => p.pallet.status === 'Packed'), selectedPallets = new Set();
  if (packed) {
    const form = el('form', null, 'scan dispatch-form'), label = el('label', 'Kho nhận'), select = el('select'); select.required = true; select.append(new Option('Chọn kho nhận', ''));
    warehouses.filter(w => w.isActive).forEach(w => select.append(new Option(w.code + ' · ' + w.name, w.id))); label.append(select); form.append(label);
    form.append(el('button', 'Phát hành pallet đã chọn', 'primary'));
    form.onsubmit = e => { e.preventDefault(); run(async () => {
      if (!selectedPallets.size) throw new Error('Tick chọn ít nhất một pallet cần phát hành.');
      await api('/api/batches/' + view.batch.id + '/dispatch', 'POST', { destinationWarehouseId: select.value, palletIds: [...selectedPallets] }); await refresh(); notice('Đã phát hành pallet. Thủ kho có thể quét nhận trên phiếu nhập FSCM.'); }); };
    section.append(form);
  }
  section.append(table([...(packed ? ['Chọn'] : []), 'Pallet code', 'Carton', 'Sản phẩm', 'Trạng thái', 'Kho đích', 'QR'], view.pallets.map(row => {
    const p = row.pallet, actions = el('div', null, 'row-actions');
    actions.append(button('Xem carton', () => chooseMapping(p.code)), link('In QR', '/api/pallets/' + encodeURIComponent(p.code) + '/labels'));
    const cells = [code(p.code), row.cartonCount, row.unitCount, status[p.status], warehouseName(p.destinationWarehouseId), actions];
    if (!packed) return cells;
    if (p.status !== 'Packed') return ['', ...cells];
    const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.className = 'pallet-check'; checkbox.setAttribute('aria-label', 'Chọn phát hành ' + p.code);
    checkbox.onchange = () => checkbox.checked ? selectedPallets.add(p.id) : selectedPallets.delete(p.id);
    return [checkbox, ...cells];
  })));
  const inspectionRows = view.pallets.flatMap(({ pallet }) => {
    if (!pallet.receiptInspectionJson) return [];
    try { return JSON.parse(pallet.receiptInspectionJson).map(c => [code(pallet.code), code(c.CartonCode),
      ({ Accepted: 'Đạt', Damaged: 'Hỏng · cách ly', Missing: 'Thiếu' })[c.Disposition], c.Reason || '—', c.QuarantineLocation || '—']); }
    catch { return [[code(pallet.code), 'Biên bản không đọc được', '', '', '']]; }
  });
  if (inspectionRows.length) {
    section.append(el('h3', 'Kết quả kiểm đếm tại kho'), table(['Pallet', 'CID', 'Kết quả', 'Lý do', 'Vị trí cách ly'], inspectionRows));
  }
  $('mapping-pallet').replaceChildren(new Option('Tất cả pallet', ''));
  view.pallets.forEach(row => $('mapping-pallet').append(new Option(row.pallet.code, row.pallet.code)));
  $('mapping-pallet').value = mapping.pallet; $('mapping-search').value = mapping.search;
}
async function chooseMapping(pallet = mapping.pallet) {
  mapping = { ...mapping, level: 'cartons', pallet, carton: '', search: '', page: 1 };
  $('mapping-search').value = ''; $('mapping-pallet').value = pallet;
  await loadMapping(); $('mapping-results').scrollIntoView({ block: 'nearest' });
}
// Serials of one carton in their own popup, 10 per page, read from the same mapping API.
const SERIAL_PAGE_SIZE = 10;
let serialView = null;
async function openSerials(pallet, carton, page = 1) {
  const batch = selected; serialView = { batch, pallet, carton, page };
  $('serial-title').textContent = carton; $('serial-scope').textContent = [batchView?.batch.code, pallet, carton].filter(Boolean).join(' → ');
  if (!$('serial-dialog').open) { $('serial-results').replaceChildren(); $('serial-pager').replaceChildren(); $('serial-dialog').showModal(); }
  const params = new URLSearchParams({ level: 'units', pallet, carton, page: String(page), pageSize: String(SERIAL_PAGE_SIZE) });
  const result = await api('/api/batches/' + encodeURIComponent(batch) + '/mapping?' + params.toString());
  if (!$('serial-dialog').open || serialView?.carton !== carton || serialView.batch !== batch) return;
  const pages = Math.max(1, Math.ceil(result.totalCount / result.pageSize));
  if (result.page > pages) return openSerials(pallet, carton, pages);
  serialView.page = result.page;
  $('serial-results').replaceChildren(table(['STT', 'Serial sản phẩm', 'SKU', 'NSX / HSD'], result.items.map((row, i) => [
    String((result.page - 1) * result.pageSize + i + 1), code(row.unitCode), row.sku, date(row.productionDate) + ' / ' + date(row.expirationDate)])));
  const controls = el('div', null, 'pager-buttons');
  const previous = button('Trang trước', () => openSerials(pallet, carton, result.page - 1)); previous.disabled = result.page <= 1;
  const next = button('Trang sau', () => openSerials(pallet, carton, result.page + 1)); next.disabled = result.page >= pages;
  controls.append(previous, next);
  $('serial-pager').replaceChildren(el('span', `${result.totalCount} serial · Trang ${result.page}/${pages}`), controls);
}
async function loadMapping() {
  const params = new URLSearchParams({ level: mapping.level, page: String(mapping.page), pageSize: String(mapping.pageSize) });
  for (const key of ['pallet', 'carton', 'search']) if (mapping[key]) params.set(key, mapping[key]);
  const requestedBatch = selected;
  const result = await api('/api/batches/' + encodeURIComponent(requestedBatch) + '/mapping?' + params.toString());
  if (!$('batch-dialog').open || selected !== requestedBatch || !batchView) return;
  const lastPage = Math.max(1, Math.ceil(result.totalCount / result.pageSize));
  if (result.page > lastPage) { mapping.page = lastPage; return loadMapping(); }
  $('mapping-scope').textContent = [batchView.batch.code, mapping.pallet].filter(Boolean).join(' → ');
  $('mapping-results').replaceChildren(table(['Pallet', 'Carton', 'Serial sản phẩm', 'QR'], result.items.map(row => {
    const actions = el('div', null, 'row-actions'); actions.append(link('In QR sản phẩm', '/api/cartons/' + encodeURIComponent(row.cartonCode) + '/unit-labels'));
    return [code(row.palletCode), code(row.cartonCode), button(`Hiện các serial (${row.unitsInCarton})`, () => openSerials(row.palletCode, row.cartonCode)), actions];
  })));
  const pages = Math.max(1, Math.ceil(result.totalCount / result.pageSize)), summary = el('span', `${result.totalCount} carton · Trang ${result.page}/${pages}`), controls = el('div', null, 'pager-buttons');
  const previous = button('Trang trước', async () => { mapping.page--; await loadMapping(); }); previous.disabled = result.page <= 1;
  const next = button('Trang sau', async () => { mapping.page++; await loadMapping(); }); next.disabled = result.page >= pages;
  controls.append(previous, next); $('mapping-pager').replaceChildren(summary, controls); saveBatchView();
}
async function restoreBatchView() {
  const params = new URLSearchParams(location.hash.slice(1)), id = params.get('batch');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return;
  selected = id;
  // Older links may carry level=units / carton=...; the single carton+serial table ignores them.
  mapping = { ...mapping, level: 'cartons', pallet: params.get('pallet') || '', carton: '', search: params.get('search') || '', page: Math.max(1, Math.min(1000000, Number(params.get('page')) || 1)) };
  await openBatch(id, false);
}
$('close-batch').onclick = () => $('batch-dialog').close();
$('close-serial').onclick = () => $('serial-dialog').close();
$('serial-dialog').addEventListener('close', () => { serialView = null; });
$('batch-dialog').addEventListener('close', () => { selected = ''; batchView = null; history.replaceState(null, '', location.pathname + location.search); });
$('mapping-filter').onsubmit = e => { e.preventDefault(); run(async () => { mapping = { ...mapping, pallet: $('mapping-pallet').value, carton: '', search: $('mapping-search').value.trim(), page: 1 }; await loadMapping(); }); };
$('mapping-reset').onclick = () => run(() => chooseMapping(''));
async function loadCatalog() {
  const products = await api('/api/catalog/products'); warehouses = await api('/api/catalog/warehouses');
  $('products').replaceChildren(new Option('Chọn SKU đang phát hành', '')); products.filter(p => p.status === 'Published').forEach(p => $('products').append(new Option(p.sku + ' · ' + p.name, p.id)));
}
function total() { const data = new FormData($('production-form')); const cartons = Number(data.get('palletCount')) * Number(data.get('cartonsPerPallet')); $('production-total').textContent = `${cartons} carton · ${cartons * Number(data.get('unitsPerCarton'))} sản phẩm (tối đa 50.000/mẻ)`; }
$('production-date').value = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }); $('production-form').oninput = total; total();
$('login-form').onsubmit = e => { e.preventDefault(); run(async () => { const data = Object.fromEntries(new FormData(e.target)); const user = await api('/api/session/login', 'POST', data); e.target.reset(); signedIn(user); await loadCatalog(); await refresh(); await restoreBatchView(); notice(''); }); };
$('production-form').onsubmit = e => { e.preventDefault(); run(async () => {
  const data = Object.fromEntries(new FormData(e.target)); ['palletCount', 'cartonsPerPallet', 'unitsPerCarton'].forEach(k => data[k] = Number(data[k]));
  const fingerprint = JSON.stringify(data); if (operation?.fingerprint !== fingerprint) operation = { fingerprint, key: crypto.randomUUID() };
  const result = await api('/api/batches/simulate', 'POST', data, operation.key); operation = null; await refresh(); await openBatch(result.id); notice('Đã cấp batch, serial, carton và pallet tại nhà máy. Bấm "In QR mẻ" để in nhãn QR. Hàng chưa được nhập tồn FSCM.');
}); };
$('refresh').onclick = () => run(async () => { await loadCatalog(); await refresh(); notice('Đã làm mới dữ liệu.'); });
$('trace-form').onsubmit = e => { e.preventDefault(); run(async () => {
  const value = new FormData(e.target).get('code').trim(), t = await api('/api/trace?code=' + encodeURIComponent(value)), section = $('trace-result');
  const info = el('div', null, 'detail-grid'); info.append(detail('Batch', t.batch.code), detail('SKU / line', t.sku + ' · ' + t.batch.productionLine), detail('NSX / HSD', date(t.batch.productionDate) + ' / ' + date(t.batch.expirationDate)), detail('Pallet gốc', t.pallet?.code || 'Tra theo batch'), detail('Carton', t.carton?.code || '—'), detail('Serial', t.unit?.code || '—')); section.replaceChildren(info, button('Mở chi tiết mẻ và mapping', () => openBatch(t.batch.id)));
  section.append(el('p', t.pallet ? 'Trạng thái nhà máy: ' + status[t.pallet.status] + '. Vị trí tồn hiện tại và lịch sử chứng từ xem tại FSCM.' : t.cartonCodes.length + ' carton thuộc phạm vi truy xuất.'));
  section.append(table(['Carton trong phạm vi truy xuất'], t.cartonCodes.map(c => [code(c)])));
  if (t.units.length) section.append(table(['STT', 'Serial sản phẩm trong carton'], t.units.map(u => [u.sequence, code(u.code)]))); notice('');
}); };
(async () => { try { const user = await api('/api/session'); signedIn(user); await loadCatalog(); await refresh(); await restoreBatchView(); notice(''); } catch (e) { if (!$('login').hidden) notice(''); else notice(e.message, true); } })();
