# Spike Spec: Non-MCP Enforcement via Gate-Owned SMTP

**Date:** 2026-10-13
**Status:** Speculative — spec + threat model only
**Owner:** Hermes interactive coordinator
**Target repo:** `github.com/Darren-dev141/alexa-household-constitution`
**Spike branch:** `spike/non-mcp-smtp` (off `master` @ `e19c39c`, in sync with GitHub)
**Code window:** starts AFTER `devpost-2026-10-23` tag is verified on GitHub

## Decision context

High Council Direction B — build the portable hard rulebook as a feature, not a
standalone company. The council is closed: build proceeds in-window (Alexa+
packaging through Oct 23, then spike), with a one-day feasibility spike on a
non-MCP channel as the gating test.

**Spike kill criteria** (separate from escalation kill criteria — a spike pass
does NOT clear demand/viability):

1. No practical second consumer-relevant channel permits gate custody without
   replacing the whole platform.
2. The agent retains a direct credential or alternate route to the action.
3. Integration exceeds one working day before the first real enforced block.
4. The adapter needs platform cooperation unavailable to third parties.
5. The result only demonstrates advisory checking or another MCP path.

## Channel

A gate process for outbound mail. Runs as its own process on localhost, holds the
only upstream login, and passes messages to a local test mail server that
requires that login.

- No real mail account is involved.
- Nothing touches Darren's credentials.
- Fallback (if SMTP is impractical): a web proxy that adds an API key for a
  test API — same pattern, gate owns the credential.

## Must demonstrate

1. **One allowed send** — approval is present and the gate forwards it.
2. **One enforced block** — no valid approval, the gate refuses; the agent
   cannot bypass by connecting directly.
3. **One stale or mutated approval refused** — an approval that expired or whose
   payload was changed is rejected.

## Bypass tests

- The agent's direct connection to the mail server **fails** because it has no
  login (the credential lives only in the gate process).
- A search of the agent's environment and config finds **no credential**.
- If blocking the agent's network access at the OS level requires admin rights
  not available in this environment, that is recorded as a **known gap**, not a
  pass.

## Time limit

- About 8 hours of work total.
- If there is no real enforced block by **hour 4**, the spike is killed.

## Order / sequencing

- **Until Oct 23 noon PT:** spec and threat model only. No spike code.
- Spike code starts after the `devpost-2026-10-23` tag is verified on GitHub.
- No spike work Oct 25–27 if it competes with GitLab packaging or the Meta
  kickoff.
- Nothing goes into a Meta entry until the Oct 26 rules check reports.

## Success / pass conditions

- Spike passes: "portable core demonstrated across two independently enforced
  channels in a sandbox."
- README on the judged branch keeps "built for adapters, one adapter built."
- A pass does NOT validate demand; it proves portability + portfolio value only.
- Demand still gates any escalation beyond open-source.

## Failure / kill

- If killed: Alexa+ constitution stays as portfolio proof; the adapter work
  stops.
- If killed for any reason: do not continue building integrations.

## Threat model (summary)

- **Asset:** the household's sanctioned outbound actions (mail send, in this
  spike).
- **Adversary:** the agent itself (honest-but-curious, no malicious override of
  the gate code), plus any external party that might compromise the agent's
  runtime.
- **Attack surface:** the agent's tool-call path. The gate must sit on that path
  such that the agent cannot reach the credential or action rail without the
  gate.
- **Mitigation:** gate owns the credential; credential is not present in agent
  environment, config, or code path; agent has no alternate route.
- **Residual risk:** OS-level network controls may be needed to prevent direct
  connectivity; if admin rights are unavailable, this is an explicit gap.
