'use strict';
// Household Constitution — deterministic gate core (stdlib only).
// The agent PROPOSES; this module decides. No LLM in the decision path.
const crypto = require('node:crypto');

// ---------- canonical form + hashing ----------
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined)
      .map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  if (typeof v === 'number' && !Number.isInteger(v)) throw new Error('non-integer number in contract (use cents)');
  return JSON.stringify(v);
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const hashOf = v => sha(canon(v));
const norm = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const ALLERGEN_CANON = {
  peanut: ['peanuts'], peanuts: ['peanuts'],
  'tree nut': ['tree nuts'], 'tree nuts': ['tree nuts'],
  nut: ['peanuts', 'tree nuts'], nuts: ['peanuts', 'tree nuts'],
  soy: ['soy'], soya: ['soy'], soybean: ['soy'], soybeans: ['soy'],
};
function expandAllergens(list) {
  const out = [];
  for (const raw of list || []) {
    const n = norm(raw);
    if (!n) continue;
    out.push(...(ALLERGEN_CANON[n] || [n]));
  }
  return [...new Set(out)].sort();
}

// ---------- contract: the exact thing that will execute ----------
function toContract(p) {
  if (p.kind === 'order') {
    const qty = p.qty ?? 1;
    if (!Number.isInteger(qty) || qty < 1) throw new Error('quantity must be a whole number of at least 1');
    if (!Number.isInteger(p.unitCents) || p.unitCents < 0) throw new Error('price must be zero or more cents');
    if (!Array.isArray(p.allergens)) throw new Error('an order needs its allergen list');
    return {
      kind: 'order',
      sku: norm(p.sku), name: norm(p.name),
      allergens: expandAllergens(p.allergens),
      qty, unitCents: p.unitCents, totalCents: qty * p.unitCents,
      address: norm(p.address), deliveryDate: p.deliveryDate,
      requestedSku: norm(p.requestedSku ?? p.sku),
    };
  }
  if (p.kind === 'message') return { kind: 'message', to: norm(p.to), body: String(p.body) };
  throw new Error('unknown action kind: ' + p.kind);
}

// ---------- constitution: starters, spoken setup, versions ----------
const STARTERS = {
  family:    { spendConfirmCents: 7500,  notifyCents: 2000, blockedAllergens: [], approvedContacts: [] },
  solo:      { spendConfirmCents: 15000, notifyCents: 5000, blockedAllergens: [], approvedContacts: [] },
  roommates: { spendConfirmCents: 5000,  notifyCents: 1500, blockedAllergens: [], approvedContacts: [] },
};
// At most four spoken questions, each with a default so "skip" works.
const SETUP_QUESTIONS = [
  { key: 'spendConfirmCents', ask: 'Above what amount should I always ask before buying?', parse: parseSpokenMoney },
  { key: 'notifyCents', ask: 'Above what amount should I just tell you afterwards?', parse: parseSpokenMoney },
  { key: 'blockedAllergens', ask: 'Any allergies I must never substitute into an order?', parse: parseSpokenList },
  { key: 'approvedContacts', ask: 'Who can I message without asking first?', parse: parseSpokenList },
];
const WORDS = { zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11,
  twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19, twenty:20,
  thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90 };
function wordsToNumber(phrase) {
  const p = norm(phrase);
  let total = 0, cur = 0, seen = false;
  for (const w of p.split(/[\s-]+/)) {
    if (!w || w === 'and' || w === 'a') continue;
    if (/^\d+$/.test(w)) { cur += Number(w); seen = true; }
    else if (w in WORDS) { cur += WORDS[w]; seen = true; }
    else if (w === 'hundred') { cur = (cur || 1) * 100; seen = true; }
    else if (w === 'thousand') { total += (cur || 1) * 1000; cur = 0; seen = true; }
    else if (w === 'million') { total += (cur || 1) * 1_000_000; cur = 0; seen = true; }
    else throw new Error('could not understand amount: ' + phrase);
  }
  if (!seen) throw new Error('could not understand amount: ' + phrase);
  return total + cur;
}
function parseSpokenMoney(s) {
  const t = norm(s).replace(/[$,]/g, '');
  if (!t) throw new Error('could not understand amount: ' + s);
  let m = t.match(/^(\d+)(?:\.(\d{1,2}))?\s+cents?$/);
  if (m && !m[2]) return Number(m[1]);
  m = t.match(/^(.*?)\s+dollars?\s+and\s+(.*?)\s+cents?$/);
  if (m) return wordsToNumber(m[1]) * 100 + wordsToNumber(m[2]);
  m = t.match(/^(.*?)\s+dollars?$/);
  if (m) return wordsToNumber(m[1]) * 100;
  m = t.match(/^(.*?)\s+cents?$/);
  if (m) return wordsToNumber(m[1]);
  m = t.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (m) return Number(m[1]) * 100 + Number((m[2] || '0').padEnd(2, '0'));
  return wordsToNumber(t) * 100;
}
function parseSpokenList(s) {
  const t = norm(s);
  if (!t || /^(none|no|nothing|nobody|skip)$/.test(t)) return [];
  return t.split(/\s*(?:,|;|\/|&|\band\b|\bor\b|\bplus\b)\s*/)
    .map(x => norm(x).replace(/^(?:no|please)\s+/, '')).filter(Boolean);
}
function setupConstitution(starter, answers = {}) {
  if (!STARTERS[starter]) throw new Error('unknown starter: ' + starter);
  const params = { ...STARTERS[starter] };
  for (const q of SETUP_QUESTIONS) {
    const a = answers[q.key];
    if (a !== undefined && !/^\s*skip\s*$/i.test(a)) params[q.key] = q.parse(a);
  }
  params.blockedAllergens = expandAllergens(params.blockedAllergens);
  params.approvedContacts = params.approvedContacts.map(norm).sort();
  const body = { version: 1, starter, params, prevHash: null };
  return Object.freeze({ ...body, hash: hashOf(body) });
}

// ---------- the three rules + tiers ----------
// Tiers: 0 silent+log, 1 notify after, 2 spoken confirm before, 3 refuse.
const TIER = { SILENT: 0, NOTIFY: 1, CONFIRM: 2, REFUSE: 3 };
// ctx.recentCents: what was spent WITHOUT asking in the last 24h, so a big order
// can't slip through split into small ones.
function evaluate(contract, constitution, ctx = {}) {
  const P = constitution.params, reasons = [];
  const recent = ctx.recentCents || 0;
  let tier = TIER.SILENT;
  const raise = (t, rule, say) => { reasons.push({ rule, say }); if (t > tier) tier = t; };
  if (contract.kind === 'order') {
    const hit = contract.allergens.filter(a => P.blockedAllergens.includes(a));
    if (hit.length) raise(TIER.REFUSE, 'allergen', `it contains ${hit.join(', ')}, and I promised never to bring that into your home`);
    if (contract.sku !== contract.requestedSku)
      raise(TIER.CONFIRM, 'substitution', `it is a substitute for what you asked for`);
    if (contract.totalCents > P.spendConfirmCents)
      raise(TIER.CONFIRM, 'spend', `it costs ${money(contract.totalCents)}, over your ${money(P.spendConfirmCents)} ask-first limit`);
    else if (recent + contract.totalCents > P.spendConfirmCents)
      raise(TIER.CONFIRM, 'spend', `together with today's other orders it comes to ${money(recent + contract.totalCents)}, over your ${money(P.spendConfirmCents)} ask-first limit`);
    else if (contract.totalCents > P.notifyCents)
      raise(TIER.NOTIFY, 'spend', `it costs ${money(contract.totalCents)}`);
  } else if (contract.kind === 'message') {
    if (!P.approvedContacts.includes(contract.to))
      raise(TIER.CONFIRM, 'contacts', `${contract.to} is not on your approved contact list`);
  }
  return { tier, reasons };
}
const money = c => '$' + (c / 100).toFixed(2);

// ---------- consumer-facing language: what / who / undo. No codes. ----------
function describe(contract) {
  return contract.kind === 'order'
    ? `order ${contract.qty} × ${contract.name} for ${money(contract.totalCents)}, delivered ${contract.deliveryDate}`
    : `send "${contract.body}" to ${contract.to}`;
}
function spokenPrompt(contract, ev) {
  return `I'm about to ${describe(contract)}. I'm checking because ${ev.reasons.map(r => r.say).join(' and ')}. Should I go ahead?`;
}

function verifyConstitution(c) { const { hash, ...body } = c || {}; return !!hash && hashOf(body) === hash; }

module.exports = { verifyConstitution, canon, sha, hashOf, norm, expandAllergens, toContract, STARTERS, SETUP_QUESTIONS, parseSpokenMoney,
  parseSpokenList, setupConstitution, TIER, evaluate, money, describe, spokenPrompt };
