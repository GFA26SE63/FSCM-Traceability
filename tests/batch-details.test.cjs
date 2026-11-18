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
async function setup(hash = '') {
  const html = fs.readFileSync(path.join(__dirname, '../wwwroot/index.html'), 'utf8');
  const nodes = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element('div')]));
  const requests = [], location = { pathname: '/', search: '', hash, reload() {} };
  const context = vm.createContext({
    Node: Element, Date, URLSearchParams, console,
    crypto: { randomUUID: () => 'request-key' },
    document: { getElementById(id) { assert.ok(nodes[id], `Unknown element ${id}`); return nodes[id]; }, createElement: tag => new Element(tag), body: new Element('body') },
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
  form.onsubmit({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve));
  const sent = JSON.parse(app.run('JSON.stringify(sent)'));
  assert.deepEqual(sent[0], ['/api/batches/' + batchId + '/dispatch', 'POST', { destinationWarehouseId: 'warehouse-2', palletIds: ['new-2'] }]);
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
