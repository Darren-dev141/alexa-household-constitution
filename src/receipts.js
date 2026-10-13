'use strict';
// Append-only, hash-chained receipt log + replay + tuning suggestions.
const fs = require('node:fs');
const { canon, sha, evaluate } = require('./core');

class ReceiptLog {
  constructor(file) { this.file = file; if (!fs.existsSync(file)) fs.writeFileSync(file, ''); }
  entries() { return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); }
  append(entry) {
    const all = this.entries(), prev = all.length ? all[all.length - 1].hash : null;
    const body = { seq: all.length, ts: new Date().toISOString(), prev, ...entry };
    const rec = { ...body, hash: sha(canon(body)) };
    fs.appendFileSync(this.file, JSON.stringify(rec) + '\n');
    return rec;
  }
  verify() {
    let prev = null; const all = this.entries();
    for (const r of all) {
      const { hash, ...body } = r;
      if (r.prev !== prev) return { ok: false, at: r.seq, why: 'chain broken' };
      if (sha(canon(body)) !== hash) return { ok: false, at: r.seq, why: 'entry altered' };
      prev = hash;
    }
    return { ok: true, count: all.length };
  }
}

// Re-run the recorded contract against the recorded constitution version.
function replay(receipt, constitutionsByHash) {
  const c = constitutionsByHash[receipt.constitutionHash];
  if (!c) return { ok: false, why: 'constitution version not found' };
  const ev = evaluate(receipt.contract, c);
  return { ok: ev.tier === receipt.tier, recordedTier: receipt.tier, replayedTier: ev.tier };
}

// A rule that keeps getting a "yes" with no change is friction, not protection.
// Suggest (never apply) a looser setting; the amendment flow still needs a spoken yes.
function tuningSuggestions(entries, threshold = 5) {
  const counts = {};
  for (const r of entries) {
    if (r.type !== 'decision' || r.tier !== 2 || r.approval !== 'yes') continue;
    for (const rule of r.rules || []) {
      if (rule === 'allergen') continue; // safety rules are never suggested for loosening
      (counts[rule] ||= []).push(r);
    }
  }
  return Object.entries(counts).filter(([, rs]) => rs.length >= threshold).map(([rule, rs]) => {
    if (rule === 'spend') {
      const max = Math.max(...rs.map(r => r.contract.totalCents));
      return { rule, approvals: rs.length, say: `You've approved ${rs.length} orders over your ask-first limit, up to $${(max / 100).toFixed(2)}. Want me to raise the limit to $${Math.ceil(max / 100 / 5) * 5}?` };
    }
    if (rule === 'contacts') {
      const tos = [...new Set(rs.map(r => r.contract.to))];
      return { rule, approvals: rs.length, say: `You keep approving messages to ${tos.join(', ')}. Want me to add them to your approved contacts?` };
    }
    return { rule, approvals: rs.length, say: `You've said yes to ${rs.length} substitutions. Want me to only ask about substitutions that cost more?` };
  });
}

module.exports = { ReceiptLog, replay, tuningSuggestions };
