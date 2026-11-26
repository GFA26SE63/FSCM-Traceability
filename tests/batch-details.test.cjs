const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.value = ''; this.hidden = false; this.open = false; this.attributes = {}; this.events = {}; this._text = ''; this.classList = { add() {}, remove() {} }; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent || '').join(''); }
  append(...children) { this.children.push(...children); }
  prepend(...children) { this.children.unshift(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, fn) { (this.events[name] ??= []).push(fn); }
  showModal() { this.open = true; }
  close() { this.open = false; (this.events.close || []).forEach(fn => fn()); }
  scrollIntoView() { this.scrolled = true; }
  focus() { this.focused = true; }
}
function find(node, text) {
  if (node.tagName === 'button' && node.textContent === text) return node;
  for (const child of node.children) { const found = find(child, text); if (found) return found; }
}
function findLink(node, text) {
  if (node.tagName === 'a' && node.textContent === text) return node;
  for (const child of node.children) { const found = findLink(child, text); if (found) return found; }
}
const batchId = '11111111-1111-1111-1111-111111111111';
const batch = { id: batchId, code: 'BID-F01-20261113-A-0001', factoryCode: 'F01', productionLine: 'A', productionDate: '2026-11-13', expirationDate: '2026-11-21', unitsPerCarton: 12 };
const pallet = { id: 'pallet', code: 'PID-F01-20261113-A-0001-0001', status: 'Dispatched', destinationWarehouseId: 'warehouse' };
const carton = 'CID-F01-20261113-A-0001-0001';

test('application shell uses the FSCM logo and exposes three sidebar navigation items', () => {
  const html = fs.readFileSync(path.join(__dirname, '../wwwroot/index.html'), 'utf8');
  assert.match(html, /<a class="brand" href="\/"[^>]*>/);
  assert.match(html, /<img class="brand-logo" src="\/fscm-logo\.png" alt="FSCM"/);
  assert.match(html, /<aside id="main-nav" class="sidebar"[^>]*>/);
  assert.match(html, /href="\/production"><span class="nav-index">01<\/span><span>Sản xuất &amp; đóng hàng<\/span>/);
  assert.match(html, /href="\/issuance"><span class="nav-index">02<\/span><span>Phát hành đến kho<\/span>/);
  assert.match(html, /href="\/traceability"><span class="nav-index">03<\/span><span>Truy xuất nguồn gốc<\/span>/);
  assert.match(html, /<nav class="breadcrumbs" aria-label="Điều hướng phân cấp">/);
  assert.match(html, /id="breadcrumb-current" aria-current="page">Điều hành traceability/);
  assert.equal((html.match(/src="\/fscm-logo\.png"/g) ?? []).length, 3);
  assert.match(html, /id="login" class="panel login" hidden/);
  assert.match(html, /id="session-loading" class="panel login session-loading"/);
  for (const id of ['production', 'issuance', 'traceability', 'master-data']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /href="\/master-data"><span class="nav-index">04<\/span><span>Cấu hình Master Data<\/span>/);
  assert.ok(fs.existsSync(path.join(__dirname, '../wwwroot/fscm-logo.png')));
  const program = fs.readFileSync(path.join(__dirname, '../Program.cs'), 'utf8');
  for (const route of ['/production', '/issuance', '/traceability', '/master-data']) assert.ok(program.includes(`app.MapGet("${route}"`));
});
async function setup(hash = '', pathname = '/') {
  const html = fs.readFileSync(path.join(__dirname, '../wwwroot/index.html'), 'utf8');
  const nodes = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element('div')]));
  const requests = [], location = { pathname, search: '', hash, reload() {} };
  const context = vm.createContext({
    Node: Element, Date, URLSearchParams, console,
    crypto: { randomUUID: () => 'request-key' },
    document: { getElementById(id) { assert.ok(nodes[id], `Unknown element ${id}`); return nodes[id]; }, createElement: tag => new Element(tag), createTextNode: text => { const node = new Element('#text'); node.textContent = text; return node; }, body: new Element('body') },
    Option: class extends Element { constructor(text, value) { super('option'); this.textContent = text; this.value = value; } },
    FormData: class { get(name) { return { palletCount: '2', cartonsPerPallet: '10', unitsPerCarton: '12' }[name]; } },
    location, history: { replaceState(_, __, value) { location.hash = value.includes('#') ? value.slice(value.indexOf('#')) : ''; } },
    fetch: async request => {
      requests.push(request);
      const url = new URL(request, 'http://factory.test/');
      let data;
      if (url.pathname === '/api/session') return { status: 401, ok: false, json: async () => ({}) };
      if (url.pathname === '/api/batches') data = [{ batch, sku: 'SKU001', productName: 'Product', pallets: [pallet], cartonCount: 20, unitCount: 240 }];
      else if (url.pathname === '/api/batches/' + batchId) data = { batch, sku: 'SKU001', productName: 'Product', pallets: [{ pallet, cartonCount: 20, unitCount: 240 }], cartonCount: 20, unitCount: 240 };
      else if (url.pathname.endsWith('/mapping')) data = { page: Number(url.searchParams.get('page')), pageSize: 50, totalCount: 120,
        items: [{ batchCode: batch.code, palletCode: pallet.code, cartonCode: carton, sku: 'SKU001', unitCode: 'UID-F01-20261113-A-0001-000001', unitsInCarton: 12, productionDate: batch.productionDate, expirationDate: batch.expirationDate }] };
      else throw new Error('Unexpected request ' + request);
      return { status: 200, ok: true, json: async () => data };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../wwwroot/app.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  vm.runInContext("signedIn({name:'Admin'})", context);
  return { nodes, requests, location, context, run: source => vm.runInContext(source, context) };
}

test('each workflow route displays only its own page content after sign-in', async () => {
  const issuance = await setup('', '/issuance');
  assert.equal(issuance.nodes.production.hidden, true);
  assert.equal(issuance.nodes['production-overview'].hidden, true);
  assert.equal(issuance.nodes.issuance.hidden, false);
  assert.equal(issuance.nodes.traceability.hidden, true);
  assert.equal(issuance.nodes['nav-issuance'].attributes['aria-current'], 'page');
  assert.equal(issuance.nodes['nav-production'].attributes['aria-current'], 'false');

  const traceability = await setup('', '/traceability');
  assert.equal(traceability.nodes.traceability.hidden, false);
  assert.equal(traceability.nodes.issuance.hidden, true);
  assert.equal(traceability.nodes['nav-traceability'].attributes['aria-current'], 'page');
  assert.equal(traceability.nodes['breadcrumb-current'].textContent, 'Truy xuất nguồn gốc');
});

test('clicking the actual batch detail action opens a visible dialog and loads persisted mapping', async () => {
  const app = await setup(); await app.run('refresh()');
  const button = find(app.nodes.batches, 'Xem chi tiết'); assert.ok(button);
  await button.onclick();
  assert.equal(app.nodes['batch-dialog'].open, true);
  assert.equal(app.nodes['batch-title'].textContent, batch.code);
  assert.ok(app.nodes['batch-detail'].textContent.includes(pallet.code));
  assert.ok(app.nodes['mapping-results'].textContent.includes(carton));
  assert.ok(app.requests.some(url => url.includes('/mapping?')));
});

test('carton table has a "Hiện các serial" button that opens a 10-per-page serial popup for that carton', async () => {
  const app = await setup(); await app.run(`openBatch('${batchId}')`);
  const text = app.nodes['mapping-results'].textContent;
  assert.ok(text.includes(carton)); assert.ok(text.includes('Serial sản phẩm')); assert.ok(!text.includes('Mapping'));
  assert.ok(!text.includes('UID-F01-20261113-A-0001-000001'));
  assert.ok(findLink(app.nodes['mapping-results'], 'In QR sản phẩm'));
  const show = find(app.nodes['mapping-results'], 'Hiện các serial (12)'); assert.ok(show);
  await show.onclick();
  assert.equal(app.nodes['serial-dialog'].open, true);
  assert.equal(app.nodes['batch-dialog'].open, true);
  const url = new URL(app.requests.at(-1), 'http://factory.test/');
  assert.equal(url.searchParams.get('level'), 'units'); assert.equal(url.searchParams.get('carton'), carton);
  assert.equal(url.searchParams.get('pallet'), pallet.code); assert.equal(url.searchParams.get('pageSize'), '10');
  assert.ok(app.nodes['serial-results'].textContent.includes('UID-F01-20261113-A-0001-000001'));
  await find(app.nodes['serial-pager'], 'Trang sau').onclick();
  assert.equal(new URL(app.requests.at(-1), 'http://factory.test/').searchParams.get('page'), '2');
  app.nodes['close-serial'].onclick(); assert.equal(app.nodes['serial-dialog'].open, false); assert.equal(app.nodes['batch-dialog'].open, true);
});
test('pallet "Xem carton" filters the carton table and paging keeps the pallet filter', async () => {
  const app = await setup(); await app.run(`openBatch('${batchId}')`);
  await find(app.nodes['batch-detail'], 'Xem carton').onclick();
  await find(app.nodes['mapping-pager'], 'Trang sau').onclick();
  const url = new URL(app.requests.at(-1), 'http://factory.test/');
  assert.equal(url.searchParams.get('page'), '2'); assert.equal(url.searchParams.get('level'), 'cartons'); assert.equal(url.searchParams.get('pallet'), pallet.code); assert.equal(url.searchParams.get('carton'), null);
});

test('saved detail URL restores a batch and pallet filter without depending on the latest-100 list', async () => {
  const app = await setup('#' + new URLSearchParams({ batch: batchId, level: 'units', carton, pallet: pallet.code, page: '1' }));
  await app.run('restoreBatchView()');
  assert.equal(app.nodes['batch-dialog'].open, true);
  const url = new URL(app.requests.at(-1), 'http://factory.test/');
  assert.equal(url.searchParams.get('pallet'), pallet.code); assert.equal(url.searchParams.get('level'), 'cartons'); assert.equal(url.searchParams.get('carton'), null);
  assert.ok(!app.requests.includes('/api/batches'));
  app.nodes['close-batch'].onclick(); assert.equal(app.nodes['batch-dialog'].open, false); assert.equal(app.location.hash, '');
});


test('searching a serial keeps the pallet filter and resets pagination', async () => {
  const app = await setup(); await app.run(`openBatch('${batchId}')`);
  await find(app.nodes['batch-detail'], 'Xem carton').onclick();
  app.nodes['mapping-pallet'].value = pallet.code;
  app.nodes['mapping-search'].value = 'uid-000001';
  app.nodes['mapping-filter'].onsubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  const url = new URL(app.requests.at(-1), 'http://factory.test/');
  assert.equal(url.searchParams.get('search'), 'uid-000001');
  assert.equal(url.searchParams.get('pallet'), pallet.code);
  assert.equal(url.searchParams.get('page'), '1');
});

test('inspection details show missing and quarantined cartons without treating them as accepted', async () => {
  const app = await setup(); await app.run(`openBatch('${batchId}')`);
  const report = JSON.stringify([{ CartonCode: 'C-DAMAGED', Disposition: 'Damaged', Reason: 'Wet', QuarantineLocation: 'Q-01' }, { CartonCode: 'C-MISSING', Disposition: 'Missing', Reason: 'Absent' }]);
  app.context.report = report;
  app.run('batchView.pallets[0].pallet.receiptInspectionJson = report; renderBatch()');
  const text = app.nodes['batch-detail'].textContent;
  assert.ok(text.includes('Hỏng · cách ly')); assert.ok(text.includes('Q-01')); assert.ok(text.includes('Thiếu')); assert.ok(text.includes('C-MISSING'));
});

test('dispatch form sends only selected packed pallets and excludes already dispatched pallets', async () => {
  const app = await setup(); await app.run(`openBatch('${batchId}')`);
  app.run(`batchView.pallets.push({ pallet: { id: 'new-1', code: 'PID-NEW-1', status: 'Packed' }, cartonCount: 1, unitCount: 12 });
    batchView.pallets.push({ pallet: { id: 'new-2', code: 'PID-NEW-2', status: 'Packed' }, cartonCount: 1, unitCount: 12 });
    warehouses = [{ id: 'warehouse-2', code: 'W2', name: 'Warehouse 2', isActive: true }]; renderBatch();
    globalThis.sent = []; api = async (...args) => { sent.push(args); return {}; }; refresh = async () => {};`);
  const form = app.nodes['batch-detail'].children.find(n => n.tagName === 'form');
  const all = node => [node, ...node.children.flatMap(all)];
  assert.equal(all(form).filter(n => n.type === 'checkbox').length, 0);
  const checks = all(app.nodes['batch-detail']).filter(n => n.type === 'checkbox');
  assert.equal(checks.length, 2);
  checks[1].checked = true; checks[1].onchange();
  form.children[0].children[0].value = 'warehouse-2';
  // Vehicle and driver are required, as on the dispatch-note page.
  form.onsubmit({ preventDefault() {} });
  assert.equal(app.nodes['confirm-dialog'].open, false);
  assert.match(app.nodes.notice.textContent, /biển số xe và tài xế/);
  form.children[1].children[0].value = ' 59C-123.45 ';
  form.children[2].children[0].value = 'Tài xế Ba';
  const pending = form.onsubmit({ preventDefault() {} });
  assert.equal(app.nodes['confirm-dialog'].open, true);
  assert.ok(app.nodes['confirm-body'].textContent.includes('PID-NEW-2'));
  assert.ok(!app.nodes['confirm-body'].textContent.includes('PID-NEW-1'));
  assert.equal(app.run('sent.length'), 0, 'nothing is sent before confirming');
  app.nodes['confirm-ok'].onclick(); await pending;
  const sent = JSON.parse(app.run('JSON.stringify(sent)'));
  assert.deepEqual(sent[0], ['/api/batches/' + batchId + '/dispatch', 'POST', { destinationWarehouseId: 'warehouse-2', palletIds: ['new-2'], vehicleNumber: '59C-123.45', driverName: 'Tài xế Ba', note: '' }]);
});


test('batch list and detail dialog offer whole-batch QR sheets', async () => {
  const app = await setup(); await app.run('refresh()');
  const listLink = findLink(app.nodes.batches, 'In QR mẻ');
  assert.ok(listLink); assert.equal(listLink.href, '/api/batches/' + batchId + '/labels'); assert.equal(listLink.target, '_blank');
  assert.ok(find(app.nodes.batches, 'Xem chi tiết'));
  await app.run(`openBatch('${batchId}')`);
  assert.equal(findLink(app.nodes['batch-detail'], 'In QR mẻ (batch + pallet)').href, '/api/batches/' + batchId + '/labels');
  assert.equal(findLink(app.nodes['batch-detail'], 'In QR đầy đủ (kèm carton)').href, '/api/batches/' + batchId + '/labels?cartons=true');
});

test('issuance section provides 3 subtabs for direct pallet dispatch, dispatch book, and batch list', async () => {
  const app = await setup('', '/issuance');
  assert.equal(app.nodes['view-ready-pallets'].hidden, false);
  assert.equal(app.nodes['view-dispatch-notes'].hidden, true);
  assert.equal(app.nodes['view-batch-list'].hidden, true);

  await app.run("setIssuanceSubtab('dispatch-notes')");
  assert.equal(app.nodes['view-ready-pallets'].hidden, true);
  assert.equal(app.nodes['view-dispatch-notes'].hidden, false);
  assert.equal(app.nodes['view-batch-list'].hidden, true);

  await app.run("setIssuanceSubtab('batch-list')");
  assert.equal(app.nodes['view-ready-pallets'].hidden, true);
  assert.equal(app.nodes['view-dispatch-notes'].hidden, true);
  assert.equal(app.nodes['view-batch-list'].hidden, false);
});

test('ready pallets table renders and allows selecting pallets to create factory dispatch note', async () => {
  const app = await setup('', '/issuance');
  const readyPalletsData = [
    { palletId: 'p-1', palletCode: 'PID-F01-20261121-A-0001-0001', batchId: 'b-1', batchCode: 'BID-F01-20261121-A-0001', sku: 'SKU001', productName: 'Sữa chua', productionLine: 'A', productionDate: '2026-11-21', expirationDate: '2026-12-05', cartonCount: 10, unitCount: 120 },
    { palletId: 'p-2', palletCode: 'PID-F01-20261121-B-0001-0001', batchId: 'b-2', batchCode: 'BID-F01-20261121-B-0001', sku: 'SKU002', productName: 'Sữa chua nha đam', productionLine: 'B', productionDate: '2026-11-21', expirationDate: '2026-12-05', cartonCount: 10, unitCount: 120 }
  ];
  app.context.readyPalletsData = readyPalletsData;
  app.run(`readyPallets = readyPalletsData; warehouses = [{ id: 'wh-1', code: 'WH01', name: 'Kho Thủ Đức', isActive: true }]; renderReadyPallets();`);
  
  const text = app.nodes['ready-pallets-table'].textContent;
  assert.ok(text.includes('PID-F01-20261121-A-0001-0001'));
  assert.ok(text.includes('PID-F01-20261121-B-0001-0001'));

  // Select all pallets
  app.nodes['btn-select-all-pallets'].onclick();
  assert.equal(app.run('selectedReadyPalletIds.size'), 2);
  assert.ok(app.nodes['ready-selected-summary'].textContent.includes('2 pallet'));
  assert.ok(app.nodes['ready-selected-summary'].textContent.includes('20 thùng'));
  assert.ok(app.nodes['ready-selected-summary'].textContent.includes('240 SP'));

  // Set warehouse and check dispatch submission
  app.nodes['ready-destination-warehouse'].value = 'wh-1';
  app.nodes['ready-vehicle-number'].value = '59C-888.88';
  app.nodes['ready-driver-name'].value = 'Tài xế Ba';
  app.run(`globalThis.dispatchedData = []; api = async (url, method, body) => {
    dispatchedData.push({ url, method, body });
    return { id: 'note-1', code: 'PXN-F01-20261121-0001', palletCount: 2 };
  }; refresh = async () => {}; openDispatchNote = async () => {};`);

  // "Hủy" in the confirm popup sends nothing.
  let pending = app.nodes['btn-create-dispatch'].onclick();
  assert.equal(app.nodes['confirm-dialog'].open, true);
  assert.equal(app.nodes['confirm-title'].textContent, 'Xác nhận xuất pallet sang kho');
  assert.ok(app.nodes['confirm-body'].textContent.includes('WH01 · Kho Thủ Đức'));
  assert.ok(app.nodes['confirm-body'].textContent.includes('2 pallet · 20 thùng · 240 sản phẩm'));
  app.nodes['confirm-cancel'].onclick(); await pending;
  assert.equal(app.nodes['confirm-dialog'].open, false);
  assert.equal(app.run('dispatchedData.length'), 0);
  // Confirming sends the dispatch.
  pending = app.nodes['btn-create-dispatch'].onclick();
  app.nodes['confirm-ok'].onclick(); await pending;
  const dispatched = JSON.parse(app.run('JSON.stringify(dispatchedData)'));
  assert.equal(dispatched[0].url, '/api/dispatches');
  assert.equal(dispatched[0].method, 'POST');
  assert.equal(dispatched[0].body.destinationWarehouseId, 'wh-1');
  assert.equal(dispatched[0].body.vehicleNumber, '59C-888.88');
  assert.equal(dispatched[0].body.driverName, 'Tài xế Ba');
  assert.deepEqual(dispatched[0].body.palletIds.sort(), ['p-1', 'p-2'].sort());
});

test('dispatch notes table renders factory dispatch notes with print link and status badge', async () => {
  const app = await setup('', '/issuance');
  const notesData = [
    { id: 'note-1', code: 'PXN-F01-20261121-0001', factoryCode: 'F01', destinationWarehouseId: 'wh-1', destinationWarehouseName: 'Kho Thủ Đức', vehicleNumber: '59C-888.88', driverName: 'Tài xế Ba', palletCount: 2, cartonCount: 20, unitCount: 240, dispatchedAt: '2026-11-21T14:30:00Z', createdByName: 'Admin', status: 'Dispatched', palletCodes: ['PID-1', 'PID-2'] }
  ];
  app.context.notesData = notesData;
  app.run(`dispatchNotes = notesData; renderDispatchNotes();`);

  const text = app.nodes['dispatch-notes-table'].textContent;
  assert.ok(text.includes('PXN-F01-20261121-0001'));
  assert.ok(text.includes('Kho Thủ Đức'));
  assert.ok(text.includes('59C-888.88 · Tài xế Ba'));
  assert.ok(text.includes('Đang vận chuyển'));
  assert.ok(find(app.nodes['dispatch-notes-table'], 'Xem chi tiết'));
  const printLink = findLink(app.nodes['dispatch-notes-table'], 'In Phiếu (A4)');
  assert.ok(printLink);
  assert.equal(printLink.href, '/api/dispatches/note-1/print');
});
test('dispatch-note page also requires vehicle and driver before the confirm popup', async () => {
  const app = await setup('', '/issuance');
  app.run(`readyPallets = [{ palletId: 'p-1', palletCode: 'PID-1', batchId: 'b', batchCode: 'BID', sku: 'SKU001', productName: 'Sữa', productionLine: 'A', productionDate: '2026-11-21', expirationDate: '2026-12-05', cartonCount: 10, unitCount: 120 }];
    warehouses = [{ id: 'wh-1', code: 'WH01', name: 'Kho Thủ Đức', isActive: true }]; renderReadyPallets(); selectedReadyPalletIds.add('p-1');
    globalThis.sent = []; api = async (...args) => { sent.push(args); return {}; };`);
  app.nodes['ready-destination-warehouse'].value = 'wh-1';
  app.nodes['ready-vehicle-number'].value = '59C-888.88';
  app.nodes['ready-driver-name'].value = '   ';
  await app.nodes['btn-create-dispatch'].onclick();
  assert.equal(app.nodes['confirm-dialog'].open, false);
  assert.match(app.nodes.notice.textContent, /biển số xe và tài xế/);
  assert.equal(app.run('sent.length'), 0);
  const html = fs.readFileSync(path.join(__dirname, '../wwwroot/index.html'), 'utf8');
  assert.match(html, /id="ready-vehicle-number"[^>]*required/);
  assert.match(html, /id="ready-driver-name"[^>]*required/);
});

test('line-SKU filtering and packaging spec auto-fill work on production form', async () => {
  const app = await setup('', '/production');
  app.run(`
    catalogProducts = [
      { id: 'sku-1', sku: 'SKU001', name: 'Nước suối 500ml', status: 'Published' },
      { id: 'sku-2', sku: 'SKU002', name: 'Trà xanh 330ml', status: 'Published' }
    ];
    standards = {
      packagingSpecs: [{ productId: 'sku-1', sku: 'SKU001', productName: 'Nước suối 500ml', cartonsPerPallet: 40, unitsPerCarton: 24 }],
      lineRules: [{ productionLine: 'A', productId: 'sku-1', sku: 'SKU001', productName: 'Nước suối 500ml' }]
    };
  `);
  app.nodes['production-line'].value = 'A';
  app.run('renderSkuOptionsForLine();');
  assert.deepEqual(app.nodes.products.children.map(o => o.value), ['', 'sku-1']);

  app.nodes.products.value = 'sku-1';
  app.run('applyPackagingSpecForSelectedSku();');
  assert.equal(app.nodes['cartons-per-pallet'].value, 40);
  assert.equal(app.nodes['units-per-carton'].value, 24);
  assert.equal(app.nodes['cartons-per-pallet'].readOnly, true);
  assert.equal(app.nodes['units-per-carton'].readOnly, true);
  assert.match(app.nodes['packaging-spec-hint'].textContent, /40 carton\/pallet/);

  app.nodes['production-line'].value = 'B';
  app.run('renderSkuOptionsForLine(); applyPackagingSpecForSelectedSku();');
  assert.deepEqual(app.nodes.products.children.map(o => o.value), ['', 'sku-1', 'sku-2']);
  app.nodes.products.value = 'sku-2';
  app.run('applyPackagingSpecForSelectedSku();');
  assert.equal(app.nodes['cartons-per-pallet'].readOnly, false);
  assert.equal(app.nodes['units-per-carton'].readOnly, false);
});