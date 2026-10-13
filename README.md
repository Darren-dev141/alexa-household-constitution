# Household Promises (Alexa+ entry: working build)

An MCP server that lets an assistant act for a family while keeping a short list of plain promises the assistant can't talk its way out of:

- Small things happen quietly.
- Medium things are reported afterwards.
- Anything over the household's ask-first amount is put to a person first, with the real store price.
- "Never" items, such as allergens, are refused outright.

## What is real and what is simulated

- **Real:** the MCP server (spec 2025-11-25, Streamable HTTP), the decision core, the receipt log and replay.
- **Simulated:** the Alexa+ host and voice (`demo/run.js` uses the official MCP client), the store (`src/vendor.js` is a sandbox; no real merchant), and the assistant's choices in the demo.
- **Not yet verified:** how Alexa+ itself handles the server's questions (MCP elicitation). That needs a live developer account.

## How the promises are enforced

- **The assistant can only act through this server's tools.** The server executes orders itself, and the assistant never holds an approval.
- **No tool means "yes".** An ask-first order is put to the person through the host's own prompt (MCP elicitation). If the host can't ask, the order is held for the person who runs the home (an owner-only web route, standing in for their phone).
- **The assistant cannot set up the home or loosen a promise.** First-run setup is read back and confirmed the same way. Loosening a promise always goes to the person who runs the home. Tightening one applies right away.
- **The store sets the price, product and allergens, not the assistant.** Checkout re-reads the order, and stops if anything changed after the yes.
- **Splitting an order doesn't avoid the ask.** Orders made without asking in the last 24 hours count toward the ask-first amount.
- **Every decision is logged in a hash-chained, tamper-evident receipt log: edits to past entries are detected, though someone with disk access could rewrite the whole chain.** Each logged decision replays to the same outcome. A tampered promises file or log stops the server from starting.

**Who approves what:** an ask-first prompt is answered by whoever is at the device, and the receipt records that. Promise changes, first-run setup without a prompt, and held orders need the person who runs the home.

## Verify

```
npm install
npm test        # unit + end-to-end MCP tests
npm run demo    # 10 scripted scenes against the real server; exits non-zero if any scene misbehaves
```

The demo writes `demo/transcript.txt`.

## Run the server

```
OWNER_KEY=... npm start   # MCP at http://127.0.0.1:3000/mcp, parent's page at http://127.0.0.1:3000/owner
```

**Local only for now.** `/mcp` has no sign-in yet; OAuth 2.1 account linking is not built. The home code on `/owner` is a shared secret and is only safe over HTTPS. The server binds to 127.0.0.1. Do not put it behind a public tunnel until sign-in exists.
