'use strict';
// MCP Streamable HTTP server (spec 2025-11-25) wrapping the gate.
// Capability model: the assistant can only ACT through these tools, and the
// server executes itself — the assistant never holds an approval or vendor creds.
// There is NO tool the assistant can call to say yes. An ask-first action is put to
// the person through the host's own prompt (MCP elicitation); if the host cannot ask,
// it goes to the decision-maker (owner-only HTTP route, stand-in for their phone),
// which no MCP tool can reach. Loosening a promise always goes to the decision-maker.
const path = require('node:path'), fs = require('node:fs'), crypto = require('node:crypto');
const express = require('express');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { isInitializeRequest } = require('@modelcontextprotocol/sdk/types.js');
const { z } = require('zod');
const { setupConstitution, SETUP_QUESTIONS, STARTERS, money, describe, verifyConstitution, parseSpokenMoney, parseSpokenList } = require('./core');
const OWNER_WAIT_MS = 30 * 60_000;
const { SandboxVendor } = require('./vendor');
const OWNER_PAGE = require('./owner-page');
const { Gate, Executor } = require('./gate');
const { ReceiptLog, tuningSuggestions } = require('./receipts');

function createHome({ dataDir, ownerKey, vendor = new SandboxVendor(), address = '12 Elm St', now = Date.now }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const log = new ReceiptLog(path.join(dataDir, 'receipts.jsonl'));
  const keyFile = path.join(dataDir, 'gate.key'), stateFile = path.join(dataDir, 'household.json');
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  const key = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
  vendor.address = address;
  const home = { log, vendor, sent: vendor.orders, gate: null, ownerKey, now, amendments: new Map(), heldActions: new Map(),
    exec: new Executor({ key, vendor: c => vendor.commit(c), log }) };
  const save = () => fs.writeFileSync(stateFile, JSON.stringify({
    address, current: home.gate.constitution.hash, versions: home.gate.versions,
    zones: [...home.gate.zones.entries()],
  }, null, 1));
  if (fs.existsSync(stateFile)) { // restart: reload, and refuse to run on a tampered or broken chain
    const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    for (const v of Object.values(st.versions)) if (!verifyConstitution(v)) throw new Error('household promises file was altered; refusing to start');
    const chk = log.verify(); if (!chk.ok) throw new Error('receipt log altered at entry ' + chk.at + '; refusing to start');
    home.gate = new Gate({ constitution: st.versions[st.current], versions: st.versions, log, key,
      zones: st.zones, onZone: () => save(), onAdopt: () => save() });
  }
  home.setup = (starter, answers) => {
    home.gate = new Gate({ constitution: setupConstitution(starter, answers), log, key, onZone: () => save(), onAdopt: () => save() });
    save();
  };
  home.checkout = (quoteId, fallback) => quoteId ? vendor.finalize(quoteId) : fallback;
  home.changed = done => done.why === 'action changed after approval'
    ? "I stopped before paying: the store changed the order after you said yes. Nothing was charged. Ask me again to hear the new details."
    : "I couldn't do that: " + done.why + '.';
  // Decide a held ask-first action; on yes, carry it out against what the store will charge NOW.
  home.approveHeld = (id, { approve, speaker }) => {
    const held = home.heldActions.get(id);
    if (!held) return { status: 'missing' };
    if (home.now() - held.at > OWNER_WAIT_MS) {
      home.heldActions.delete(id);
      home.gate.pending.delete(id);
      return { status: 'expired' };
    }
    const r = home.gate.confirm(id, { said: approve ? 'yes' : 'no', speaker, source: 'user-utterance' });
    if (r.status === 'held') return { status: 'held', say: r.say };
    home.heldActions.delete(id);
    if (r.status !== 'approved') return { status: r.status };
    const done = home.exec.execute(home.checkout(held.quoteId, held.contract), r.token);
    return done.status === 'executed' ? { status: 'executed', say: "Done. Here's what I did: " + describe(held.contract) + '.' }
      : { status: 'blocked', say: home.changed(done) };
  };
  return home;
}

function promisesText(c) {
  const p = c.params, out = [
    `I'll always ask before spending more than ${money(p.spendConfirmCents)}.`,
    `I'll tell you afterwards about anything over ${money(p.notifyCents)}.`,
    `I'll ask before swapping anything you asked for.`,
  ];
  if (p.blockedAllergens.length) out.push(`I'll never bring ${p.blockedAllergens.join(' or ')} into your home.`);
  out.push(p.approvedContacts.length ? `I'll only message ${p.approvedContacts.join(', ')} without asking.` : `I'll ask before messaging anyone.`);
  return out.join(' ');
}

function buildMcp(home) {
  const s = new McpServer({ name: 'household-promises', version: '0.2.0' });
  const text = t => ({ content: [{ type: 'text', text: t }] });
  const needSetup = () => text("Let's set up your home first. Is it a family, just you, or roommates?");

  s.registerTool('start_setup', { description: 'Begin home setup. Returns the first question to ask the household.',
    annotations: { readOnlyHint: true } }, async () =>
    text(`Is this home a family, just you, or roommates? Then: ${SETUP_QUESTIONS.map(q => q.ask).join(' ')} Any answer can be skipped and changed later.`));

  s.registerTool('finish_setup', { description: 'Save the home setup from the spoken answers. Amounts and names as spoken.',
    inputSchema: { home_type: z.enum(Object.keys(STARTERS)), ask_first_amount: z.string().optional(),
      tell_after_amount: z.string().optional(), allergies: z.string().optional(), trusted_contacts: z.string().optional() } },
  async a => {
    if (home.gate) return text('Your home is already set up. You can change any promise just by asking.');
    const answers = { spendConfirmCents: a.ask_first_amount, notifyCents: a.tell_after_amount,
      blockedAllergens: a.allergies, approvedContacts: a.trusted_contacts };
    const draft = setupConstitution(a.home_type, answers); // validates; nothing saved yet
    // The household hears the promises read back and says yes; the assistant cannot set them up alone.
    if (!s.server.getClientCapabilities()?.elicitation) {
      if (home.pendingSetup && home.now() - home.pendingSetup.at <= OWNER_WAIT_MS)
        return text("Your home setup is already waiting for the person who runs your home to okay.");
      home.pendingSetup = { starter: a.home_type, answers, at: home.now() };
      return text("I've sent your home setup to the person who runs your home to okay.");
    }
    let answer;
    try {
      answer = await s.server.elicitInput({ message: `Here's what I'll promise your home. ${promisesText(draft)} Shall I keep these promises?`,
        requestedSchema: { type: 'object', properties: { go_ahead: { type: 'boolean', title: 'Keep these promises?' } }, required: ['go_ahead'] } });
    } catch { return text("I couldn't ask just now, so nothing was set up."); }
    if (!(answer.action === 'accept' && answer.content?.go_ahead === true)) return text("Okay, nothing is set up yet. We can try again whenever you like.");
    if (home.gate) return text('Your home is already set up. You can change any promise just by asking.');
    home.setup(a.home_type, answers);
    return text(`All set. ${promisesText(home.gate.constitution)} You can change any of this just by asking.`);
  });

  s.registerTool('read_promises', { description: 'Say back what the assistant has promised this home.',
    annotations: { readOnlyHint: true } }, async () => home.gate ? text(promisesText(home.gate.constitution)) : needSetup());

  s.registerTool('place_order', { description: 'Order something for the home. Say the item as the person said it and how many. The store sets the price.',
    inputSchema: { item: z.string(), quantity: z.number().int().min(1).max(50).default(1) }, annotations: { destructiveHint: true } },
  async a => {
    if (!home.gate) return needSetup();
    const q = home.vendor.quote(a.item, a.quantity);
    if (!q) return text("I couldn't find " + a.item + ' at the store.');
    if (q.ambiguous) return text('Which one? I will not guess from "' + a.item + '".');
    return decide(q.line, q.quoteId);
  });

  s.registerTool('send_message', { description: 'Send a message for the household.',
    inputSchema: { to: z.string(), body: z.string() }, annotations: { destructiveHint: true } },
  async a => home.gate ? decide({ kind: 'message', to: a.to, body: a.body }) : needSetup());

  async function decide(p, quoteId) {
    const r = home.gate.propose(p);
    if (r.status === 'held' || r.status === 'refused') return text(r.say);
    if (r.status === 'confirm') {
      const held = home.gate.pending.get(r.pendingId);
      home.heldActions.set(r.pendingId, { contract: held.contract, why: held.why, quoteId, at: home.now() });
      const ownerOnly = held.contract.kind === 'order'
        && held.contract.totalCents > 2 * home.gate.constitution.params.spendConfirmCents;
      if (ownerOnly || !s.server.getClientCapabilities()?.elicitation)
        return text("I've sent that to the person who runs your home to okay. Nothing happens until they do.");
      let answer;
      try {
        answer = await s.server.elicitInput({ message: r.say, requestedSchema: { type: 'object',
          properties: { go_ahead: { type: 'boolean', title: 'Go ahead?' } }, required: ['go_ahead'] } });
      } catch { return text("I couldn't ask just now, so I didn't do it. I've sent it to the person who runs your home instead."); }
      const yes = answer.action === 'accept' && answer.content?.go_ahead === true;
      const out = home.approveHeld(r.pendingId, { approve: yes, speaker: 'household (asked on the device)' });
      return text(out.say || "Okay, I won't.");
    }
    const done = home.exec.execute(home.checkout(quoteId, p), r.token);
    if (done.status !== 'executed') return text(home.changed(done));
    return text(r.notify || 'Done.');
  }

  s.registerTool('change_promise', { description: 'Ask to change a promise. Stricter changes apply after a spoken yes; anything less strict goes to the person who runs the home for approval.',
    inputSchema: { ask_first_amount: z.string().optional(), tell_after_amount: z.string().optional(),
      allergies: z.string().optional(), trusted_contacts: z.string().optional() } },
  async a => {
    if (!home.gate) return needSetup();
    const ch = {};
    if (a.ask_first_amount) ch.spendConfirmCents = parseSpokenMoney(a.ask_first_amount);
    if (a.tell_after_amount) ch.notifyCents = parseSpokenMoney(a.tell_after_amount);
    if (a.allergies !== undefined) ch.blockedAllergens = parseSpokenList(a.allergies);
    if (a.trusted_contacts !== undefined) ch.approvedContacts = parseSpokenList(a.trusted_contacts);
    const r = home.gate.proposeAmendment(ch, { source: 'user-utterance' });
    const pend = home.gate.pending.get(r.pendingId);
    if (!pend.loosens) { // stricter: safe to apply on the household's request
      home.gate.confirmAmendment(r.pendingId, { said: 'yes', speaker: 'household (asked on the device)', source: 'user-utterance' });
      return text(`Done. ${promisesText(home.gate.constitution)}`);
    }
    home.amendments.set(r.pendingId, { changes: ch, at: home.now() });
    return text("I've sent that to the person who runs your home to okay. Nothing changes until they do.");
  });

  s.registerTool('what_did_you_do', { description: "Say back recent actions and any suggestion from repeated yeses.",
    annotations: { readOnlyHint: true } }, async () => {
    const es = home.log.entries();
    const done = es.filter(e => e.type === 'execution' && e.decision === 'executed').slice(-5)
      .map(e => describe(e.contract).replace(/^order /, 'ordered ').replace(/^send /, 'sent '));
    const tips = tuningSuggestions(es).map(t => t.say);
    return text((done.length ? `Recently I: ${done.join('; ')}.` : "I haven't done anything yet.") + (tips.length ? ' ' + tips.join(' ') : ''));
  });
  return s;
}

function createApp(opts) {
  const home = createHome(opts);
  const app = express();
  app.use(express.json());
  const sessions = {};
  app.post('/mcp', async (req, res) => {
    const sid = req.get('mcp-session-id');
    let t = sid && sessions[sid];
    if (!t) {
      if (sid) return res.status(404).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Session not found' }, id: null });
      if (!isInitializeRequest(req.body)) {
        // Host didn't keep a session: serve this request statelessly. With no session the server
        // can't ask the person, so every ask-first action is held for the decision-maker.
        const st = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const srv = buildMcp(home);
        res.on('close', () => { st.close(); srv.close(); });
        await srv.connect(st);
        return st.handleRequest(req, res, req.body);
      }
      t = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(), onsessioninitialized: id => { sessions[id] = t; } });
      t.onclose = () => { if (t.sessionId) delete sessions[t.sessionId]; };
      await buildMcp(home).connect(t);
    }
    await t.handleRequest(req, res, req.body);
  });
  const bySession = async (req, res) => {
    const t = sessions[req.get('mcp-session-id')];
    if (!t) return res.status(404).end();
    await t.handleRequest(req, res);
  };
  app.get('/mcp', bySession);
  app.delete('/mcp', bySession);

  // Owner-only routes: stand-in for the decision-maker's phone. Not MCP tools.
  // Wrong codes are throttled: after 5 misses in 15 minutes, the owner routes refuse for 15 minutes.
  let misses = [];
  const owner = (req, res) => {
    misses = misses.filter(t => home.now() - t < 15 * 60_000);
    if (misses.length >= 5) { res.status(429).end(); return false; }
    const k = String(req.get('x-owner-key') || '');
    const ok = k.length === home.ownerKey.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(home.ownerKey));
    if (!ok) { misses.push(home.now()); res.status(401).end(); }
    return ok;
  };
  app.get('/owner', (req, res) => res.set({ 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" })
    .type('html').send(OWNER_PAGE));
  const fresh = at => home.now() - at <= OWNER_WAIT_MS;
  const sayChanges = ch => Object.entries(ch).map(([k, v]) =>
    k === 'spendConfirmCents' ? `ask before spending more than ${money(v)}`
    : k === 'notifyCents' ? `tell you afterwards about anything over ${money(v)}`
    : k === 'blockedAllergens' ? (v.length ? `never bring ${v.join(' or ')} into your home` : `no foods are kept out of your home`)
    : `message ${v.length ? v.join(', ') : 'nobody'} without asking`).join('; ');
  app.get('/owner/pending', (req, res) => {
    if (!owner(req, res)) return;
    const ps = home.pendingSetup && fresh(home.pendingSetup.at) ? home.pendingSetup : null;
    res.set('Cache-Control', 'no-store').json({
      setup: ps ? { say: promisesText(setupConstitution(ps.starter, ps.answers)) } : null,
      changes: [...home.amendments.entries()].filter(([, a]) => fresh(a.at)).map(([id, a]) => ({ id, say: sayChanges(a.changes), changes: a.changes })),
      actions: [...home.heldActions.entries()].filter(([, h]) => fresh(h.at)).map(([id, h]) => ({ id, what: describe(h.contract), why: h.why || [] })),
    });
  });
  app.post('/owner/approve-setup', (req, res) => {
    if (!owner(req, res)) return;
    const p = home.pendingSetup;
    if (!p || home.gate) return res.status(404).end();
    home.pendingSetup = null;
    if (home.now() - p.at > OWNER_WAIT_MS) return res.json({ status: 'expired' });
    home.setup(p.starter, p.answers);
    res.json({ status: 'applied', promises: promisesText(home.gate.constitution) });
  });
  app.post('/owner/decline-setup', (req, res) => {
    if (!owner(req, res)) return;
    if (!home.pendingSetup) return res.status(404).end();
    home.pendingSetup = null;
    res.json({ status: 'declined' });
  });
  app.post('/owner/approve/:id', (req, res) => {
    if (!owner(req, res)) return;
    const id = req.params.id;
    if (home.heldActions.has(id)) return res.json(home.approveHeld(id, { approve: true, speaker: 'decision-maker (phone)' }));
    const a = home.amendments.get(id);
    if (!a) return res.status(404).end();
    home.amendments.delete(id);
    if (home.now() - a.at > OWNER_WAIT_MS) { home.gate.pending.delete(id); return res.json({ status: 'expired' }); }
    const r = home.gate.confirmAmendment(id, { said: 'yes, change it', speaker: 'decision-maker (phone)', source: 'user-utterance' });
    res.json({ ...r, promises: promisesText(home.gate.constitution) });
  });
  // Venue quiet-zone signal (Portable Constitution prototype). NOT an MCP tool:
  // the assistant cannot call it. In production the venue would hold its own
  // credential; tonight the owner key is the stand-in.
  app.post('/venue/zone', (req, res) => {
    const k = String(req.get('x-owner-key') || '');
    const ok = k.length === home.ownerKey.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(home.ownerKey));
    if (!ok) return res.status(401).end();
    if (!home.gate) return res.status(404).end();
    const { name, active } = req.body || {};
    res.json(home.gate.zoneEvent({ name, active: !!active, source: 'venue-signal' }));
  });
  app.post('/owner/decline/:id', (req, res) => {
    if (!owner(req, res)) return;
    const id = req.params.id;
    if (home.heldActions.has(id)) return res.json(home.approveHeld(id, { approve: false, speaker: 'decision-maker (phone)' }));
    if (!home.amendments.delete(id)) return res.status(404).end();
    home.gate.pending.delete(id);
    res.json({ status: 'declined' });
  });
  return { app, home };
}

if (require.main === module) {
  const ownerKey = process.env.OWNER_KEY || crypto.randomBytes(16).toString('hex');
  const { app } = createApp({ dataDir: path.join(__dirname, '..', 'data'), ownerKey });
  const port = Number(process.env.PORT || 3000);
  app.listen(port, '127.0.0.1', () => console.log(`household-promises MCP on http://127.0.0.1:${port}/mcp (owner key ${process.env.OWNER_KEY ? 'from env' : 'generated: ' + ownerKey})`));
}
module.exports = { createApp, promisesText };
