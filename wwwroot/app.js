const $ = id => document.getElementById(id);
const page = ({ '/': 'production', '/production': 'production', '/issuance': 'issuance', '/traceability': 'traceability', '/master-data': 'master-data' })[location.pathname] || 'production';
const pageTitles = { production: 'Điều hành traceability', issuance: 'Phát hành đến kho', traceability: 'Truy xuất nguồn gốc', 'master-data': 'Cấu hình Master Data' };
let batches = [], warehouses = [], catalogProducts = [], standards = { packagingSpecs: [], lineRules: [] }, editingRuleLine = 'A', ruleDraftIds = new Set(), skuPickerTarget = 'production', selected = '', busy = false, operation = null, batchView = null;
let readyPallets = [], selectedReadyPalletIds = new Set(), dispatchNotes = [];
let currentIssuanceSubtab = 'ready-pallets';
let mapping = { level: 'cartons', pallet: '', carton: '', search: '', page: 1, pageSize: 50 };
const status = { Packed: 'Đã đóng pallet', Dispatched: 'Đã xuất nhà máy', Received: 'Đã có kết quả nhận' };
const dispatchStatusMap = {
  Dispatched: { text: 'Đang vận chuyển', badge: 'badge-warning' },
  PartiallyReceived: { text: 'Đã nhận một phần', badge: 'badge-info' },
  Received: { text: 'Đã nhận kho', badge: 'badge-success' }
};

function el(tag, text, className) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (className) e.className = className; return e; }
function notice(text, error = false) { for (const id of ['notice', 'batch-notice']) { const n = $(id); if (n) { n.textContent = text; n.className = error ? 'error' : ''; } } }
function showPage() {
  for (const [id, owner] of Object.entries({ 'production-overview': 'production', production: 'production', issuance: 'issuance', traceability: 'traceability', 'master-data': 'master-data' }))
    if ($(id)) $(id).hidden = owner !== page;
  for (const [id, owner] of Object.entries({ 'nav-production': 'production', 'nav-issuance': 'issuance', 'nav-traceability': 'traceability', 'nav-master-data': 'master-data' }))
    if ($(id)) $(id).setAttribute('aria-current', owner === page ? 'page' : 'false');
  if ($('breadcrumb-current')) $('breadcrumb-current').textContent = pageTitles[page];
  if (page === 'issuance') setIssuanceSubtab(currentIssuanceSubtab);
}
function signedIn(user) {
  document.body.classList.add('signed-in');
  if ($('session-loading')) $('session-loading').hidden = true;
  if ($('login')) $('login').hidden = true;
  if ($('workspace')) $('workspace').hidden = false;
  if ($('main-nav')) $('main-nav').hidden = false;
  showPage();
  if ($('session')) {
    $('session').replaceChildren(el('span', user.fullName || user.name || 'Admin'));
    const logout = el('button', 'Đăng xuất'); logout.onclick = () => run(async () => { await api('/api/session/logout', 'POST'); location.reload(); }); $('session').append(logout);
  }
}
async function api(path, method = 'GET', body, key) {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'Traceability', ...(key ? { 'Idempotency-Key': key } : {}) }, body: body == null ? undefined : JSON.stringify(body) });
  if (response.status === 401) {
    document.body.classList.remove('signed-in');
    if ($('session-loading')) $('session-loading').hidden = true;
    if ($('workspace')) $('workspace').hidden = true;
    if ($('login')) $('login').hidden = false;
    if ($('main-nav')) $('main-nav').hidden = true;
    if ($('session')) $('session').replaceChildren();
    throw new Error('Vui lòng đăng nhập bằng tài khoản Admin FSCM.');
  }
  if (!response.ok) { let message = 'Yêu cầu thất bại (' + response.status + ').'; try { const data = await response.json(); message = data.message || data.detail || message; } catch {} throw new Error(message); }
  return response.status === 204 ? null : response.json();
}
async function run(action) { if (busy) return; busy = true; document.body.classList.add('busy'); notice('Đang xử lý…'); try { await action(); if ($('notice') && $('notice').textContent === 'Đang xử lý…') notice(''); } catch (e) { notice(e.message, true); } finally { busy = false; document.body.classList.remove('busy'); } }
function table(headers, rows) {
  const wrap = el('div', null, 'table-wrap'), t = el('table'), head = el('tr'); headers.forEach(h => head.append(el('th', h))); const thead = el('thead'); thead.append(head); t.append(thead);
  const body = el('tbody'); rows.forEach(cells => { const tr = el('tr'); cells.forEach(value => { const td = el('td'); td.append(value instanceof Node ? value : el('span', value ?? '—')); tr.append(td); }); body.append(tr); });
  t.append(body); wrap.append(t); if (!rows.length) wrap.append(el('div', 'Chưa có dữ liệu.', 'empty')); return wrap;
}
/**
 * Confirm popup (#confirm-dialog), same layout as the FSCM portal ConfirmDialog. Resolves true only on the
 * confirm button; "Hủy", Esc or closing the dialog resolve false.
 */
function confirmAction({ title, message, facts = [], note = '', confirmLabel = 'Xác nhận' }) {
  const dialog = $('confirm-dialog');
  $('confirm-title').textContent = title;
  const body = $('confirm-body'); body.replaceChildren(el('p', message));
  if (facts.length) {
    const box = el('div', null, 'confirm-facts');
    facts.forEach(([label, value]) => { const row = el('div'); row.append(el('b', label + ': '), document.createTextNode(value)); box.append(row); });
    body.append(box);
  }
  if (note) body.append(el('p', note, 'confirm-note'));
  $('confirm-ok').textContent = confirmLabel;
  return new Promise(resolve => {
    let answered = false;
    const finish = ok => { if (answered) return; answered = true; if (dialog.open) dialog.close(); resolve(ok); };
    $('confirm-ok').onclick = () => finish(true);
    $('confirm-cancel').onclick = () => finish(false);
    dialog.onclose = () => finish(false);
    dialog.showModal();
    $('confirm-cancel').focus();
  });
}
const warehouseLabel = id => { const w = warehouses.find(x => x.id === id); return w ? w.code + ' · ' + w.name : id; };
function button(text, action, className) { const b = el('button', text, className); b.type = 'button'; b.onclick = () => run(action); return b; }
function link(text, href, target = '_blank') { const a = el('a', text, 'button'); a.href = href; a.target = target; a.rel = 'noopener'; return a; }
function code(value) { return el('code', value); }
function date(value) { if (!value) return '—'; const parts = value.slice(0, 10).split('-'); return parts.reverse().join('/'); }
function datetime(value) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
  } catch { return String(value).slice(0, 16).replace('T', ' '); }
}
function detail(label, value) { const p = el('p', label); p.append(el('b', value)); return p; }
function badge(statusKey) {
  const meta = dispatchStatusMap[statusKey] || { text: statusKey || '—', badge: 'badge-info' };
  return el('span', meta.text, 'badge ' + meta.badge);
}
function batchLabelUrl(id, cartons = false) { return '/api/batches/' + encodeURIComponent(id) + '/labels' + (cartons ? '?cartons=true' : ''); }
function batchActions(id) { const actions = el('div', null, 'row-actions'); actions.append(button('Xem chi tiết', () => openBatch(id)), link('In QR lô', batchLabelUrl(id))); return actions; }
function warehouseName(id) { return warehouses.find(w => w.id === id)?.name || 'Chưa phát hành'; }

function setIssuanceSubtab(tabName) {
  currentIssuanceSubtab = tabName;
  if ($('tab-ready-pallets')) $('tab-ready-pallets').className = 'subtab-btn' + (tabName === 'ready-pallets' ? ' active' : '');
  if ($('tab-dispatch-notes')) $('tab-dispatch-notes').className = 'subtab-btn' + (tabName === 'dispatch-notes' ? ' active' : '');
  if ($('tab-batch-list')) $('tab-batch-list').className = 'subtab-btn' + (tabName === 'batch-list' ? ' active' : '');

  if ($('view-ready-pallets')) $('view-ready-pallets').hidden = tabName !== 'ready-pallets';
  if ($('view-dispatch-notes')) $('view-dispatch-notes').hidden = tabName !== 'dispatch-notes';
  if ($('view-batch-list')) $('view-batch-list').hidden = tabName !== 'batch-list';

  if (tabName === 'ready-pallets') loadReadyPallets();
  else if (tabName === 'dispatch-notes') loadDispatchNotes();
}

async function refresh() {
  batches = await api('/api/batches');
  if ($('stats')) {
    $('stats').replaceChildren(...[['Lô sản xuất gần đây', batches.length], ['Pallet đã đóng', batches.reduce((n, b) => n + b.pallets.length, 0)], ['Pallet chờ kho nhận', batches.reduce((n, b) => n + b.pallets.filter(p => p.status === 'Dispatched').length, 0)]].map(([label, value]) => { const d = el('div', label, 'stat'); d.append(el('strong', value)); return d; }));
  }
  if ($('batches')) {
    $('batches').replaceChildren(table(['Batch', 'SKU / line', 'NSX / HSD', 'Pallet / carton / sản phẩm', 'Thao tác'], batches.map(b => [code(b.batch.code), b.sku + ' · ' + b.batch.productionLine, date(b.batch.productionDate) + ' / ' + date(b.batch.expirationDate), `${b.pallets.length} / ${b.cartonCount} / ${b.unitCount}`, batchActions(b.batch.id)])));
  }
  if (selected && $('batch-dialog') && $('batch-dialog').open) await openBatch(selected, false);
  try { await loadReadyPallets(); } catch {}
  try { await loadDispatchNotes(); } catch {}
}

async function loadReadyPallets() {
  try {
    readyPallets = await api('/api/pallets/ready') || [];
    if ($('ready-sku-filter')) {
      const current = $('ready-sku-filter').value;
      const skus = [...new Set(readyPallets.map(p => p.sku))].sort();
      $('ready-sku-filter').replaceChildren(new Option('Tất cả SKU (' + skus.length + ')', ''));
      skus.forEach(s => $('ready-sku-filter').append(new Option(s, s)));
      $('ready-sku-filter').value = current;
    }
    renderReadyPallets();
  } catch {}
}

function renderReadyPallets() {
  if (!$('ready-pallets-table')) return;
  const search = $('ready-search') ? $('ready-search').value.trim().toUpperCase() : '';
  const skuFilter = $('ready-sku-filter') ? $('ready-sku-filter').value : '';
  const lineFilter = $('ready-line-filter') ? $('ready-line-filter').value : '';

  const filtered = readyPallets.filter(p => {
    if (skuFilter && p.sku !== skuFilter) return false;
    if (lineFilter && p.productionLine !== lineFilter) return false;
    if (search && !p.palletCode.toUpperCase().includes(search) && !p.batchCode.toUpperCase().includes(search) && !p.sku.toUpperCase().includes(search) && !p.productName.toUpperCase().includes(search)) return false;
    return true;
  });

  const selectedInFiltered = filtered.filter(p => selectedReadyPalletIds.has(p.palletId));
  const totalCartons = selectedInFiltered.reduce((sum, p) => sum + p.cartonCount, 0);
  const totalUnits = selectedInFiltered.reduce((sum, p) => sum + p.unitCount, 0);

  if ($('ready-selected-summary')) {
    $('ready-selected-summary').textContent = `Đã chọn: ${selectedReadyPalletIds.size} pallet (${totalCartons.toLocaleString('vi-VN')} thùng · ${totalUnits.toLocaleString('vi-VN')} SP)`;
  }
  if ($('ready-pallet-count-label')) {
    $('ready-pallet-count-label').textContent = `Hiển thị ${filtered.length} / ${readyPallets.length} pallet sẵn sàng xuất`;
  }
  if ($('btn-create-dispatch')) {
    const warehouseChosen = $('ready-destination-warehouse') && $('ready-destination-warehouse').value;
    $('btn-create-dispatch').disabled = selectedReadyPalletIds.size === 0 || !warehouseChosen;
  }

  $('ready-pallets-table').replaceChildren(table(['Chọn', 'Mã Pallet', 'Mã Lô (BID)', 'SKU · Sản phẩm', 'Line', 'NSX / HSD', 'Thùng', 'Sản phẩm', 'Thao tác'], filtered.map(p => {
    const chk = el('input'); chk.type = 'checkbox'; chk.className = 'pallet-check';
    chk.checked = selectedReadyPalletIds.has(p.palletId);
    chk.onchange = () => {
      if (chk.checked) selectedReadyPalletIds.add(p.palletId);
      else selectedReadyPalletIds.delete(p.palletId);
      renderReadyPallets();
    };
    const actions = el('div', null, 'row-actions');
    actions.append(link('In QR pallet', '/api/pallets/' + encodeURIComponent(p.palletCode) + '/labels'));
    return [
      chk,
      code(p.palletCode),
      code(p.batchCode),
      `${p.sku} · ${p.productName}`,
      p.productionLine,
      date(p.productionDate) + ' / ' + date(p.expirationDate),
      String(p.cartonCount),
      String(p.unitCount),
      actions
    ];
  })));
}

async function loadDispatchNotes() {
  if (!$('dispatch-notes-table')) return;
  try {
    dispatchNotes = await api('/api/dispatches') || [];
    renderDispatchNotes();
  } catch {}
}

function renderDispatchNotes() {
  if (!$('dispatch-notes-table')) return;
  $('dispatch-notes-table').replaceChildren(table(['Mã phiếu xuất', 'Thời gian xuất xưởng', 'Kho tiếp nhận', 'Xe / Tài xế', 'Số lượng', 'Trạng thái', 'Thao tác'], dispatchNotes.map(n => {
    const actions = el('div', null, 'row-actions');
    actions.append(
      button('Xem chi tiết', () => openDispatchNote(n.id), 'btn-sm'),
      link('In Phiếu (A4)', '/api/dispatches/' + encodeURIComponent(n.id) + '/print')
    );
    const transport = [n.vehicleNumber, n.driverName].filter(Boolean).join(' · ') || '—';
    return [
      code(n.code),
      datetime(n.dispatchedAt),
      n.destinationWarehouseName,
      transport,
      `${n.palletCount} pallet · ${n.cartonCount} thùng · ${n.unitCount} SP`,
      badge(n.status),
      actions
    ];
  })));
}

async function openDispatchNote(id) {
  if (!$('dispatch-dialog')) return;
  $('dispatch-title').textContent = 'Đang tải thông tin phiếu xuất…';
  $('dispatch-detail-content').replaceChildren();
  if (!$('dispatch-dialog').open) $('dispatch-dialog').showModal();

  const data = await api('/api/dispatches/' + encodeURIComponent(id));
  const n = data.note;
  $('dispatch-title').textContent = n.code;
  if ($('dispatch-print-btn')) $('dispatch-print-btn').href = '/api/dispatches/' + encodeURIComponent(n.id) + '/print';

  const grid = el('div', null, 'detail-grid');
  grid.append(
    detail('Kho nhận hàng', n.destinationWarehouseName),
    detail('Thời gian xuất', datetime(n.dispatchedAt)),
    detail('Phương tiện / Tài xế', [n.vehicleNumber, n.driverName].filter(Boolean).join(' · ') || '—'),
    detail('Tổng số xuất xưởng', `${n.palletCount} pallet · ${n.cartonCount} thùng · ${n.unitCount} sản phẩm`),
    detail('Trạng thái tiếp nhận', badge(data.status)),
    detail('Người lập phiếu', n.createdByName || 'Admin')
  );
  if (n.note) grid.append(detail('Ghi chú xuất kho', n.note));

  const content = $('dispatch-detail-content');
  content.replaceChildren(grid, el('h3', 'Danh sách pallet xuất kho trong phiếu'));

  content.append(table(['STT', 'Mã Pallet', 'Mã Lô (BID)', 'SKU · Sản phẩm', 'NSX / HSD', 'Thùng', 'SP', 'Trạng thái tại kho'], data.pallets.map((p, idx) => {
    const pStatusText = p.status === 'Received' ? 'Đã nhận kho' : 'Đang vận chuyển';
    const pBadgeClass = p.status === 'Received' ? 'badge-success' : 'badge-warning';
    return [
      String(idx + 1),
      code(p.palletCode),
      code(p.batchCode),
      `${p.sku} · ${p.productName}`,
      date(p.productionDate) + ' / ' + date(p.expirationDate),
      String(p.cartonCount),
      String(p.unitCount),
      el('span', pStatusText, 'badge ' + pBadgeClass)
    ];
  })));
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
  $('batch-title').textContent = 'Đang tải chi tiết lô…'; $('batch-detail').replaceChildren(); $('mapping-results').replaceChildren();
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
  labels.append(link('In QR lô (batch + pallet)', batchLabelUrl(view.batch.id)), link('In QR đầy đủ (kèm carton)', batchLabelUrl(view.batch.id, true)));
  section.replaceChildren(info, labels);
  const packed = view.pallets.some(p => p.pallet.status === 'Packed'), selectedPallets = new Set();
  if (packed) {
    const form = el('form', null, 'scan dispatch-form'), label = el('label', 'Kho nhận'), select = el('select'); select.required = true; select.append(new Option('Chọn kho nhận', ''));
    warehouses.filter(w => w.isActive).forEach(w => select.append(new Option(w.code + ' · ' + w.name, w.id))); label.append(select); form.append(label);
    // Same transport fields as the "Lập phiếu xuất xưởng" page: vehicle and driver are required for every dispatch.
    const field = (text, max, placeholder, required) => {
      const wrap = el('label', text), input = el('input'); input.maxLength = max; input.placeholder = placeholder; input.required = required;
      wrap.append(input); form.append(wrap); return input;
    };
    const vehicle = field('Biển số xe (*)', 50, 'VD: 59C-123.45', true);
    const driver = field('Tài xế / Người vận chuyển (*)', 100, 'VD: Nguyễn Văn A', true);
    const remark = field('Ghi chú xuất xưởng', 200, 'Không bắt buộc', false);
    form.append(el('button', 'Phát hành pallet đã chọn', 'primary'));
    form.onsubmit = async e => { e.preventDefault(); if (busy) return;
      if (!selectedPallets.size) { notice('Tick chọn ít nhất một pallet cần phát hành.', true); return; }
      if (!select.value) { notice('Chọn kho nhận.', true); return; }
      const transport = { vehicleNumber: vehicle.value.trim(), driverName: driver.value.trim(), note: remark.value.trim() };
      if (!transport.vehicleNumber || !transport.driverName) { notice('Nhập biển số xe và tài xế trước khi phát hành pallet.', true); return; }
      const chosen = view.pallets.filter(row => selectedPallets.has(row.pallet.id));
      const ok = await confirmAction({
        title: 'Xác nhận xuất pallet sang kho',
        message: `Phát hành ${chosen.length} pallet của lô ${view.batch.code} đến kho nhận?`,
        facts: [['Kho nhận', warehouseLabel(select.value)], ['Pallet', chosen.map(row => row.pallet.code).join(', ')],
          ['Số lượng', `${chosen.reduce((n, row) => n + row.cartonCount, 0)} carton · ${chosen.reduce((n, row) => n + row.unitCount, 0)} sản phẩm`],
          ['Xe / tài xế', `${transport.vehicleNumber} · ${transport.driverName}`]],
        note: 'Sau khi phát hành, pallet không đổi được kho đích. Thủ kho quét nhận trên phiếu nhập FSCM.',
        confirmLabel: 'Phát hành pallet',
      });
      if (!ok) return;
      await run(async () => {
      await api('/api/batches/' + view.batch.id + '/dispatch', 'POST', { destinationWarehouseId: select.value, palletIds: [...selectedPallets], ...transport }); await refresh(); notice('Đã phát hành pallet. Đã lưu phiếu xuất xưởng tại nhà máy.'); }); };
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
  if ($('mapping-pallet')) {
    $('mapping-pallet').replaceChildren(new Option('Tất cả pallet', ''));
    view.pallets.forEach(row => $('mapping-pallet').append(new Option(row.pallet.code, row.pallet.code)));
    $('mapping-pallet').value = mapping.pallet; $('mapping-search').value = mapping.search;
  }
}
async function chooseMapping(pallet = mapping.pallet) {
  mapping = { ...mapping, level: 'cartons', pallet, carton: '', search: '', page: 1 };
  if ($('mapping-search')) $('mapping-search').value = '';
  if ($('mapping-pallet')) $('mapping-pallet').value = pallet;
  await loadMapping();
  if ($('mapping-results')) $('mapping-results').scrollIntoView({ block: 'nearest' });
}
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
  mapping = { ...mapping, level: 'cartons', pallet: params.get('pallet') || '', carton: '', search: params.get('search') || '', page: Math.max(1, Math.min(1000000, Number(params.get('page')) || 1)) };
  await openBatch(id, false);
}

if ($('close-batch')) $('close-batch').onclick = () => $('batch-dialog').close();
if ($('close-serial')) $('close-serial').onclick = () => $('serial-dialog').close();
if ($('close-dispatch')) $('close-dispatch').onclick = () => $('dispatch-dialog').close();
if ($('serial-dialog')) $('serial-dialog').addEventListener('close', () => { serialView = null; });
if ($('batch-dialog')) $('batch-dialog').addEventListener('close', () => { selected = ''; batchView = null; history.replaceState(null, '', location.pathname + location.search); });
if ($('mapping-filter')) $('mapping-filter').onsubmit = e => { e.preventDefault(); run(async () => { mapping = { ...mapping, pallet: $('mapping-pallet').value, carton: '', search: $('mapping-search').value.trim(), page: 1 }; await loadMapping(); }); };
if ($('mapping-reset')) $('mapping-reset').onclick = () => run(() => chooseMapping(''));

if ($('tab-ready-pallets')) $('tab-ready-pallets').onclick = () => setIssuanceSubtab('ready-pallets');
if ($('tab-dispatch-notes')) $('tab-dispatch-notes').onclick = () => setIssuanceSubtab('dispatch-notes');
if ($('tab-batch-list')) $('tab-batch-list').onclick = () => setIssuanceSubtab('batch-list');

if ($('ready-search')) $('ready-search').oninput = () => renderReadyPallets();
if ($('ready-sku-filter')) $('ready-sku-filter').onchange = () => renderReadyPallets();
if ($('ready-line-filter')) $('ready-line-filter').onchange = () => renderReadyPallets();
if ($('ready-destination-warehouse')) $('ready-destination-warehouse').onchange = () => renderReadyPallets();

if ($('btn-select-all-pallets')) $('btn-select-all-pallets').onclick = () => {
  const search = $('ready-search') ? $('ready-search').value.trim().toUpperCase() : '';
  const skuFilter = $('ready-sku-filter') ? $('ready-sku-filter').value : '';
  const lineFilter = $('ready-line-filter') ? $('ready-line-filter').value : '';
  readyPallets.filter(p => {
    if (skuFilter && p.sku !== skuFilter) return false;
    if (lineFilter && p.productionLine !== lineFilter) return false;
    if (search && !p.palletCode.toUpperCase().includes(search) && !p.batchCode.toUpperCase().includes(search) && !p.sku.toUpperCase().includes(search)) return false;
    return true;
  }).forEach(p => selectedReadyPalletIds.add(p.palletId));
  renderReadyPallets();
};

if ($('btn-deselect-all-pallets')) $('btn-deselect-all-pallets').onclick = () => {
  selectedReadyPalletIds.clear();
  renderReadyPallets();
};

if ($('btn-refresh-dispatches')) $('btn-refresh-dispatches').onclick = () => run(async () => {
  await loadDispatchNotes();
  notice('Đã cập nhật sổ phiếu xuất kho nhà máy.');
});

if ($('btn-create-dispatch')) $('btn-create-dispatch').onclick = async () => {
  if (busy) return;
  const destinationWarehouseId = $('ready-destination-warehouse').value;
  if (!destinationWarehouseId) { notice('Vui lòng chọn kho đích tiếp nhận hàng.', true); return; }
  if (selectedReadyPalletIds.size === 0) { notice('Vui lòng chọn ít nhất một pallet để xuất kho.', true); return; }

  const vehicleNumber = $('ready-vehicle-number') ? $('ready-vehicle-number').value.trim() : '';
  const driverName = $('ready-driver-name') ? $('ready-driver-name').value.trim() : '';
  const note = $('ready-dispatch-note') ? $('ready-dispatch-note').value.trim() : '';
  if (!vehicleNumber || !driverName) { notice('Nhập biển số xe và tài xế trước khi phát hành pallet.', true); return; }
  const chosen = readyPallets.filter(p => selectedReadyPalletIds.has(p.palletId));
  const ok = await confirmAction({
    title: 'Xác nhận xuất pallet sang kho',
    message: `Tạo phiếu xuất xưởng và phát hành ${selectedReadyPalletIds.size} pallet đến kho nhận?`,
    facts: [
      ['Kho nhận', warehouseLabel(destinationWarehouseId)],
      ['Số lượng', `${selectedReadyPalletIds.size} pallet · ${chosen.reduce((n, p) => n + (p.cartonCount || 0), 0).toLocaleString('vi-VN')} thùng · ${chosen.reduce((n, p) => n + (p.unitCount || 0), 0).toLocaleString('vi-VN')} sản phẩm`],
      ['Xe / tài xế', `${vehicleNumber} · ${driverName}`],
    ],
    note: 'Sau khi phát hành, pallet không đổi được kho đích. Thủ kho quét nhận trên phiếu nhập FSCM.',
    confirmLabel: 'Tạo phiếu & phát hành',
  });
  if (!ok) return;
  await run(async () => {

  const result = await api('/api/dispatches', 'POST', {
    destinationWarehouseId,
    palletIds: [...selectedReadyPalletIds],
    vehicleNumber,
    driverName,
    note
  });

  selectedReadyPalletIds.clear();
  if ($('ready-vehicle-number')) $('ready-vehicle-number').value = '';
  if ($('ready-driver-name')) $('ready-driver-name').value = '';
  if ($('ready-dispatch-note')) $('ready-dispatch-note').value = '';

  await refresh();
  notice(`Đã tạo phiếu xuất kho ${result.code} và phát hành ${result.palletCount} pallet thành công!`);
  await openDispatchNote(result.id);
  });
};

function getAllowedSkusForLine(line) {
  const lineProductIds = new Set(standards.lineRules.filter(r => r.productionLine === line).map(r => r.productId));
  const published = catalogProducts.filter(p => p.status === 'Published');
  return { lineProductIds, items: lineProductIds.size > 0 ? published.filter(p => lineProductIds.has(p.id)) : published };
}

function setProductionSku(productId) {
  if (!$('products')) return;
  const line = $('production-line')?.value || 'A';
  const { lineProductIds, items } = getAllowedSkusForLine(line);
  const found = items.find(p => p.id === productId);
  $('products').value = found ? found.id : '';
  if ($('production-sku-display')) {
    $('production-sku-display').textContent = found
      ? `${found.sku} · ${found.name}`
      : (lineProductIds.size > 0 ? `Chọn SKU (Line ${line} · ${items.length} SKU)...` : 'Chọn SKU đang phát hành...');
  }
  applyPackagingSpecForSelectedSku();
}

function setSpecSku(productId) {
  if (!$('spec-product')) return;
  const found = catalogProducts.find(p => p.status === 'Published' && p.id === productId);
  $('spec-product').value = found ? found.id : '';
  if ($('spec-sku-display')) {
    $('spec-sku-display').textContent = found ? `${found.sku} · ${found.name}` : 'Chọn SKU đang phát hành...';
  }
}

function renderSkuOptionsForLine() {
  setProductionSku($('products')?.value || '');
}

function openSkuPicker(target) {
  skuPickerTarget = target;
  if ($('sku-picker-title')) $('sku-picker-title').textContent = target === 'production'
    ? `Chọn SKU cho Line ${$('production-line')?.value || 'A'}`
    : 'Chọn SKU để cấu hình đóng gói';
  if ($('sku-picker-search')) $('sku-picker-search').value = '';
  renderSkuPickerTable();
  $('sku-picker-dialog')?.showModal();
  $('sku-picker-search')?.focus();
}

function renderSkuPickerTable() {
  if (!$('sku-picker-table')) return;
  const term = ($('sku-picker-search')?.value || '').trim().toLowerCase();
  const line = $('production-line')?.value || 'A';
  const source = skuPickerTarget === 'production'
    ? getAllowedSkusForLine(line)
    : { lineProductIds: new Set(), items: catalogProducts.filter(p => p.status === 'Published') };
  const filtered = source.items.filter(p => !term || p.sku.toLowerCase().includes(term) || p.name.toLowerCase().includes(term));
  if ($('sku-picker-scope')) {
    $('sku-picker-scope').textContent = skuPickerTarget === 'production'
      ? (source.lineProductIds.size > 0 ? `Line ${line} đang giới hạn ${source.items.length} SKU · Hiển thị ${filtered.length} kết quả` : `Hiển thị ${filtered.length} SKU đang phát hành`)
      : `Hiển thị ${filtered.length} SKU đang phát hành`;
  }
  const currentId = skuPickerTarget === 'production' ? $('products')?.value : $('spec-product')?.value;
  $('sku-picker-table').replaceChildren(table(['Mã SKU', 'Tên sản phẩm', 'Quy chuẩn đóng gói', 'Thao tác'], filtered.map(p => {
    const spec = standards.packagingSpecs.find(s => s.productId === p.id);
    const specText = spec ? `${spec.cartonsPerPallet} carton/pallet · ${spec.unitsPerCarton} sp/carton` : 'Chưa cấu hình';
    const pickBtn = el('button', p.id === currentId ? 'Đang chọn' : 'Chọn', p.id === currentId ? 'btn-sm' : 'btn-sm primary');
    pickBtn.type = 'button';
    pickBtn.onclick = () => {
      if (skuPickerTarget === 'production') setProductionSku(p.id);
      else setSpecSku(p.id);
      $('sku-picker-dialog')?.close();
    };
    return [code(p.sku), p.name, specText, pickBtn];
  })));
}

function applyPackagingSpecForSelectedSku() {
  const productId = $('products')?.value || '';
  const spec = standards.packagingSpecs.find(s => s.productId === productId);
  const cartonsInput = $('cartons-per-pallet');
  const unitsInput = $('units-per-carton');
  if (spec) {
    if (cartonsInput) { cartonsInput.value = spec.cartonsPerPallet; cartonsInput.readOnly = true; }
    if (unitsInput) { unitsInput.value = spec.unitsPerCarton; unitsInput.readOnly = true; }
    if ($('packaging-spec-hint')) $('packaging-spec-hint').textContent = `Theo quy chuẩn SKU: ${spec.cartonsPerPallet} carton/pallet · ${spec.unitsPerCarton} sản phẩm/carton`;
  } else {
    if (cartonsInput) cartonsInput.readOnly = false;
    if (unitsInput) unitsInput.readOnly = false;
    if ($('packaging-spec-hint')) $('packaging-spec-hint').textContent = productId ? 'SKU chưa có quy chuẩn đóng gói — đang nhập tay.' : '';
  }
  total();
}

function openLineSkuDialog(line) {
  editingRuleLine = line;
  ruleDraftIds = new Set(standards.lineRules.filter(r => r.productionLine === line).map(r => r.productId));
  if ($('line-sku-dialog-title')) $('line-sku-dialog-title').textContent = `Chọn SKU cho Line ${line}`;
  if ($('rule-sku-search')) $('rule-sku-search').value = '';
  renderRuleSkusTable();
  $('line-sku-dialog')?.showModal();
}

function renderRuleSkusTable() {
  if (!$('rule-skus-table')) return;
  const term = ($('rule-sku-search')?.value || '').trim().toLowerCase();
  const published = catalogProducts.filter(p => p.status === 'Published')
    .filter(p => !term || p.sku.toLowerCase().includes(term) || p.name.toLowerCase().includes(term));
  if ($('rule-selected-count')) $('rule-selected-count').textContent = `Đang chọn ${ruleDraftIds.size} SKU cho Line ${editingRuleLine}`;
  $('rule-skus-table').replaceChildren(table(['Chọn', 'Mã SKU', 'Tên sản phẩm', 'Quy chuẩn đóng gói'], published.map(p => {
    const cb = el('input');
    cb.type = 'checkbox';
    cb.className = 'table-checkbox';
    cb.value = p.id;
    cb.checked = ruleDraftIds.has(p.id);
    cb.onchange = () => {
      if (cb.checked) ruleDraftIds.add(p.id);
      else ruleDraftIds.delete(p.id);
      if ($('rule-selected-count')) $('rule-selected-count').textContent = `Đang chọn ${ruleDraftIds.size} SKU cho Line ${editingRuleLine}`;
    };
    const spec = standards.packagingSpecs.find(s => s.productId === p.id);
    const specText = spec ? `${spec.cartonsPerPallet} carton/pallet · ${spec.unitsPerCarton} sp/carton` : 'Chưa cấu hình';
    return [cb, code(p.sku), p.name, specText];
  })));
}

function renderStandardsDialog() {
  setSpecSku($('spec-product')?.value || '');
  if ($('packaging-specs-table')) {
    $('packaging-specs-table').replaceChildren(table(['SKU', 'Tên sản phẩm', 'Carton / pallet', 'SP / carton', 'Thao tác'], standards.packagingSpecs.map(s => {
      const actions = el('div', null, 'row-actions');
      const editBtn = el('button', 'Sửa', 'btn-sm');
      editBtn.type = 'button';
      editBtn.onclick = () => { setSpecSku(s.productId); $('spec-cartons').value = s.cartonsPerPallet; $('spec-units').value = s.unitsPerCarton; };
      const delBtn = el('button', 'Xóa', 'btn-sm');
      delBtn.type = 'button';
      delBtn.onclick = () => run(async () => {
        await api(`/api/standards/packaging/${s.productId}`, 'DELETE');
        await reloadStandards();
        notice(`Đã xóa quy chuẩn đóng gói của ${s.sku}.`);
      });
      actions.append(editBtn, delBtn);
      return [code(s.sku), s.productName, s.cartonsPerPallet, s.unitsPerCarton, actions];
    })));
  }
  if ($('line-rules-summary')) {
    $('line-rules-summary').replaceChildren(table(['Line sản xuất', 'Số SKU', 'SKU được phép sản xuất', 'Thao tác'], ['A', 'B', 'C', 'D'].map(line => {
      const items = standards.lineRules.filter(r => r.productionLine === line);
      const editBtn = el('button', 'Cấu hình SKU', 'btn-sm primary');
      editBtn.type = 'button';
      editBtn.onclick = () => openLineSkuDialog(line);
      return [`Line ${line}`, items.length ? `${items.length} SKU` : 'Tất cả', items.length ? items.map(r => r.sku).join(', ') : 'Chưa giới hạn (cho phép tất cả SKU)', editBtn];
    })));
  }
}

async function reloadStandards() {
  standards = await api('/api/standards');
  renderSkuOptionsForLine();
  applyPackagingSpecForSelectedSku();
  renderStandardsDialog();
}

async function loadCatalog() {
  const [products, whs, std] = await Promise.all([
    api('/api/catalog/products'),
    api('/api/catalog/warehouses'),
    api('/api/standards').catch(() => ({ packagingSpecs: [], lineRules: [] }))
  ]);
  catalogProducts = products;
  warehouses = whs;
  standards = std || { packagingSpecs: [], lineRules: [] };
  renderSkuOptionsForLine();
  applyPackagingSpecForSelectedSku();
  renderStandardsDialog();
  if ($('ready-destination-warehouse')) {
    const cur = $('ready-destination-warehouse').value;
    $('ready-destination-warehouse').replaceChildren(new Option('-- Chọn kho đích tiếp nhận --', ''));
    warehouses.filter(w => w.isActive).forEach(w => $('ready-destination-warehouse').append(new Option(w.code + ' · ' + w.name, w.id)));
    $('ready-destination-warehouse').value = cur;
  }
}

function total() {
  if (!$('production-form') || !$('production-total')) return;
  const data = new FormData($('production-form'));
  const cartons = Number(data.get('palletCount')) * Number(data.get('cartonsPerPallet'));
  $('production-total').textContent = `${cartons} carton · ${cartons * Number(data.get('unitsPerCarton'))} sản phẩm (tối đa 50.000/lô)`;
}
if ($('production-date')) $('production-date').value = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
if ($('production-form')) { $('production-form').oninput = total; total(); }
if ($('production-line')) $('production-line').onchange = () => { renderSkuOptionsForLine(); };
if ($('btn-pick-production-sku')) $('btn-pick-production-sku').onclick = () => openSkuPicker('production');
if ($('btn-pick-spec-sku')) $('btn-pick-spec-sku').onclick = () => openSkuPicker('spec');
if ($('close-sku-picker')) $('close-sku-picker').onclick = () => $('sku-picker-dialog')?.close();
if ($('sku-picker-search')) $('sku-picker-search').oninput = () => renderSkuPickerTable();
if ($('close-line-sku-dialog')) $('close-line-sku-dialog').onclick = () => $('line-sku-dialog')?.close();
if ($('cancel-line-sku-dialog')) $('cancel-line-sku-dialog').onclick = () => $('line-sku-dialog')?.close();
if ($('rule-sku-search')) $('rule-sku-search').oninput = () => renderRuleSkusTable();
if ($('btn-rule-select-all')) $('btn-rule-select-all').onclick = () => {
  const term = ($('rule-sku-search')?.value || '').trim().toLowerCase();
  catalogProducts.filter(p => p.status === 'Published')
    .filter(p => !term || p.sku.toLowerCase().includes(term) || p.name.toLowerCase().includes(term))
    .forEach(p => ruleDraftIds.add(p.id));
  renderRuleSkusTable();
};
if ($('btn-rule-deselect-all')) $('btn-rule-deselect-all').onclick = () => {
  const term = ($('rule-sku-search')?.value || '').trim().toLowerCase();
  catalogProducts.filter(p => p.status === 'Published')
    .filter(p => !term || p.sku.toLowerCase().includes(term) || p.name.toLowerCase().includes(term))
    .forEach(p => ruleDraftIds.delete(p.id));
  renderRuleSkusTable();
};
if ($('btn-save-line-skus')) $('btn-save-line-skus').onclick = () => {
  run(async () => {
    await api('/api/standards/line-skus', 'POST', { productionLine: editingRuleLine, productIds: [...ruleDraftIds] });
    $('line-sku-dialog')?.close();
    await reloadStandards();
    notice(`Đã lưu ${ruleDraftIds.size} SKU cho Line ${editingRuleLine}.`);
  });
};
if ($('packaging-spec-form')) $('packaging-spec-form').onsubmit = e => {
  e.preventDefault();
  if (!$('spec-product')?.value) { notice('Vui lòng chọn SKU trước khi lưu quy chuẩn.', true); return; }
  run(async () => {
    await api('/api/standards/packaging', 'POST', {
      productId: $('spec-product').value,
      cartonsPerPallet: Number($('spec-cartons').value),
      unitsPerCarton: Number($('spec-units').value)
    });
    await reloadStandards();
    notice('Đã lưu quy chuẩn đóng gói cho SKU.');
  });
};
if ($('login-form')) $('login-form').onsubmit = e => { e.preventDefault(); run(async () => { const data = Object.fromEntries(new FormData(e.target)); const user = await api('/api/session/login', 'POST', data); e.target.reset(); signedIn(user); await loadCatalog(); await refresh(); await restoreBatchView(); notice(''); }); };
if ($('production-form')) $('production-form').onsubmit = e => { e.preventDefault(); if (!$('products')?.value) { notice('Vui lòng chọn SKU trước khi sản xuất.', true); return; } run(async () => {
  const data = Object.fromEntries(new FormData(e.target)); ['palletCount', 'cartonsPerPallet', 'unitsPerCarton'].forEach(k => data[k] = Number(data[k]));
  const fingerprint = JSON.stringify(data); if (operation?.fingerprint !== fingerprint) operation = { fingerprint, key: crypto.randomUUID() };
  const result = await api('/api/batches/simulate', 'POST', data, operation.key); operation = null; await refresh(); await openBatch(result.id); notice('Đã cấp batch, serial, carton và pallet tại nhà máy. Bấm "In QR lô" để in nhãn QR. Hàng chưa được nhập tồn FSCM.');
}); };
if ($('refresh')) $('refresh').onclick = () => run(async () => { await loadCatalog(); await refresh(); notice('Đã làm mới dữ liệu.'); });
if ($('trace-form')) $('trace-form').onsubmit = e => { e.preventDefault(); run(async () => {
  const value = new FormData(e.target).get('code').trim(), t = await api('/api/trace?code=' + encodeURIComponent(value)), section = $('trace-result');
  const info = el('div', null, 'detail-grid'); info.append(detail('Batch', t.batch.code), detail('SKU / line', t.sku + ' · ' + t.batch.productionLine), detail('NSX / HSD', date(t.batch.productionDate) + ' / ' + date(t.batch.expirationDate)), detail('Pallet gốc', t.pallet?.code || 'Tra theo batch'), detail('Carton', t.carton?.code || '—'), detail('Serial', t.unit?.code || '—')); section.replaceChildren(info, button('Mở chi tiết lô và mapping', () => openBatch(t.batch.id)));
  section.append(el('p', t.pallet ? 'Trạng thái nhà máy: ' + status[t.pallet.status] + '. Vị trí tồn hiện tại và lịch sử chứng từ xem tại FSCM.' : t.cartonCodes.length + ' carton thuộc phạm vi truy xuất.'));
  section.append(table(['Carton trong phạm vi truy xuất'], t.cartonCodes.map(c => [code(c)])));
  if (t.units.length) section.append(table(['STT', 'Serial sản phẩm trong carton'], t.units.map(u => [u.sequence, code(u.code)]))); notice('');
}); };

(async () => {
  try {
    const user = await api('/api/session');
    signedIn(user);
    await loadCatalog();
    await refresh();
    await restoreBatchView();
    notice('');
  } catch (e) {
    if ($('login') && !$('login').hidden) notice('');
    else notice(e.message, true);
  }
})();
