# REDTEAM.md — Red-team assessment of Household Promises

Assessment of this project's own security design, written against master
`e541fff` (PR #3 merged; suite 57/57). Every claim below is grounded in the
code in `src/` and the tests in `test/` as they exist at that commit. Where
a defense is claimed, the test that proves it is named. Where a weakness is
claimed, the mechanism is described so it can be re-checked by reading the
code, not by trusting this document.

Scope: the receipt chain and its anchoring (`src/receipts.js`), the
promises-file seal (`src/server.js`), the gate and approval tokens
(`src/gate.js`), Quiet Zones (`src/gate.js`, `src/server.js`), and the
canary set (`test/canary.test.js`).

## Threat model the design actually defends

The attacker this system is built against is **the assistant itself**: a
persuasive language model with tool access that might try to talk, trick,
or maneuver its way past the household's rules — plus accidents and
confusion on the household channel (a child at the device, a host that
auto-answers prompts, a store that changes a price after approval). The
decision path contains no LLM (`src/core.js` is deterministic), the
assistant holds neither the gate key nor vendor credentials, and there is
no MCP tool that means "yes."

The design does **not** claim to defend against an attacker who already
has read/write access to the server's `data/` directory. That boundary is
the host filesystem, and the one place it matters is documented as an
accepted risk below — not as an open bug.

## What holds (attacks tried, holes closed)

`test/redteam.test.js` (RT-01…RT-21) is the attack log. Its header records
that every case failed against master `d895aa1` — they were real holes.
They were closed in PR #1 ("Close the red-team holes in household
promises") and PR #2 (over-limit spend held for the owner key), and the
canary set (`test/canary.test.js`) pins the product's spoken promises so a
future change cannot quietly reopen them. Verified holding at `e541fff`:

- **The assistant cannot approve anything.** `Gate.confirm` rejects any
  source other than `user-utterance`; over the ask-first limit, a device
  prompt yes is never enough — the action is held for the owner route
  (RT-08, RT-08a, canary 2). Wrong owner proof gets a 401 and nothing
  executes (RT-08c); the correct proof executes and the receipt names the
  decision-maker (RT-08b).
- **What executes is what was approved.** The Executor recomputes the
  contract hash from the actual payload and blocks on any difference
  ("action changed after approval"); checkout re-reads the store's
  current line after the yes (canary 4). Approval tokens are HMAC-bound
  to contract + constitution hash, single-use, and expire in 60 seconds
  (`TOKEN_TTL_MS`, `src/gate.js`).
- **Quiet Zones hold everything.** While any zone is active, proposals
  and even already-approved confirmations are held and receipted
  (`Gate.propose`, `Gate.confirm`). A venue-set zone cannot be lifted
  from inside the home, the attempt is receipted, and zones survive a
  restart (RT-01, RT-02, RT-03, `test/zones.test.js`).
- **Stale approvals die.** Confirm re-evaluates against the constitution
  as it stands at approval time: an order held, then made a "never" item
  by a stricter amendment, is refused at approval (RT-04).
- **Splitting doesn't dodge the ask.** Unasked spend in the last 24h is
  totaled from the receipt log at decision time and counts toward the
  ask-first limit — including the negative-quantity "refund" trick
  (canary 3, RT-14). The core refuses malformed orders outright: no
  allergen list or no requested SKU, no contract (RT-15, RT-15b).
- **Amendment friction is asymmetric.** Loosening requires the owner
  route and the exact spoken phrase "yes, change it"; a plain yes, a
  hedged yes ("yes… wait, no, cancel"), or anything from the assistant is
  declined (canary 5, RT-10). Suggested loosenings from repeated yeses
  (`tuningSuggestions`) are never applied automatically and never include
  the allergen rule.
- **The surface is small and fails closed.** `/mcp` answers only
  loopback Host/Origin (RT-11); malformed input leaks no stack trace
  (RT-13); hostile session ids are 404s (RT-21); the owner key is
  compared in constant time, throttled after 5 misses, and provably
  absent from logs, receipts, and the household file (RT-08d); a broken
  receipt chain or an altered promises file refuses startup
  (`createHome` in `src/server.js`).

## ACCEPTED RISK — log-anchor and file-seal forgeability

**Status: accepted and documented (project ruling, Oct 18, 2026). This is
a named, understood limitation — not an open bug and not a TODO.**

Two integrity mechanisms protect the record of what happened, and both
are forgeable by the same attacker: one who can write the `data/`
directory.

1. **The receipt chain has no external anchor.** Each entry's hash is an
   unkeyed SHA-256 over a canonical serialization (`canon`/`sha`,
   `src/core.js`), chained by `prev`. `ReceiptLog.verify()` catches any
   edit that does not recompute the chain — the canary test proves a
   single altered entry is detected. But an attacker with write access
   to `receipts.jsonl` can rewrite the whole file and recompute every
   hash, and `verify()` returns ok. Deleting trailing entries is equally
   invisible: a shorter chain is still internally consistent, and
   nothing outside the file pins the expected head hash or entry count.
   There is no anchor — no head hash is signed, published, or stored
   anywhere the file's writer cannot also reach.
2. **The promises-file seal's key lives with the file it seals.**
   `household.json` carries an HMAC per constitution version
   (`macOf`, `src/server.js`), and RT-18 proves a forgery that only
   rehashes the unkeyed constitution hash is stopped cold. But the key
   that produces those seals is `data/gate.key`, in the same directory
   as `household.json` and `receipts.jsonl` (mode 0600). An attacker who
   can read that directory holds the key: they can seal a forged
   constitution (any limits, no blocked allergens), rewrite the receipt
   log to match — including the last-applied-amendment cross-check in
   `promisesIntact()` — and the server starts on the forged state.

**Why this is accepted.** The system's promise is that the *assistant*
cannot rewrite history or loosen the rules — and against the assistant
these mechanisms are sound, because the assistant has no filesystem
access at all: it reaches the world only through the MCP tools. Against
a disk-level attacker, file permissions on the host are the real
boundary, and pretending a same-directory hash chain or seal defeats
that attacker would be a false claim. The README and demo script already
say this out loud: the log is "tamper-evident, not tamper-proof."

**What would change the calculus** (future work, not a defect): anchoring
the chain head somewhere the server cannot rewrite — a signed head hash
held on the decision-maker's phone, or a periodic external witness — and
moving the gate key out of the data directory. Either is worth doing
before this runs anywhere the host itself is not trusted.

## Other residual risks (observed, lower severity)

- **"Venue" authority is the owner key wearing a venue hat.** In this
  build `/venue/zone` authenticates with the same `x-owner-key` as the
  owner routes; the code comments say so plainly ("In production the
  venue would hold its own credential; tonight the owner key is the
  stand-in"). Whoever holds the owner key can therefore set or lift a
  "venue" zone, bypassing the rule that the household cannot lift one.
  Acceptable for a prototype demo; must be a separate credential before
  any real venue integration.
- **Speaker attribution is a channel label, not an identity.** Receipts
  record `approver` strings supplied by the calling layer ("household
  (asked on the device)", "decision-maker (phone)"). The gate verifies
  the *channel* (`source`), never who actually spoke. Anyone who can
  answer the household device's prompt can approve device-class asks
  (substitutions, messages). Owner-class actions stay behind the owner
  key. This matches the stated household trust model; it is recorded
  here so the receipts are never oversold as proof of *who* said yes.
- **Single-use nonces are memory-only.** `Executor.used` is an
  in-process set. A server restart forgets spent nonces; a token replayed
  after a restart is stopped only by its 60-second expiry. The window is
  small and bounded by `TOKEN_TTL_MS`, and a restarted Executor also
  loses all pending approvals (fail-safe direction), but the nonce store
  should be persisted if token lifetimes ever grow.
- **The allergen promise is only as true as the store's tags.** The
  gate refuses any order whose allergen list intersects the blocked list
  after synonym expansion (`ALLERGEN_CANON`, `src/core.js`), and the
  core rejects orders with no allergen list at all. It cannot detect a
  product the store failed to tag. Tagging completeness belongs to the
  vendor by design — the assistant never supplies allergens — but the
  "never" promise inherits the catalog's accuracy.
- **Owner-key strength and lockout are the operator's problem.** The
  server accepts any `OWNER_KEY` (the README quickstart's demo code is
  deliberately weak) and 5 bad guesses lock the owner routes for 15
  minutes — including for the real owner (the venue route is
  deliberately unthrottled, RT-12). On a loopback-only server this is a
  local nuisance, not a remote hole; it becomes a real decision the
  moment the server is reachable beyond the host.

## Method note

Findings here come from reading the code at `e541fff` and running the
suite, not from the earlier red-team session's report (which claimed a
`REDTEAM.md` that never landed — see `~/workspace/your_files/
burn-ledger-2026-10-17.md`). If a claim in this document and the code
ever disagree, the code wins and this document is the bug.
