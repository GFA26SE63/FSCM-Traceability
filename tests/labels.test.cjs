const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('labels.css centers title, QR svg, code, and info lines both on screen and in print', () => {
  const css = fs.readFileSync(path.join(__dirname, '../wwwroot/labels.css'), 'utf8');

  // Article container maintains size, margin, display, and centers contents
  assert.match(css, /article\s*\{[^}]*display:\s*inline-block;[^}]*width:\s*280px;[^}]*padding:\s*12px;[^}]*margin:\s*8px;[^}]*text-align:\s*center;/s);

  // Title b element is block and centered
  assert.match(css, /b\s*\{[^}]*display:\s*block;[^}]*text-align:\s*center;/s);

  // QR svg element preserves dimensions (180x180) and has auto horizontal margins
  assert.match(css, /svg\s*\{[^}]*display:\s*block;[^}]*width:\s*180px;[^}]*height:\s*180px;[^}]*margin:\s*0 auto;/s);

  // Code small element is block, centered, and wraps long text safely
  assert.match(css, /small\s*\{[^}]*display:\s*block;[^}]*text-align:\s*center;[^}]*overflow-wrap:\s*anywhere;/s);

  // Info p elements are centered
  assert.match(css, /p\s*\{[^}]*text-align:\s*center;/s);

  // Print media query preserves centering and hides toolbar
  const printIndex = css.indexOf('@media print');
  assert.ok(printIndex !== -1, '@media print block should exist');
  const printSection = css.slice(printIndex);
  assert.match(printSection, /\.print-toolbar\s*\{[^}]*display:\s*none;/s);
  assert.match(printSection, /article\s*\{[^}]*text-align:\s*center;/s);
  assert.match(printSection, /b\s*\{[^}]*text-align:\s*center;/s);
  assert.match(printSection, /svg\s*\{[^}]*margin:\s*0 auto;/s);
  assert.match(printSection, /small\s*\{[^}]*text-align:\s*center;/s);
  assert.match(printSection, /p\s*\{[^}]*text-align:\s*center;/s);
});

test('FactoryLabels.cs links to labels.css and maintains label component structure', () => {
  const cs = fs.readFileSync(path.join(__dirname, '../Services/FactoryLabels.cs'), 'utf8');

  assert.match(cs, /<link rel='stylesheet' href='\/labels\.css\?v=[^']+'>/);
  assert.match(cs, /<article><b>\{WebUtility\.HtmlEncode\(level\)\}<\/b>/);
  assert.match(cs, /<small>\{WebUtility\.HtmlEncode\(code\)\}<\/small>/);
  assert.match(cs, /<p>SKU \{WebUtility\.HtmlEncode\(sku\)\}<\/p>/);
  assert.match(cs, /<p>Batch \{WebUtility\.HtmlEncode\(batch\.Code\)\}<\/p>/);
  assert.match(cs, /<p>NSX \{batch\.ProductionDate:dd\/MM\/yyyy\} · HSD \{batch\.ExpirationDate:dd\/MM\/yyyy\}<\/p><\/article>/);
});
