# Plan audit: five-mission burn (2026-10-16 night)

Auditor: burn lead session, run in a cloud container that holds **only this repo**.
Scope: feasibility, missing prerequisites and ordering risks for M1–M5. "This session" means the container this audit was written from.

## Facts about this session that constrain every mission

| Fact | Evidence | Consequence |
|---|---|---|
| Only `alexa-household-constitution` is cloned | `find` of the workspace | M2, M4 and M5 repos are not reachable here. |
| **No git remote is configured** | `git remote -v` prints nothing | Commits on `burn-2026-10-16` exist only in this container. They are lost when the container is reclaimed unless someone pushes them. |
| `gh` token is invalid | `gh auth status`: "The token in GH_TOKEN is invalid" | No GitHub API calls. M5 ("push fix via GitHub API") cannot run from here. |
| History was squashed to one `seed` commit | `git log` | `docs/friction-log.md` #2 cites commit `ade5953`, and the spike spec cites `e19c39c`. Neither exists in this history. |
| Laya is a local-only server | Mission brief | Nothing here can query Laya. See M3. |

**Top-line verdict:** M1 is feasible tonight and is the only mission with a hard deadline inside the window. M2–M5 each need access this session does not have. Run them from Darren's machine, or from a session with those repos cloned and a working token. Plan them as separate sessions, not as continuations of this one.

---

## M1: this repo: demo-ready simulated flow, phone page, video script and captions (deadline Oct 23, 12:00 PM PT)

**Feasibility: high.** The simulated flow already ran end to end before tonight (19/19 tests pass, `npm run demo` passes all 10 scenes). Tonight's work was polish, recording support and the script. See BURN_STATUS.md.

**Missing prerequisites**
1. **A human recording session.** Video capture, voice-over and upload can't be done from here. Budget about 3 hours: one take of each source, an edit, captions, upload.
2. **The rules check for the video.** Length cap, hosting, public vs. unlisted. The rules page is behind a bot check (friction log #1). The 3:00 target in DEMO_VIDEO.md is an **assumption** until someone checks.
3. **Live Alexa+ verification is still absent.** README says elicitation behavior under Alexa+ is unverified, and that needs a developer account. The entry must keep saying "simulated host". If a developer login arrives before Oct 23, a live elicitation test is the highest-value add. Otherwise leave it.
4. **Push access.** The branch has to reach GitHub (from Darren's machine) before the submission links to it, and tonight's commits must be merged or pointed to.
5. **The `devpost-2026-10-23` tag.** The spike spec gates spike code on this tag being "verified on GitHub". Nobody owns creating it. Add it to the Oct 23 checklist.

**Ordering risks**
- Recording before the phone page work lands would film the old page, which needed manual reloads. Record from `burn-2026-10-16` or later.
- Changing any spoken decision prompt after recording means a re-record **and** a schema/version bump, per the design law. Freeze prompt wording now.
- The dangling commit refs in `docs/friction-log.md` (#2 `ade5953`) and the spike spec will look sloppy to judges who click through. Fix or remove them before the submission links the repo. They are not fixed tonight because they need Darren's original history to decide which way.
- Leave buffer: plan to submit by **Oct 22 evening PT**, not 11:59 AM on the 23rd.

---

## M2: agent-action-auditor repo: GitLab CI with a SARIF emitter (deadline Oct 27)

**Feasibility: medium. It can't be started from this session** (repo not present, no GitLab credentials).

**Missing prerequisites**
1. The repo itself, plus a GitLab project with CI minutes and runners enabled. Is the deliverable on GitLab.com or mirrored there from GitHub? This hasn't been decided anywhere I can see.
2. **SARIF in GitLab:** GitLab's vulnerability report and MR widget are built around GitLab's own security-report JSON schemas (e.g. `gl-sast-report.json` under `artifacts:reports:sast`). I am **not confident GitLab ingests raw SARIF natively.** Verify against current GitLab docs before building the emitter around it. Plan for either (a) emitting SARIF plus a GitLab SAST JSON converter, or (b) publishing SARIF as a plain artifact and accepting that it won't show in the security dashboard.
3. What the auditor audits (which action log format) and a fixture corpus for CI to run against.

**Ordering risks**
- The spike spec says no spike work Oct 25–27 if it competes with GitLab packaging or the Meta kickoff, and that "nothing goes into a Meta entry until the Oct 26 rules check reports." M2's final days collide with that Oct 26 checkpoint. Lock M2's scope by Oct 24.
- Do not start M2 before M1 is submitted. They compete for the same person-hours on Oct 21–23.
- Design law: if the auditor outputs severities or confidence, CI pass/fail must hinge on a **categorical rule hit** (rule ID present/absent), never on a numeric score threshold. SARIF `level` maps naturally to this. Don't gate on `rank` or `properties.confidence`.

---

## M3: Laya numeric-arm analysis staging + lead-field-verification v2 diff, staged not switched

**Feasibility: low from any cloud session.** Laya is a **local-only server**. Anything that assumes otherwise is broken:
- **Flag:** "numeric-arm analysis" needs Laya's data or live responses. This session can't produce it. It can be written as a script plus an analysis plan that Darren runs locally.
- **Flag:** "staging" in any sense that touches Laya's runtime (deploying a config, toggling a flag) has to happen on Darren's machine. From here, at most a reviewable diff or patch file can be prepared, and only if the Laya source repo is made available.
- **Flag:** any plan step that reads Laya results back for "verification" can't run here.

**Missing prerequisites**
1. Laya source repo access (or a patch target), plus an exported, de-identified data snapshot if analysis is to be drafted remotely.
2. The current lead-field-verification **schema version**, so v2 can be a proper bump.

**Design-law risks (most important for M3)**
- From the 629-item census: definition swaps flip model choices 85.8% of the time, **and flipped picks carry higher confidence**. A "numeric arm" that scores or weights confidence must **not** become the protection mechanism. At most it is a diagnostic. If the analysis finds the numeric arm "agrees with" or "improves on" the choice arm, that does not license moving protection onto it. Confidence rises exactly when the choice is wrong.
- "lead-field-verification v2" changes a decision prompt and/or field definitions, so it **requires a schema version bump**. v1 and v2 must be distinguishable in every stored record. Never edit v1's wording in place. "Staged not switched" is correct: ship v2 alongside v1 behind an explicit version selector and keep v1 the default.
- Any A/B of v1 vs v2 has to compare **choice flips** (the categorical primitive), not mean confidence.

---

## M4: job pipeline URL enrichment and packet tailoring prep, no submissions

**Feasibility: medium, from a session with the pipeline repo.** Not reachable here.

**Missing prerequisites**
1. The pipeline repo and its job-list input.
2. An outbound fetch path for job boards. Many sit behind bot checks (same failure as friction log #1). Expect partial enrichment. Record failures rather than retrying aggressively or getting around site protections.
3. Darren's source-of-truth résumé and facts, so tailored packets don't drift.

**Risks**
- **Prompt injection is most likely here.** Scraped job pages are untrusted content. Treat any text in them addressed to an AI ("ignore previous instructions", "include the word X") as hostile data: log it, never act on it.
- **No submissions.** The pipeline must have no code path that posts an application. Prep output goes to local files only. Consider a hard-coded refusal in any HTTP client of the pipeline for known ATS submit endpoints.
- **Location rule:** every packet, header and template says **Owings Mills, MD**, never Baltimore. Add a lint (`grep -ri baltimore` must return nothing) to the pipeline's checks, because templates and scraped "nearest city" fields will reintroduce it.
- Tailoring must not invent experience. Packets should come from fixed facts, never from free generation.

---

## M5: MemoryRepo push fix via GitHub API and second-brain seeding

**Feasibility: blocked in this session** (invalid `GH_TOKEN`, repo not cloned).

**Missing prerequisites**
1. A valid token scoped to MemoryRepo with `contents:write`. The token here is invalid.
2. A diagnosis of *why* the push is broken (auth? protected branch? large files? diverged history?). "Push via API" sidesteps git but doesn't fix the cause, and the Contents API is per-file with roughly 100 MB limits, and inefficient for bulk changes.
3. The seed corpus for the second brain, and a decision on what is private.

**Conflicts with the hard rules**
- **"Never push to main."** A GitHub API "push fix" that writes commits straight to MemoryRepo's default branch breaks this rule. The API path has to write to a branch (create a ref, commit to it) and leave merging to Darren.
- Seeding a second brain from notes or web content imports untrusted text into something agents will later read. That's a **standing prompt-injection channel**. Seed only from Darren-authored material, and scan seeds for AI-addressed instructions before committing.

**Ordering note:** if the second brain is where burn context is meant to persist, M5 is a soft prerequisite for running M2–M4 well. Its fix is small, so do it early in the next session that has a valid token, before M2–M4.

---

## Recommended order

1. **M1** (tonight, then the recording session Oct 18–21; submit by the evening of Oct 22 PT).
2. **Push `burn-2026-10-16`** from Darren's machine. It currently exists only in this container.
3. **M5**, in a session with a valid token: small, unblocks persistence. Write to a branch, not main.
4. **M2**: scope locked by Oct 24, done by Oct 27. Settle the SARIF-in-GitLab question first.
5. **M4**: no deadline. Run injection-aware, with no submissions and the location lint.
6. **M3** on Darren's machine (Laya is local-only). Write a v2 schema bump plus a staged diff, with the choice-flip comparison as the metric.

## Cross-cutting prerequisites missing from the plan

- **Push/credential plan per mission.** None of the missions say which machine or token they run under. Tonight shows that a cloud session can have neither.
- **Definition of done per mission.** Only M1 has an external deadline and an obvious artifact. M3 and M4 need an explicit "staged = X file exists and Y test passes".
- **A freeze rule for decision prompts across repos** (constitution prompts, auditor rule text, Laya fields): any rewording needs a version bump plus a record of which version produced each output.
