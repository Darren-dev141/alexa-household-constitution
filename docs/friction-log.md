# Friction log: Household Promises (Alexa+ track)

These are things we actually ran into. An entry marked **docs finding** comes from reading Amazon's documentation and hasn't been reproduced live yet; those get updated once a live Alexa+ connection exists.

Fields (per the official rules): task / steps / expected / actual / severity / workaround / actionable suggestion.

---

## 1. Official rules page blocked by a bot check
- **Task:** Read the hackathon's official rules before committing build time.
- **Steps:** Opened `amazonappdev2026.devpost.com/rules` in an automated browser session, Oct 13, 2026.
- **Expected:** The rules page loads.
- **Actual:** The page stopped at a "Just a moment..." interstitial. A plain text fetch later got through.
- **Severity:** Low. It cost time on deciding eligibility, because whether a simulated Alexa+ entry counted was unclear until a full read.
- **Workaround:** Plain text fetch of the same URL.
- **Suggestion:** Serve the official rules page without an interactive bot check, or publish a plain-text or PDF copy linked from the hackathon overview.

## 2. Session continuity for MCP add-ons is unclear (docs finding)
- **Task:** Decide whether the server can keep a per-conversation MCP session (needed so it can ask the person mid-task).
- **Steps:** Read "Alexa+ MCP Client and App Lifecycle".
- **Expected:** A clear statement of whether Alexa+ sends and keeps the `Mcp-Session-Id` header across tool calls.
- **Actual:** The docs say the session "is based on the customer's previous conversations with Alexa+ rather than an explicit identifier for a session with your MCP App". They don't say whether `Mcp-Session-Id` is honored.
- **Severity:** Medium. It decides whether servers can rely on session-scoped state or server-to-client requests.
- **Workaround:** The server also handles requests with no session, and every ask-first order is then held for the person who runs the home (commit `ade5953`).
- **Suggestion:** State in the lifecycle docs whether Alexa+ sends and keeps `Mcp-Session-Id`, and for how long, so servers know whether session-scoped state and server-to-client requests are usable.

## 3. Elicitation behavior is unclear (docs finding)
- **Task:** Have the server ask the person before a consequential action, using MCP elicitation.
- **Steps:** Read the same lifecycle page, section "Resource handling and elicitation".
- **Expected:** A statement that an elicitation request is put to the customer as a spoken or on-screen question.
- **Actual:** The docs say Alexa+ "first attempts to gather all necessary contextual information" before using elicitation. They don't say whether a yes/no confirmation can be answered from context without asking the person.
- **Severity:** High for any server that uses elicitation as a human confirmation step.
- **Workaround:** None on the server side beyond treating a missing answer as no. Needs a live test.
- **Suggestion:** Document whether an elicitation request is always put to the customer, and offer a way for a server to require that it is (for purchase or safety confirmations).
