# Household Promises (Alexa+ entry: working build)

An MCP server that lets an assistant act for a family while keeping a short list of plain promises the assistant can't talk its way out of:

- Small things happen quietly.
- Medium things are reported afterwards.
- Anything over the household's ask-first amount is put to a person first, with the real store price.
- "Never" items, such as allergens, are refused outright.
- A quiet zone holds every action until it lifts, including after a restart.
- Guest Mode lets a visitor use the assistant for a short list of things the person who runs the home picked — and nothing else — and it turns itself off.

## 60-second quickstart

Node.js 22. From a clean clone:

```
npm ci
npm test
OWNER_KEY=home-demo-code npm start
```

MCP is at http://127.0.0.1:3000/mcp. The person who runs the home opens http://127.0.0.1:3000/owner and types `home-demo-code`.

In a second terminal, from the same directory:

```
node demo/walk.js promise
node demo/walk.js hold
```

On the owner page, tap **Okay** on the air fryer. Then:

```
node demo/walk.js allergen
OWNER_KEY=home-demo-code node demo/walk.js zone
```

Stop the server with Ctrl-C. Leave the `data/` directory in place and start it again:

```
OWNER_KEY=home-demo-code npm start
node demo/walk.js check
```

Dish soap, which would otherwise be ordered quietly, is held. The owner page says the clinic quiet zone is still on. `npm test` is the check; `npm run demo` runs the longer 10-scene script and exits non-zero if a scene misbehaves. Delete `data/` before a second recording so setup starts clean.

## What is real and what is simulated

- **Real:** the MCP server (spec 2025-11-25, Streamable HTTP), the decision core, the receipt log and replay.
- **Simulated:** the Alexa+ host and voice (`demo/walk.js` and `demo/run.js` use the official MCP client), the store (`src/vendor.js` is a sandbox; no real merchant), and the assistant's choices in the demo.
- **Not yet verified:** how Alexa+ itself handles the server's questions (MCP elicitation). That needs a live developer account.

## How the promises are enforced

- **The assistant can only act through this server's tools.** The server executes orders itself, and the assistant never holds an approval.
- **No tool means "yes".** An ask that is not about spend is put to the person through the host's own prompt (MCP elicitation). Anything over the ask-first limit is held for the person who runs the home (an owner-only web route, standing in for their phone). A yes on the device does not place it. If the host can't ask, every ask-first action is held the same way.
- **The assistant cannot set up the home or loosen a promise.** First-run setup is read back and confirmed the same way. Loosening a promise always goes to the person who runs the home. Tightening one applies right away.
- **The store sets the price, product and allergens, not the assistant.** Checkout re-reads the order, and stops if anything changed after the yes.
- **Splitting an order doesn't avoid the ask.** Orders made without asking in the last 24 hours count toward the ask-first amount.
- **Guests get only what's on the list.** While Guest Mode is on, a guest can order only the items the person who runs the home put on the guest list, inside the household's own limits: no messages, no substitutions, nothing that would need an okay, and no hearing the household's promises or what it has done. Only the person who runs the home can turn Guest Mode on or off or change the list — from the same owner route as everything else; there is no tool for it. It always has an expiry and turns itself off, including after a restart, and every guest decision is receipted like everything else.
- **Every decision is logged in a hash-chained, tamper-evident receipt log: edits to past entries are detected, though someone with disk access could rewrite the whole chain.** Each logged decision replays to the same outcome. A tampered promises file or log stops the server from starting.

**Who approves what:** the device prompt can approve a substitution or a message, and the receipt records that. Spend over the ask-first limit, loosening a promise, first-run setup without a prompt, and other held orders need the person who runs the home. That route checks the owner key. The key is not written into receipts or error responses.

**Local only for now.** `/mcp` has no sign-in yet; OAuth 2.1 account linking is not built. The home code on `/owner` is a shared secret and is only safe over HTTPS. The server binds to 127.0.0.1 and exits if `OWNER_KEY` is unset. Do not put it behind a public tunnel until sign-in exists.
