# Portable Constitution — Specification

**Date:** 2026-10-18
**Status:** SPEC ONLY — specification, no implementation. Nothing described
here is built by virtue of being written here.
**Base:** `master` @ `da4c08a` (Household Promises build; suite 57/57).
**Grounding:** `README.md`, `REDTEAM.md`, `src/core.js`, `src/gate.js`,
`src/receipts.js`, `src/server.js`, `test/canary.test.js`. Where this spec
and the code disagree, the code wins and this document is the bug (the
`REDTEAM.md` method note, applied to this file).

## 1. What "portable" means

The Household Constitution today runs as one MCP server in front of one
simulated Alexa+ host. The Portable Constitution is the same constitution
as a **platform-independent artifact**: a versioned bundle that any host
platform can carry without its meaning changing.

The bundle is exactly four things:

1. **Rules** — the constitution object: parameters, version chain, hash
   (§3).
2. **Promises** — the plain-language rendering of those rules, derived
   mechanically from them (§3.3).
3. **Amendment log** — the version chain plus the amendment receipts that
   produced it (§3.4).
4. **Enforcement interface** — the contract in §4 that a host's
   enforcement layer must satisfy for the bundle to mean anything on that
   host.

Portability is a property of the bundle and the enforcement contract, not
of wording. The same bundle, byte-identical under its hash, evaluated by
the same deterministic semantics, must produce the same decision on every
host. Hosts differ only in their adapters (§6).

Portability is **not**:

- **Prompt portability.** The constitution is never a system prompt or any
  other text the assistant can read, reinterpret, or talk around. If a
  host's only way to "apply" the rules is to tell the model about them,
  that host is advisory (§7, Level 0), not portable.
- **Model portability.** The bundle does not depend on which assistant,
  model, or vendor sits behind the adapter.
- **Feature portability.** Action kinds, vendors, and confirmation
  surfaces are host concerns. The rules, tiers, receipts, and amendment
  mechanics are not.

The four laws the bundle carries, stated as invariants:

- **L1 — Enforcement lives outside the agent.** Decisions are made by
  deterministic code the agent cannot invoke, inspect for loopholes, or
  argue with. The agent proposes; the gate decides; the executor acts.
- **L2 — Amendments are versioned and decision-maker-only.** Every change
  produces a new version linked to its predecessor. Loosening a rule
  requires the decision-maker and a stronger confirmation than tightening
  one. The agent can never amend.
- **L3 — Promises are plain language.** What the household hears is
  generated from the rules in words a family member understands — no rule
  codes, hashes, or trace terms. The spoken promise is a view of the
  rules, never the source of truth.
- **L4 — Friction is tiered.** Low-stakes actions flow silently,
  mid-stakes actions are reported afterwards, high-stakes actions stop
  and ask first, and "never" items are refused outright. Friction rises
  with stakes, never uniformly.

## 2. Vocabulary

- **Household** — the people the constitution serves.
- **Decision-maker** — the person who runs the home (the README's "person
  who runs the home"). The only authority that can approve owner-class
  actions, loosen a promise, or confirm first-run setup.
- **Agent** — the assistant (any model, any vendor) proposing actions.
- **Gate** — the deterministic decision component. **Executor** — the
  component that carries out an approved action and holds the vendor
  credentials. Together: the **enforcement layer**.
- **Host** — the platform the agent runs on (Alexa+, a chat/agent
  runtime, a non-MCP channel). **Adapter** — the host-specific code that
  connects the enforcement layer to that host.
- **Contract** — the exact, normalized description of an action that
  will execute. What is approved is a contract hash; what executes is
  re-derived from the actual payload and must hash identically.
- **Receipt** — one entry in the append-only, hash-chained log (§3.5).
- **Quiet Zone** — a named state in which every gated action is held
  until the zone lifts (§3.6).

## 3. Data model

### 3.1 Constitution

A constitution is a frozen object:

```
{ version: <int, starts at 1>,
  starter: <string>,
  params: { spendConfirmCents: <int cents>,
            notifyCents: <int cents>,
            blockedAllergens: [<canonical string>...],
            approvedContacts: [<normalized string>...] },
  prevHash: <sha256 hex | null>,
  hash: <sha256 hex> }
```

- `hash` is SHA-256 over a canonical serialization of the body (sorted
  keys, undefined dropped). Money is integer cents everywhere; a
  non-integer number in a contract or constitution is an error, never a
  rounding opportunity.
- `prevHash` links each version to its predecessor, forming the
  amendment chain. The full chain is retained; the current version is
  the unique head (no other version is unreferenced as a predecessor).
- Verification (`verifyConstitution`): recomputing the hash from the body
  must reproduce `hash`. A constitution that does not verify is not
  loaded — startup refuses (§4, E5).
- Starters are named parameter presets (`family`, `solo`, `roommates` in
  the current build). Spoken setup adjusts a starter through at most
  four questions, each skippable, each with the starter value as default.

### 3.2 Actions and contracts

An action proposal is normalized into a contract before any decision.
Normalization is part of the spec: names and addresses are normalized
(trimmed, lowercased, whitespace-collapsed), allergen lists are expanded
through a synonym table into canonical forms, and malformed proposals
are refused before evaluation — an order with no allergen list or no
requested SKU produces no contract at all.

Action kinds in v1: `order` and `message`. An order contract carries
sku, name, allergens, quantity, unit price, total (quantity × unit
price), address, delivery date, and the sku originally requested. A
message contract carries recipient and body.

### 3.3 Tiers and evaluation

Evaluation is a pure, deterministic function:
`evaluate(contract, constitution, context) → { tier, reasons[] }`.
There is no LLM in the decision path, on any host, ever (L1).

| Tier | Name | Meaning |
|---|---|---|
| 0 | Silent | Execute; receipt only. |
| 1 | Notify | Execute; tell the household afterwards. |
| 2 | Confirm | Hold; a person must say yes first. |
| 3 | Refuse | Never execute; receipt the refusal. |

Rules raise the tier; the highest applicable tier wins, and every rule
that fired is recorded with a plain-language reason ("it costs $94.95,
over your $75.00 ask-first limit"). The v1 rule set:

- **Allergen:** the contract's allergens intersect the blocked list →
  Refuse. This rule is never suggested for loosening (§3.4).
- **Substitution:** the sku differs from the requested sku → Confirm.
- **Spend:** total over the ask-first limit → Confirm; otherwise, if
  unasked spend in the trailing 24 hours plus this total crosses the
  limit → Confirm (splitting an order does not dodge the ask);
  otherwise total over the notify limit → Notify.
- **Contacts:** a message to anyone not on the approved-contacts list →
  Confirm.

`context.recentCents` (the 24-hour unasked-spend total) is computed from
the receipt log at decision time, so it is itself auditable. Any future
context input must preserve cross-host replay equality (§5) or be
declared host-specific and excluded from the portable decision record.

### 3.4 Promises and amendments

- The promise text is generated from `params` by a fixed template ("I'll
  always ask before spending more than $75.00. … I'll never bring
  peanuts or tree nuts into your home."). It is regenerated, never
  hand-edited. Wording invariance is a tested property: the same promise
  spoken differently at setup ("seventy five dollars", "$75", "75
  dollars") yields identical params, an identical hash, and identical
  decisions.
- An amendment is a parameter change proposed from a person's utterance,
  read back in plain language, and confirmed. Tightening applies on a
  plain spoken yes. **Loosening requires the decision-maker channel and
  the exact confirmation phrase** ("yes, change it" in the current
  build); a plain yes, a hedged yes, or anything from the agent is
  declined.
- Applying an amendment mints version *n+1* with `prevHash` set to
  version *n*'s hash, and appends an amendment receipt naming the
  approver, the changes, and both versions.
- A pending action is re-evaluated against the constitution as it stands
  at approval time: an action held, then made a "never" item by a
  stricter amendment, is refused at approval. Stale approvals die.
- The system may *suggest* loosening a rule that repeatedly earns a yes
  (tuning suggestions, threshold 5 in the current build). Suggestions
  are never applied automatically, and the allergen rule is never
  suggested.

### 3.5 Receipts

Every decision and event is an entry in an append-only log, hash-chained
by predecessor hash, canonically serialized:

- Entry types in v1: `decision`, `execution`, `amendment`, `zone`.
- A decision entry records: sequence number, timestamp, constitution
  version and hash, the contract and its hash, tier, rules fired,
  decision (allowed / refused / declined / held), approval class (auto /
  yes / no / null), and the approver label.
- An execution entry records the contract, its hash, and either the
  result or the block reason ("no approval", "approval forged",
  "approval already used", "approval expired", "action changed after
  approval").
- **Replay:** re-evaluating a recorded contract against the recorded
  constitution version, with the recorded context, must reproduce the
  recorded tier. A host that cannot replay its own log has a log, not
  receipts.
- **Integrity, stated honestly:** the chain is tamper-evident, not
  tamper-proof. `REDTEAM.md` records the accepted risk: the chain is
  unkeyed and the promises-file seal key currently lives in the same
  data directory, so a disk-level attacker can forge both. Any portable
  deployment must declare its anchor status (§5, §7) instead of
  inheriting the claim silently.

### 3.6 Quiet Zones

A
...[truncated 12553 chars]