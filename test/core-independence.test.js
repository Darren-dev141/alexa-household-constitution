'use strict';
// The promises core must stay platform-agnostic: MCP is the first adapter, not the product.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path');

test('core files depend on nothing but Node built-ins and each other', () => {
  for (const f of ['core.js', 'gate.js', 'receipts.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    const deps = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
    for (const d of deps) assert.ok(d.startsWith('node:') || /^\.\/(core|gate|receipts)$/.test(d), `${f} requires ${d}`);
  }
});
