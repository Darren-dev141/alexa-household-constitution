'use strict';
// Sandbox store. It is the source of truth for what will actually ship and what it costs:
// the assistant only says WHAT the household asked for ("oat milk", 2), never the price,
// the SKU, or the allergens. Scenario knobs let the demo make the store misbehave.
const crypto = require('node:crypto');
const { norm } = require('./core');

const CATALOG = [
  { sku: 'oat-milk-6', name: 'Oat milk 6-pack', unitCents: 1899, allergens: [], aliases: ['oat milk'] },
  { sku: 'almond-milk-6', name: 'Almond milk 6-pack', unitCents: 1799, allergens: ['tree nuts'], aliases: ['almond milk'] },
  { sku: 'soy-milk-6', name: 'Soy milk 6-pack', unitCents: 1999, allergens: ['soy'], aliases: ['soy milk'] },
  { sku: 'paper-towels-12', name: 'Paper towels 12 rolls', unitCents: 2499, allergens: [], aliases: ['paper towels'] },
  { sku: 'dish-soap', name: 'Dish soap', unitCents: 399, allergens: [], aliases: ['dish soap', 'soap'] },
  { sku: 'peanut-butter', name: 'Peanut butter', unitCents: 549, allergens: ['peanuts'], aliases: ['peanut butter'] },
  { sku: 'air-fryer', name: 'Air fryer', unitCents: 8999, allergens: [], aliases: ['air fryer'] },
];

class SandboxVendor {
  constructor({ deliveryDate = '2026-10-15' } = {}) {
    this.items = new Map(CATALOG.map(i => [i.sku, { ...i }]));
    this.substitutes = new Map(); // requested sku -> sku the store will actually send
    this.quotes = new Map();
    this.orders = [];
    this.address = null;
    this.deliveryDate = deliveryDate;
  }
  find(spoken) {
    const s = norm(spoken).replace(/^(some|a|an|the|more)\s+/, '');
    for (const i of this.items.values()) if (i.aliases.includes(s) || norm(i.name) === s) return i;
    for (const i of this.items.values()) if (i.aliases.some(a => s.includes(a))) return i;
    return null;
  }
  line(requested, qty) {
    const shipSku = this.substitutes.get(requested.sku) || requested.sku;
    const ship = this.items.get(shipSku);
    return { kind: 'order', sku: ship.sku, name: ship.name, qty, unitCents: ship.unitCents, allergens: ship.allergens,
      address: this.address, deliveryDate: this.deliveryDate, requestedSku: requested.sku };
  }
  quote(spokenItem, qty) {
    const want = this.find(spokenItem);
    if (!want) return null;
    const quoteId = crypto.randomBytes(6).toString('hex');
    this.quotes.set(quoteId, { sku: want.sku, qty });
    return { quoteId, line: this.line(want, qty) };
  }
  // What the store will actually charge right now: re-read at checkout, after any approval.
  finalize(quoteId) {
    const q = this.quotes.get(quoteId);
    if (!q) return null;
    return this.line(this.items.get(q.sku), q.qty);
  }
  commit(contract) {
    const ref = 'SANDBOX-' + (this.orders.length + 1);
    this.orders.push({ ref, ...contract });
    return { ref };
  }
  // scenario knobs
  setSubstitute(sku, withSku) { withSku ? this.substitutes.set(sku, withSku) : this.substitutes.delete(sku); }
  setPrice(sku, cents) { this.items.get(sku).unitCents = cents; }
}

module.exports = { SandboxVendor, CATALOG };
