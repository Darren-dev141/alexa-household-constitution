'use strict';
// Gate (decides + issues single-use tokens) and Executor (holds vendor creds,
// recomputes the hash of what it is ACTUALLY about to send). The agent holds
// neither the gate key nor vendor credentials, so it cannot argue past a rule:
// it never sees anything except the decision and the spoken prompt.
const crypto = require('node:crypto');
const { hashOf, toContract, evaluate, spokenPrompt, describe, TIER, norm, expandAllergens } = require('./core');

const TOKEN_TTL_MS = 60_000;
const YES = /^(yes|yeah|yep|sure|go ahead|do it|ok|okay)[.!]?$/;
const YES_PLAIN = /^(yes|yeah|yep|sure|ok|okay)[.!]?$/;
const YES_LOOSEN = /^yes,? change it[.!]?$/;
const NEGATION = /\b(no|not|never|cancel|don't|dont)\b/;

const GUEST_DEFAULT_MS = 4 * 3600_000;
const listJoin = xs => xs.length < 2 ? (xs[0] || '') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
// The guest-facing promise, in the same plain language as the household's.
function guestText(g) {
  if (!g) return 'Guest Mode is off, so only people who live here can use me.';
  const at = new Date(g.until).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const can = g.allow.length ? `ask me to order ${listJoin(g.allow)}` : 'ask me general questions';
  return `While Guest Mode is on, a guest can ${can} — and only within the same limits as everyone else. ` +
    `Guests can't send messages, swap what they asked for, change the promises, or hear what this home has done or promised. ` +
    `Guest Mode turns itself off at ${at}.`;
}
// Why a guest may not do this, or null when the guest may (the household's own
// rules still apply on top: allergens refuse, tiers still tier).
function guestDeny(contract, g, ev) {
  if (contract.kind !== 'order')
    return { rule: 'guest-messages', say: "Guests can't send messages. Only people who live here can ask me to do that." };
  if (ev.tier === TIER.REFUSE) return null; // the refusal below says why (allergen)
  if (!g.allow.includes(contract.sku) && !g.allow.includes(contract.name))
    return { rule: 'guest-allowlist', say: `${contract.name} isn't on the list of things guests can order here.` };
  if (contract.sku !== contract.requestedSku)
    return { rule: 'guest-substitution', say: 'Guests can only get exactly what they asked for — no swaps.' };
  if (ev.tier === TIER.CONFIRM)
    return { rule: 'guest-confirm', say: "That needs an okay from a person who lives here, and a guest can't give it or get it. I've left it undone." };
  return null;
}

class Gate {
  constructor({ constitution, log, key, now = Date.now, versions, onAdopt, zones, onZone, guest = null, onGuest }) {
    this.key = key; this.log = log; this.now = now;
    this.versions = { ...(versions || {}) }; this.pending = new Map();
    this.zones = new Map(zones || []);
    this.onZone = onZone;
    this.guest = guest;
    this.onGuest = onGuest;
    this.adopt(constitution);
    this.onAdopt = onAdopt;
  }
  adopt(c) { this.constitution = c; this.versions[c.hash] = c; if (this.onAdopt) this.onAdopt(c); }

  token(contractHash) {
    const nonce = crypto.randomBytes(12).toString('hex'), exp = this.now() + TOKEN_TTL_MS;
    const msg = `${contractHash}|${this.constitution.hash}|${nonce}|${exp}`;
    return { contractHash, constitutionHash: this.constitution.hash, nonce, exp,
      mac: crypto.createHmac('sha256', this.key).update(msg).digest('hex') };
  }

  // Orders let through without asking in the last 24h. Counted at decision time,
  // so it errs toward asking (an allowed order whose checkout was stopped still counts).
  recentUnaskedSpend() {
    const cutoff = this.now() - 24 * 3600_000;
    return this.log.entries().filter(e => e.type === 'decision' && e.approval === 'auto' && e.decision === 'allowed'
      && e.contract.kind === 'order' && Date.parse(e.ts) >= cutoff).reduce((a, e) => a + e.contract.totalCents, 0);
  }

  // Guest Mode state, with the expiry applied. Discovering the expiry is
  // receipted, the same way a zone change is.
  guestActive() {
    if (!this.guest) return null;
    if (this.now() < this.guest.until) return this.guest;
    const g = this.guest; this.guest = null;
    this.log.append({ type: 'guest', decision: 'expired', until: g.until,
      constitutionVersion: this.constitution.version, constitutionHash: this.constitution.hash });
    if (this.onGuest) this.onGuest();
    return null;
  }

  // Guest Mode: only the decision-maker (source 'owner' — the owner-key route,
  // never an MCP tool) can turn it on, turn it off, or change the guest list.
  // It always carries an expiry and turns itself off. Every change is receipted.
  guestEvent({ active, durationMs, allow, source }) {
    const base = { type: 'guest', constitutionVersion: this.constitution.version, constitutionHash: this.constitution.hash };
    if (source !== 'owner') {
      this.log.append({ ...base, decision: 'rejected', active: !!active, attemptedBy: source || 'unknown' });
      return { status: 'rejected', say: 'Only the person who runs this home can change Guest Mode.' };
    }
    if (active) {
      const list = [...new Set((allow || []).map(norm).filter(Boolean))].sort();
      const until = this.now() + (Number.isFinite(durationMs) && durationMs > 0 ? durationMs : GUEST_DEFAULT_MS);
      this.guest = { until, allow: list };
      this.log.append({ ...base, decision: 'on', until, allow: list, setBy: 'decision-maker' });
      if (this.onGuest) this.onGuest();
      return { status: 'on', until, say: guestText(this.guest) };
    }
    if (!this.guestActive()) return { status: 'off', say: 'Guest Mode is already off.' };
    this.guest = null;
    this.log.append({ ...base, decision: 'off', setBy: 'decision-maker' });
    if (this.onGuest) this.onGuest();
    return { status: 'off', say: 'Guest Mode is off. Only people who live here can use me now.' };
  }

  // Agent proposes. Returns what Alexa should do next. With { actor: 'guest' }
  // the proposal is a guest's: default-deny at this gate, never by prompt.
  propose(proposal, { actor } = {}) {
    const t0 = process.hrtime.bigint();
    let contract;
    try { contract = toContract(proposal); }
    catch (e) { return { status: 'refused', say: e.message }; }
    const contractHash = hashOf(contract);
    const guest = actor === 'guest' ? this.guestActive() : null;
    if (actor === 'guest' && !guest) {
      const r = this.log.append({ type: 'decision', decision: 'refused', approval: null, approver: 'household rules',
        guest: true, rules: ['guest-mode-off'], tier: TIER.REFUSE, recentCents: 0,
        constitutionVersion: this.constitution.version, constitutionHash: this.constitution.hash, contract, contractHash });
      return { status: 'refused', receipt: r.seq, say: "Guest Mode isn't on, so I can only help people who live here." };
    }
    if (this.zones.size) {
      const zone = [...this.zones.values()][0];
      const r = this.log.append({ type: 'zone', decision: 'held', zone: zone.name, setBy: zone.setBy,
        constitutionVersion: this.constitution.version, constitutionHash: this.constitution.hash, contract, contractHash });
      return { status: 'held', zone: zone.name, receipt: r.seq,
        say: `I'm in a quiet zone right now, so I can't do that. I've written it down.` };
    }
    const recentCents = contract.kind === 'order' ? this.recentUnaskedSpend() : 0;
    const ev = evaluate(contract, this.constitution, { recentCents });
    const latencyMs = Number(process.hrtime.bigint() - t0) / 1e6;
    const base = { type: 'decision', constitutionVersion: this.constitution.version,
      constitutionHash: this.constitution.hash, contract, contractHash, tier: ev.tier, recentCents,
      rules: ev.reasons.map(r => r.rule), latencyUs: Math.round(latencyMs * 1000),
      ...(actor === 'guest' ? { guest: true } : {}) };
    if (actor === 'guest') {
      const deny = guestDeny(contract, guest, ev);
      if (deny) {
        const r = this.log.append({ ...base, decision: 'refused', approval: null, approver: 'household rules',
          rules: [...base.rules, deny.rule] });
        return { status: 'refused', say: deny.say, receipt: r.seq };
      }
    }
    if (ev.tier === TIER.REFUSE) {
      const r = this.log.append({ ...base, decision: 'refused', approval: null, approver: 'household rules' });
      return { status: 'refused', say: `I won't ${describe(contract)}: ${ev.reasons.filter(x => x.rule === 'allergen').map(x => x.say).join('; ')}.`, receipt: r.seq };
    }
    if (ev.tier === TIER.CONFIRM) {
      const id = crypto.randomBytes(8).toString('hex');
      this.pending.set(id, { contract, contractHash, base, why: ev.reasons.map(x => x.say) });
      return { status: 'confirm', pendingId: id, say: spokenPrompt(contract, ev) };
    }
    const r = this.log.append({ ...base, decision: 'allowed', approval: 'auto', approver: 'household rules' });
    return { status: ev.tier === TIER.NOTIFY ? 'notify' : 'silent', token: this.token(contractHash), receipt: r.seq,
      notify: ev.tier === TIER.NOTIFY ? `Done: I ${describe(contract).replace(/^order/, 'ordered').replace(/^send/, 'sent')}.` : null };
  }

  // Spoken answer from an authenticated household member, bound to the exact contract hash.
  confirm(pendingId, { said, speaker, source }) {
    const p = this.pending.get(pendingId);
    if (!p) return { status: 'expired' };
    if (source !== 'user-utterance') {
      this.pending.delete(pendingId);
      return { status: 'rejected', say: 'Only a person in the household can approve that.' };
    }
    const saidNorm = norm(said);
    const yes = YES.test(saidNorm) && !NEGATION.test(saidNorm);
    if (!yes) {
      this.pending.delete(pendingId);
      const r = this.log.append({ ...p.base, decision: 'declined', approval: 'no', approver: speaker });
      return { status: 'declined', receipt: r.seq };
    }
    if (this.zones.size) {
      const zone = [...this.zones.values()][0];
      this.log.append({ type: 'zone', decision: 'held', zone: zone.name, setBy: zone.setBy,
        constitutionVersion: this.constitution.version, constitutionHash: this.constitution.hash,
        contract: p.contract, contractHash: p.contractHash });
      return { status: 'held', zone: zone.name, say: `I'm in a quiet zone right now, so I can't do that. I've written it down.` };
    }
    const recentCents = p.contract.kind === 'order' ? this.recentUnaskedSpend() : 0;
    const ev = evaluate(p.contract, this.constitution, { recentCents });
    if (ev.tier === TIER.REFUSE) {
      this.pending.delete(pendingId);
      const r = this.log.append({ type: 'decision', constitutionVersion: this.constitution.version,
        constitutionHash: this.constitution.hash, contract: p.contract, contractHash: p.contractHash,
        tier: ev.tier, recentCents, rules: ev.reasons.map(x => x.rule), decision: 'refused',
        approval: null, approver: 'household rules' });
      return { status: 'refused', say: `I won't ${describe(p.contract)}: ${ev.reasons.filter(x => x.rule === 'allergen').map(x => x.say).join('; ')}.`, receipt: r.seq };
    }
    this.pending.delete(pendingId);
    const r = this.log.append({ ...p.base, decision: 'allowed', approval: 'yes', approver: speaker });
    return { status: 'approved', token: this.token(p.contractHash), receipt: r.seq };
  }

  // Quiet Zones (Portable Constitution, venue-side): while a zone is active,
  // every gated action is held and the hold is receipted. A zone set by a
  // venue signal can only be ended by that signal — a person in the home
  // cannot lift it early, and the attempt is receipted too. Zones entered by
  // the household itself can be lifted by the household.
  zoneEvent({ name, active, source }) {
    const z = norm(name);
    if (!z) throw new Error('zone needs a name');
    if (source !== 'venue-signal' && source !== 'user-utterance')
      return { status: 'rejected', say: 'Only a venue signal or a person in the home can change a quiet zone.' };
    const setBy = source === 'venue-signal' ? 'venue' : 'household';
    const base = { type: 'zone', zone: z, constitutionVersion: this.constitution.version, constitutionHash: this.constitution.hash };
    if (active) {
      const cur = this.zones.get(z);
      if (!cur || (setBy === 'venue' && cur.setBy !== 'venue')) {
        this.zones.set(z, { name: z, setBy });
        this.log.append({ ...base, decision: 'entered', setBy });
        if (this.onZone) this.onZone();
      }
      return { status: 'entered', zone: z, say: `Quiet zone on for ${z}. I'll hold anything I'm asked to do until it lifts.` };
    }
    const cur = this.zones.get(z);
    if (!cur) return { status: 'none', zone: z, say: `There is no quiet zone called ${z} right now.` };
    if (cur.setBy === 'venue' && source !== 'venue-signal') {
      this.log.append({ ...base, decision: 'exit-rejected', setBy: cur.setBy, attemptedBy: setBy });
      return { status: 'rejected', zone: z, say: 'That quiet zone was set by the venue, so it can only lift when the venue ends it.' };
    }
    this.zones.delete(z);
    this.log.append({ ...base, decision: 'exited', setBy: cur.setBy });
    if (this.onZone) this.onZone();
    return { status: 'exited', zone: z, say: `Quiet zone off for ${z}.` };
  }

  // Amendments: only from a person's voice, read back, spoken yes, new version + receipt.
  proposeAmendment(changes, { source }) {
    if (source !== 'user-utterance') {
      this.log.append({ type: 'amendment', decision: 'rejected', why: 'not from a household member', changes,
        constitutionVersion: this.constitution.version, constitutionHash: this.constitution.hash });
      return { status: 'rejected', say: "Only the person who runs this home can change that." };
    }
    const P = this.constitution.params, lines = [];
    let loosens = false;
    for (const [k, v] of Object.entries(changes)) {
      if (k === 'spendConfirmCents' || k === 'notifyCents') { if (v > P[k]) loosens = true;
        lines.push(`${k === 'spendConfirmCents' ? 'ask-first limit' : 'tell-me-after limit'} from $${P[k] / 100} to $${v / 100}`); }
      else if (k === 'blockedAllergens') { if (P[k].some(a => !v.includes(a))) loosens = true;
        lines.push(`blocked allergens to ${v.join(', ') || 'none'}`); }
      else if (k === 'approvedContacts') { if (v.some(a => !P[k].includes(a))) loosens = true;
        lines.push(`approved contacts to ${v.join(', ') || 'nobody'}`); }
      else throw new Error('unknown setting: ' + k);
    }
    const id = crypto.randomBytes(8).toString('hex');
    this.pending.set(id, { amendment: changes, loosens });
    const extra = loosens ? ' This makes your rules less strict. Say "yes, change it" to confirm.' : ' Should I change it?';
    return { status: 'confirm', pendingId: id, say: `I'll change your ${lines.join(' and ')}.${extra}` };
  }
  confirmAmendment(pendingId, { said, speaker, source }) {
    const p = this.pending.get(pendingId);
    if (!p || !p.amendment) return { status: 'expired' };
    this.pending.delete(pendingId);
    const s = norm(said);
    const ok = source === 'user-utterance' && !NEGATION.test(s) && (p.loosens ? YES_LOOSEN.test(s) : YES_PLAIN.test(s));
    if (!ok) return { status: 'declined' };
    const old = this.constitution;
    const params = { ...old.params, ...p.amendment };
    params.blockedAllergens = expandAllergens(params.blockedAllergens);
    params.approvedContacts = [...params.approvedContacts].map(norm).sort();
    const body = { version: old.version + 1, starter: old.starter, params, prevHash: old.hash };
    const next = Object.freeze({ ...body, hash: hashOf(body) });
    this.adopt(next);
    const r = this.log.append({ type: 'amendment', decision: 'applied', approver: speaker, changes: p.amendment,
      fromVersion: old.version, constitutionVersion: next.version, constitutionHash: next.hash, prevHash: old.hash });
    return { status: 'applied', version: next.version, receipt: r.seq };
  }
}

class Executor {
  constructor({ key, vendor, log, now = Date.now }) { this.key = key; this.vendor = vendor; this.log = log; this.now = now; this.used = new Set(); }
  execute(payload, token) {
    const contract = toContract(payload), contractHash = hashOf(contract);
    const why = (() => {
      if (!token) return 'no approval';
      const msg = `${token.contractHash}|${token.constitutionHash}|${token.nonce}|${token.exp}`;
      const mac = crypto.createHmac('sha256', this.key).update(msg).digest('hex');
      if (typeof token.mac !== "string" || token.mac.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(token.mac))) return "approval forged";
      if (this.used.has(token.nonce)) return 'approval already used';
      if (this.now() > token.exp) return 'approval expired';
      if (contractHash !== token.contractHash) return 'action changed after approval';
      return null;
    })();
    if (why) {
      this.log.append({ type: 'execution', decision: 'blocked', why, contract, contractHash });
      return { status: 'blocked', why };
    }
    this.used.add(token.nonce);
    const result = this.vendor(contract);
    this.log.append({ type: 'execution', decision: 'executed', contract, contractHash, result });
    return { status: 'executed', result };
  }
}

module.exports = { Gate, Executor, TOKEN_TTL_MS, GUEST_DEFAULT_MS, guestText };
