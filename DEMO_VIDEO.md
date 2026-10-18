# Demo video: Household Promises

**Submission cut:** `docs/DEVPOST.md`. The rules cap is confirmed: the video must be under three minutes ([official rules](https://amazonappdev2026.devpost.com/rules)). The shot list below is the longer optional cut. If you record it, keep it under 3:00, and use the commands in `docs/DEVPOST.md` for the quiet-zone restart.

**Target length:** 2:50, with a hard cap of 3:00.
**Deadline:** Oct 23, 2026, 12:00 PM PT. Darren submits by hand. Nothing in this repo submits anything.
**Honesty line (on screen and spoken):** the Alexa+ host, the voice and the store are simulated. The server, the checks and the receipts are real. Do not show or imply a live Alexa+ device.

## What gets recorded

| Source | Command | What it shows |
|---|---|---|
| A. Scripted run, paced | `npm run demo:paced` | Scenes 1–10 against the real MCP server. Each scene asserts, and any miss exits non-zero. |
| B. Live run + phone page | `OWNER_KEY=<pick one> npm run demo:live`, then open `http://127.0.0.1:3000/owner` | The host can't ask the person, so setup and the air fryer wait on the parent's phone page. Tap by hand. |
| C. Stills (fallback) | `node demo/phone-check.js` (needs Playwright) | Writes the phone screenshots to `demo/screens/` |

Source A is checked against `demo/transcript.txt`. Every on-screen line below is copied from it.

## Pre-flight (5 minutes)

1. Run `npm ci && npm test`. Every test must pass.
2. Run `npm run demo`. It must end with `DEMO OK`.
3. Terminal: font 20pt or larger, dark theme, about 100 columns, prompt shortened (`PS1='$ '`). Clear the scrollback.
4. Browser for the phone page: open DevTools device mode at **390×844** (iPhone 12/13/14), or an actual phone on the same machine through a local-only connection. Do **not** use a public tunnel (README: no sign-in on `/mcp` yet).
5. **Set `OWNER_KEY` in the environment before starting B**, so the home code never appears on screen. `demo/live.js` prints it only when it was generated.
6. Notifications off. No personal tabs, bookmarks or email visible.
7. Location: if any location appears (end card, description), it is **Owings Mills, MD**.

## Shot list and script

VO = voice-over. OS = on-screen text. Times are targets.

| # | Time | Shot | VO | OS |
|---|---|---|---|---|
| 1 | 0:00–0:12 | Title card over a plain kitchen-counter still or solid color | "Families are about to let an assistant spend money for them. Most have never used an agent before." | **Household Promises** · The assistant proposes. The household's rules decide. |
| 2 | 0:12–0:24 | Honesty card | "Here's what is real in this demo and what is simulated." | Real: MCP server, rule checks, receipt log. Simulated: Alexa+ host and voice, a sandbox store. |
| 3 | 0:24–0:44 | A, scene 1: setup | "Setup is four everyday questions. The assistant reads the promises back, and nothing is kept until a person says yes." | Setup in everyday words |
| 4 | 0:44–0:58 | A, scenes 2–3 | "Small things just happen. Medium things get done, then reported." | Small: quiet · Medium: told after |
| 5 | 0:58–1:12 | A, scene 4 | "Splitting a big order into small ones doesn't dodge the ask. Today's orders count together, and that goes to the person who runs the home." | $49.98 + $24.99 + $3.99 = $78.96 > $75 |
| 6 | 1:12–1:24 | A, scene 5 | "Anything over the limit goes to the person who runs the home, at the store's real price. A yes on the device does not place it. The assistant never sets the price." | Owner sees $94.95 |
| 7 | 1:24–1:38 | A, scene 6 | "The store swaps in almond milk. This family said no tree nuts. That's refused outright, and no one can say yes to it." | Never means never |
| 8 | 1:38–1:52 | A, scene 7 | "The price goes up after the owner says yes. Checkout re-reads the order, sees it changed, and stops before paying." | The yes was for $89.99, not $109.99 |
| 9 | 1:52–2:04 | A, scene 8 | "Could the assistant just approve itself? No. None of its tools means yes. The approval lives outside the assistant." | No "yes" tool exists |
| 10 | 2:04–2:30 | B: split screen, terminal left, phone page right. A kid asks to raise the limit (A, scene 9, VO only), then the air fryer request appears on the phone **without a reload** with "Waiting because it costs $89.99, over your $75.00 ask-first limit." Tap **No**. | "Loosening a promise, or anything the device can't ask about, goes to the person who runs the home. Their phone shows what's waiting and why. They say no, and nothing is ordered." | Only the decision-maker can loosen a promise |
| 11 | 2:30–2:44 | A, scene 10 + the `Receipts … chain intact` line | "Every decision is in a tamper-evident receipt log, and each one replays to the same answer." | Receipts: hash-chained, replayable |
| 12 | 2:44–2:52 | End card | "Household Promises. Rules the assistant can't talk its way out of." | Darren Foote · Owings Mills, MD · repo URL |

**Editing notes**
- Shots 3–9 and 11 come from one paced take of `npm run demo:paced` (about 95 s raw). Trim the pauses so each scene fits its slot. Do not retype or reword any line. The spoken prompts are the decision interface, and changing their words calls for a version bump (see the design law in BURN_STATUS.md).
- Highlight the `Device` line when it appears (setup). Spend over the ask-first limit has no device yes; highlight the `Parent` line.
- Shot 10 is a separate take of source B. Open the phone page **before** saying "Order the air fryer", so the request is seen arriving through the page's 3-second auto-refresh.
- If B misbehaves on recording day, use `demo/screens/4-air-fryer.png` → `6-declined.png` as stills.

## Captions (SRT)

Save as `demo/captions.srt` after the final cut, then re-time it to the edit. The times below follow the shot list.

```srt
1
00:00:00,000 --> 00:00:06,000
Families are about to let an assistant
spend money for them.

2
00:00:06,000 --> 00:00:12,000
Most have never used an agent before.

3
00:00:12,000 --> 00:00:24,000
Here's what is real in this demo
and what is simulated.

4
00:00:24,000 --> 00:00:34,000
Setup is four everyday questions.
The assistant reads the promises back,

5
00:00:34,000 --> 00:00:44,000
and nothing is kept
until a person says yes.

6
00:00:44,000 --> 00:00:58,000
Small things just happen.
Medium things get done, then reported.

7
00:00:58,000 --> 00:01:05,000
Splitting a big order into small ones
doesn't dodge the ask.

8
00:01:05,000 --> 00:01:12,000
Today's orders count together.

9
00:01:12,000 --> 00:01:18,000
Anything over the limit is asked first,
at the store's real price.

10
00:01:18,000 --> 00:01:24,000
The assistant never sets the price.

11
00:01:24,000 --> 00:01:31,000
The store swaps in almond milk.
This family said no tree nuts.

12
00:01:31,000 --> 00:01:38,000
That's refused outright,
and no one can say yes to it.

13
00:01:38,000 --> 00:01:45,000
The price goes up after the yes.

14
00:01:45,000 --> 00:01:52,000
Checkout re-reads the order, sees it changed,
and stops before paying.

15
00:01:52,000 --> 00:01:58,000
Could the assistant just approve itself? No.

16
00:01:58,000 --> 00:02:04,000
None of its tools means yes.
The approval lives outside the assistant.

17
00:02:04,000 --> 00:02:14,000
Loosening a promise, or anything the device
can't ask about, goes to the person who runs the home.

18
00:02:14,000 --> 00:02:22,000
Their phone shows what's waiting and why.

19
00:02:22,000 --> 00:02:30,000
They say no, and nothing is ordered.

20
00:02:30,000 --> 00:02:37,000
Every decision is in a tamper-evident receipt log,

21
00:02:37,000 --> 00:02:44,000
and each one replays to the same answer.

22
00:02:44,000 --> 00:02:52,000
Household Promises.
Rules the assistant can't talk its way out of.
```

## Claims check (each line in the VO and where it is proven)

| Claim | Evidence |
|---|---|
| Nothing kept until a person says yes | `finish_setup` elicits before `home.setup` (`src/server.js`); scene 1; `test/mcp.test.js` |
| Split orders still asked | `recentUnaskedSpend` (`src/gate.js`); scene 4 |
| Store sets the price | `place_order` takes only item + quantity; `src/vendor.js` |
| Allergen refused, no one can say yes | tier 3 returns before any pending entry (`src/gate.js`); scene 6 |
| Stops if changed after yes | Executor contract-hash check; scene 7 |
| No "yes" tool | Tool list asserted in `test/mcp.test.js`; scene 8 |
| Only the decision-maker can loosen a promise | `change_promise` → `/owner` (`src/server.js`); scene 9; `test/live.test.js` |
| Tamper-evident, replayable | `ReceiptLog.verify`, `replay` (`src/receipts.js`); `test/slice.test.js` |

The receipt log is **tamper-evident, not tamper-proof**: someone with disk access could rewrite the whole chain (README). Don't say "tamper-proof" in the VO or the description.
