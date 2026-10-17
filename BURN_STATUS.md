# Burn status: 2026-10-16 night

Branch: `burn-2026-10-16` (branched from `master` @ `c15cfd8 seed`). Nothing was pushed or submitted.

## Done (with evidence)

| Item | Evidence |
|---|---|
| PLAN_AUDIT.md: five-mission audit | `PLAN_AUDIT.md`. It covers feasibility, missing prerequisites and ordering risks for M1–M5, plus a recommended order. |
| Simulated demo flow runs end to end | `npm test`: **19 pass, 0 fail**. `npm run demo`: **DEMO OK**, 10 scenes, each asserting. Sandbox orders placed: dish soap, 2× paper towels, 5× oat milk. Receipt chain intact. The flow already passed on the seed commit; tonight's changes kept it green. |
| Demo can be recorded at a watchable pace | `npm run demo:paced` (`DEMO_PACE_MS=1800`). The unpaced run and `demo/transcript.txt` content are unchanged apart from the delivery date. Commit `4db35c3`. |
| Phone page polish | Commit `8c1a1ba`. The page auto-refreshes every 3 s while visible. Held orders show *why* they're waiting ("Waiting because it costs $89.99, over your $75.00 ask-first limit."). Also: dark mode, 48 px tap targets, buttons disabled while a decision is in flight (no double-approve), stale result notes cleared when a new request arrives, a "forget the home code" link, and offline/lockout messages. |
| Phone page verified in a real browser | `demo/phone-check.js` drives Chromium at 390×844 during a live run. The page is opened once and **never reloaded**, so the air-fryer request appearing proves the auto-refresh. Result: `{"setUp":true,"airFryerOrdered":false,"orders":["1 × dish soap"],"chainOk":true}`. Screenshots in `demo/screens/` (light + dark). |
| New `why` field covered by a test | `test/mcp.test.js` asserts `actions[0].why` equals the gate's reason and contains no jargon. |
| Delivery date no longer in the past on camera | Sandbox default changed from `2026-10-15` to `2026-10-24` (`src/vendor.js`). |
| DEMO_VIDEO.md | 12-shot list with times (2:52 target), VO script, SRT captions, recording pre-flight, and a table tying each claim in the video to code or tests. Commit `fd9b5f6`. |

### Design-law compliance
- **No decision prompt was reworded.** `spokenPrompt`, `describe`, refusal text and the elicitation messages are byte-identical (the transcript diff is only the date). No schema version bump was needed.
- The phone page's new "Waiting because …" line reuses the gate's existing reason strings. It's an additive field on `/owner/pending`, not new decision wording.
- No confidence or score was introduced anywhere. Protection stays in the categorical gate (tier and choice), and the human answer stays a yes/no primitive.

## Partial

- **Demo video:** script, shot list and captions are drafted. **Recording, editing and upload need Darren.** The SRT timings follow the planned edit and must be re-timed to the real cut.
- **Video length cap (3:00)** is assumed, not confirmed against the official rules. Check before recording.

## Blocked (and why)

| Item | Why |
|---|---|
| **Pushing this branch** | No git remote is configured in this container and `GH_TOKEN` is invalid. **The commits exist only in this container.** Before the container is reclaimed, export them (e.g. `git bundle create burn.bundle master..burn-2026-10-16`) or re-run from a session with push access. Then push to `burn-2026-10-16`, never to main. |
| M2 (agent-action-auditor), M4 (job pipeline), M5 (MemoryRepo) | Repos not present in this session. M5 also needs a valid GitHub token. |
| M3 (Laya) | Laya is local-only and unreachable from any cloud session. See PLAN_AUDIT.md for what can be staged where. |
| Live Alexa+ verification of elicitation | Needs an Alexa developer account (README, friction log #3). |

## Found, not fixed (needs Darren's call)

- `docs/friction-log.md` #2 cites commit `ade5953`, and `docs/spike-spec-non-mcp-2026-10-13.md` cites `e19c39c`. Neither exists in this repo's history (one squashed `seed` commit). Judges following the links will hit dead references. Either restore the history or drop the hashes.
- `package.json` still has a blank `description` and `"main": "index.js"`, which doesn't exist. These are cosmetic and were left alone.

## Prompt-injection sightings

**None found.** I read all source, test, demo and doc files in full. A separate read-only sweep searched for AI-addressed directives, zero-width or bidi Unicode, hidden HTML comments and long base64 blobs across all 21 non-vendored files. The only matches were the product's own design comments about "the assistant" or "the agent", which are not instructions to a reader. No external pages were fetched tonight.

## Location rule

No application material was produced tonight. DEMO_VIDEO.md's end card and pre-flight say **Owings Mills, MD**. The only other mention of a place is PLAN_AUDIT.md's M4 lint rule, which names the forbidden city so the lint can grep for it. It is not a location reference.

## Addendum (Alder, Oct 16 night) — recovery + Quiet Zones & Canary

- **This branch was recovered.** Session 1's commits existed only in its cloud container (see "Blocked" above: no remote, invalid GH_TOKEN). After the session finished Parts 1–2, a follow-up steering attempt hit the account weekly limit, so Alder reconstructed the branch on the ground from the session's own transcript: every Write/Edit replayed in order (each edit's context matched exactly once), plus the two Bash-applied changes (demo pacing, phone-check harness). Verified after replay: `npm test` green and `npm run demo` DEMO OK before any new work was added.
- **Quiet Zones prototype (Darren's addition to the process):** `Gate.zoneEvent` + a `/venue/zone` signal route (owner-key stand-in for a venue credential; deliberately NOT an MCP tool — the assistant cannot call it). While a zone is active, all gated actions are held and the hold is receipted. A venue-set zone cannot be lifted from inside the home; the attempt is receipted (`exit-rejected`). Household-set zones lift normally. Tests: `test/zones.test.js` (3).
- **Canary set:** `test/canary.test.js` (7) — planted scenarios guarding the spoken promises: never-item refusal, no token before a person's yes, split-order loophole, execute-exactly-what-was-approved, decision-maker-only loosening, receipt chain + tamper + replay, and a wording canary (the same promise spoken three ways is the same constitution, hash-identical, decisions unchanged).
- **Totals after the additions:** `npm test` **29 pass, 0 fail** (19 + 10 new); `npm run canary` 10/10; demo still DEMO OK.
- Honest scope: the zone SIGNAL is simulated (a route + the owner key); enforcement, holds, and receipts are real. A production venue credential and a decision-maker break-glass for venue zones are future work, deliberately not improvised tonight.
