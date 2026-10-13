'use strict';
// MCP Streamable HTTP server (spec 2025-11-25) wrapping the gate.
// Capability model: the assistant can only ACT through these tools, and the
// server executes itself — the assistant never holds an approval or vendor creds.
// Loosening changes are approved on an owner-only HTTP route (stand-in for the
// decision-maker's phone), which no MCP tool can reach.
const path = require('node:path'), fs = require('node:fs'), crypto = require('node:crypto');
const express = require('express');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const { setupConstitution, SETUP_QUESTIONS, STARTERS, money, describe, verifyConstitution } = require('./core');
const { SandboxVendor } = require('./vendor');
const { Gate, Executor } = require('./gate');
const { ReceiptLog, tuningSuggestions } = require('./receipts');

function createHome({ dataDir, ownerKey, vendor = new SandboxVendor(), address = '12 Elm St' }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const log = new ReceiptLog(path.join(dataDir, 'receipts.jsonl'));
  const keyFile = path.join(dataDir, 'gate.key'), stateFile = path.join(dataDir, 'household.json');
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  const key = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
  vendor.address = address;
  const home = { log, vendor, sent: vendor.orders, gate: null, ownerKey, amendments: new Map(), quotes: new Map(),
    exec: new Executor({ key, vendor: c => vendor.commit(c), log }) };
  const save = () => fs.writeFileSync(stateFile, JSON.stringify({ address, current: home.gate.constitution.hash, versions: home.gate.versions }, null, 1));
  if (fs.existsSync(stateFile)) { // restart: reload, and refuse to run on a tampered or broken chain
    const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    for (const v of Object.values(st.versions)) if (!verifyConstitution(v)) throw new Error('household promises file was altered; refusing to start');
    const chk = log.verify(); if (!chk.ok) throw new Error('receipt log altered at entry ' + chk.at + '; refusing to start');
    home.gate = new Gate({ constitution: st.versions[st.current], versions: st.versions, log, key, onAdopt: () => save() });
  }
  home.setup = (starter, answers) => {
    home.gate = new Gate({ constitution: setupConstitution(starter, answers), log, key, onAdopt: () => save() });
    save();
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
  const s = new McpServer({ name: 'household-promises', version: '0.1.0' });
  const text = t => ({ content: [{ type: 'text', text: t }] });
  const needSetup = () => text("Let's set up your home first. Is it a family, just you, or roommates?");
  const run = (contract, token) => home.exec.execute(contract, token);

  s.registerTool('start_setup', { description: 'Begin home setup. Returns the first question to ask the household.',
    annotations: { readOnlyHint: true } }, async () =>
    text(`Is this home a family, just you, or roommates? Then: ${SETUP_QUESTIONS.map(q => q.ask).join(' ')} Any answer can be skipped and changed later.`));

  s.registerTool('finish_setup', { description: 'Save the home setup from the spoken answers. Amounts and names as spoken.',
    inputSchema: { home_type: z.enum(Object.keys(STARTERS)), ask_first_amount: z.string().optional(),
      tell_after_amount: z.string().optional(), allergies: z.string().optional(), trusted_contacts: z.string().optional() } },
  async a => {
    home.setup(a.home_type, { spendConfirmCents: a.ask_first_amount, notifyCents: a.tell_after_amount,
      blockedAllergens: a.allergies, approvedContacts: a.trusted_contacts });
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
    return decide(q.line, q.quoteId);
  });

  s.registerTool('send_message', { description: 'Send a message for the household.',
    inputSchema: { to: z.string(), body: z.string() }, annotations: { destructiveHint: true } },
  async a => home.gate ? decide({ kind: 'message', to: a.to, body: a.body }) : needSetup());

  function checkout(quoteId, fallback) { return quoteId ? home.vendor.finalize(quoteId) : fallback; }
  function decide(p, quoteId) {
    const r = home.gate.propose(p);
    if (r.status === 'refused') return text(r.say);
    if (r.status === 'confirm') { if (quoteId) home.quotes.set(r.pendingId, quoteId);
      return text(r.say + ' (ask the person; pass their exact words to confirm_action with id ' + r.pendingId + ')'); }
    const done = run(checkout(quoteId, p), r.token);
    if (done.status !== 'executed') return text(changed(done));
    return text(r.notify || 'Done.');
  }
  function changed(done) {
    return done.why === 'action changed after approval'
      ? "I stopped before paying: the store changed the order after you said yes. Nothing was charged. Ask me again to hear the new details."
      : "I couldn't do that: " + done.why + '.';
  }

  s.registerTool('confirm_action', { description: "Pass the person's exact spoken answer to a pending question.",
    inputSchema: { id: z.string(), their_words: z.string() }, annotations: { destructiveHint: true } },
  async a => {
    const pend = home.gate && home.gate.pending.get(a.id);
    if (!pend || !pend.contract) return text('That request has expired. Ask me again.');
    const contract = pend.contract;
    // Spoken yes relayed by the assistant: recorded as such in the receipt, never as a decision-maker approval.
    const r = home.gate.confirm(a.id, { said: a.their_words, speaker: 'household voice (relayed by assistant)', source: 'user-utterance' });
    if (r.status !== 'approved') return text("Okay, I won't.");
    const quoteId = home.quotes.get(a.id); home.quotes.delete(a.id);
    const done = run(checkout(quoteId, contract), r.token);
    return text(done.status === 'executed' ? "Done. Here's what I did: " + describe(contract) + '.' : changed(done));
  });

  s.registerTool('change_promise', { description: 'Ask to change a promise. Stricter changes apply after a spoken yes; anything less strict goes to the person who runs the home for approval.',
    inputSchema: { ask_first_amount: z.string().optional(), tell_after_amount: z.string().optional(),
      allergies: z.string().optional(), trusted_contacts: z.string().optional() } },
  async a => {
    if (!home.gate) return needSetup();
    const { parseSpokenMoney, parseSpokenList } = require('./core');
    const ch = {};
    if (a.ask_first_amount) ch.spendConfirmCents = parseSpokenMoney(a.ask_first_amount);
    if (a.tell_after_amount) ch.notifyCents = parseSpokenMoney(a.tell_after_amount);
    if (a.allergies !== undefined) ch.blockedAllergens = parseSpokenList(a.allergies);
    if (a.trusted_contacts !== undefined) ch.approvedContacts = parseSpokenList(a.trusted_contacts);
    const r = home.gate.proposeAmendment(ch, { source: 'user-utterance' });
    const pend = home.gate.pending.get(r.pendingId);
    if (!pend.loosens) { // stricter: safe to apply on the household's request
      home.gate.confirmAmendment(r.pendingId, { said: 'yes', speaker: 'household voice (relayed by assistant)', source: 'user-utterance' });
      return text(`Done. ${promisesText(home.gate.constitution)}`);
    }
    home.amendments.set(r.pendingId, ch);
    return text("I've sent that to the person who runs your home to okay. Nothing changes until they do.");
  });

  s.registerTool('what_did_you_do', { description: "Say back recent actions and any suggestion from repeated yeses.",
    annotations: { readOnlyHint: true } }, async () => {
    const es = home.log.entries();
    const done = es.filter(e => e.type === 'execution' && e.decision === 'executed').slice(-5)
      .map(e => require('./core').describe(e.contract));
    const tips = tuningSuggestions(es).map(t => t.say);
    return text((done.length ? `Recently I: ${done.join('; ')}.` : "I haven't done anything yet.") + (tips.length ? ' ' + tips.join(' ') : ''));
  });
  return s;
}

function createApp(opts) {
  const home = createHome(opts);
  const app = express();
  app.use(express.json());
  app.post('/mcp', async (req, res) => { // stateless: fresh server+transport per request, state lives in `home`
    const server = buildMcp(home);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.get('/mcp', (req, res) => res.status(405).end());
  // Owner-only route: stand-in for the decision-maker's phone. Not an MCP tool.
  app.get('/owner/pending', (req, res) => {
    if (req.get('x-owner-key') !== home.ownerKey) return res.status(401).end();
    res.json([...home.amendments.entries()].map(([id, changes]) => ({ id, changes })));
  });
  app.post('/owner/approve/:id', (req, res) => {
    if (req.get('x-owner-key') !== home.ownerKey) return res.status(401).end();
    if (!home.amendments.has(req.params.id)) return res.status(404).end();
    home.amendments.delete(req.params.id);
    const r = home.gate.confirmAmendment(req.params.id, { said: 'yes, change it', speaker: 'decision-maker (phone)', source: 'user-utterance' });
    res.json({ ...r, promises: promisesText(home.gate.constitution) });
  });
  return { app, home };
}

if (require.main === module) {
  const ownerKey = process.env.OWNER_KEY || crypto.randomBytes(16).toString('hex');
  const { app } = createApp({ dataDir: path.join(__dirname, '..', 'data'), ownerKey });
  const port = Number(process.env.PORT || 3000);
  app.listen(port, '127.0.0.1', () => console.log(`household-promises MCP on http://127.0.0.1:${port}/mcp (owner key ${process.env.OWNER_KEY ? 'from env' : 'generated: ' + ownerKey})`));
}
module.exports = { createApp };
