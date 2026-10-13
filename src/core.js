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

// ---------- contract: the exact thing that will execute ----------
function toContract(p) {
  if (p.kind === 'order') {
    const qty = p.qty ?? 1;
    return {
      kind: 'order',
      sku: norm(p.sku), name: norm(p.name),
      allergens: [...new Set((p.allergens || []).map(norm))].sort(),
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
function parseSpokenMoney(s) {
  const t = norm(s).replace(/[$,]/g, '');
  const m = t.match(/^(\d+)(?:\.(\d{1,2}))?/);
  if (m) return Number(m[1]) * 100 + Number((m[2] || '0').padEnd(2, '0'));
  let total = 0, cur = 0, seen = false;
  for (const w of t.split(/[\s-]+/)) {
    if (w in WORDS) { cur += WORDS[w]; seen = true; }
    else if (w === 'hundred') { cur = (cur || 1) * 100; seen = true; }
    else if (w === 'thousand') { total += (cur || 1) * 1000; cur = 0; seen = true; }
  }
  if (!seen) throw new Error('could not understand amount: ' + s);
  return (total + cur) * 100;
}
function parseSpokenList(s) {
  const t = norm(s);
  if (!t || /^(none|no|nothing|nobody|skip)$/.test(t)) return [];
  return t.split(/\s*(?:,|\band\b)\s*/).map(norm).filter(Boolean);
}
function setupConstitution(starter, answers = {}) {
  if (!STARTERS[starter]) throw new Error('unknown starter: ' + starter);
  const params = { ...STARTERS[starter] };
  for (const q of SETUP_QUESTIONS) {
    const a = answers[q.key];
    if (a !== undefined && !/^\s*skip\s*$/i.test(a)) params[q.key] = q.parse(a);
  }
  params.blockedAllergens = params.blockedAllergens.map(norm).sort();
  params.approvedContacts = params.approvedContacts.map(norm).sort();
  const body = { version: 1, starter, params, prevHash: null };
  return Object.freeze({ ...body, hash: hashOf(body) });
}

// ---------- the three rules + tiers ----------
// Tiers: 0 silent+log, 1 notify after, 2 spoken confirm before, 3 refuse.
const TIER = { SILENT: 0, NOTIFY: 1, CONFIRM: 2, REFUSE: 3 };
function evaluate(contract, constitution) {
  const P = constitution.params, reasons = [];
  let tier = TIER.SILENT;
  const raise = (t, rule, say) => { reasons.push({ rule, say }); if (t > tier) tier = t; };
  if (contract.kind === 'order') {
    const hit = contract.allergens.filter(a => P.blockedAllergens.includes(a));
    if (hit.length) raise(TIER.REFUSE, 'allergen', `it contains ${hit.join(', ')}, and I promised never to bring that into your home`);
    if (contract.sku !== contract.requestedSku)
      raise(TIER.CONFIRM, 'substitution', `it is a substitute for what you asked for`);
    if (contract.totalCents > P.spendConfirmCents)
      raise(TIER.CONFIRM, 'spend', `it costs ${money(contract.totalCents)}, over your ${money(P.spendConfirmCents)} ask-first limit`);
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

module.exports = { verifyConstitution, canon, sha, hashOf, norm, toContract, STARTERS, SETUP_QUESTIONS, parseSpokenMoney,
  parseSpokenList, setupConstitution, TIER, evaluate, money, describe, spokenPrompt };
