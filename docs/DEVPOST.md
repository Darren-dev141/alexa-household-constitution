# Devpost draft

Paste these sections into the form. Do not submit from this file. The video script is the submission cut. Keep it under three minutes ([rules](https://amazonappdev2026.devpost.com/rules)).

Track: Alexa+.
Do not enter AWS Builder. No AWS service is called.

## Name

Household Promises

## Tagline

The assistant can shop. It cannot change the household's rules.

## What it does

An assistant that can spend money for a household has to call this server. The server keeps a short list of promises:

- A small order, such as dish soap, goes through.
- A medium order is done, then reported.
- Anything over the ask-first amount is held for the person who runs the home, at the price the store quoted. A yes spoken at the device does not place it.
- An allergen the household named is refused. Nobody can approve it.
- A quiet zone, set by a venue signal, holds every action until the venue ends it. The hold is still there after the server restarts.

The assistant has no tool that means yes. The store, not the assistant, sets the price, the product, and the allergens. If those change after a yes, checkout stops and nothing is charged. Decisions are written to a hash-chained receipt log.

In this demo the Alexa+ host, the voice, and the store are simulated. The MCP server, the checks, and the receipts are real. Elicitation on a live Alexa+ account has not been tried.

## How it's built

Node.js MCP server. Protocol 2025-11-25 over Streamable HTTP, using `@modelcontextprotocol/sdk`. Express serves `/mcp`, the owner page, and `POST /venue/zone`. Zod describes the tool inputs.

The gate decides. The executor is the only code that can place the order, and it checks a single-use approval bound to the exact order. Spend over the ask-first limit is stored for `GET /owner/pending` and placed only by `POST /owner/approve/:id` with the owner key. Active quiet zones are written into `data/household.json` and loaded again on startup. The receipt log is hash-chained. A tampered promises file or a broken chain refuses to start.

`demo/walk.js` is a simulated host. It uses the official MCP client against a server that is already running.

## Challenges

MCP elicitation only works when the host keeps a session. The Alexa+ docs say the session follows the customer's conversations, and they do not say whether `Mcp-Session-Id` is kept or whether a yes/no question is always spoken. Spend over the limit therefore does not depend on that prompt. It waits on the owner page.

The store can change a price or swap a product after the person has said yes. Checkout reads the quote again and stops on a mismatch.

A quiet zone cannot be an MCP tool. If it were, the assistant could turn it off. The signal is a separate HTTP route. The zone has to be on disk, or a restart would drop it.

## What's next

A live Alexa+ developer account, to see whether elicitation is actually spoken to the person. OAuth 2.1 on `/mcp`, so the server is not localhost-only. A venue credential that is not the household's owner key.

## Built with

Node.js 22, `@modelcontextprotocol/sdk` 1.32.1 (MCP 2025-11-25, Streamable HTTP), Express 5, Zod 4. The store is the sandbox in `src/vendor.js`. No merchant account. No AWS.

## Product feedback

Paste `docs/product-feedback.md` into the product-feedback answers. It covers the MCP TypeScript SDK and the Alexa+ MCP docs: what worked, what did not, onboarding, and whether we would use them again.

## Friction log

Paste `docs/friction-log.md`. Three entries, with the fields the rules ask for: task, steps, expected, actual, severity, workaround, suggestion.

## Open Source mini challenge (optional)

- Contribution URL: `https://github.com/Darren-dev141/alexa-household-constitution`
- Project repository URL: `https://github.com/Darren-dev141/alexa-household-constitution`
- GitHub username: `Darren-dev141`
- What, how, why: A new public MIT repo, first commit 2026-10-13. It is an MCP server that holds household spending to a short list of promises: ask-first over a limit, refuse named allergens, and hold actions during a quiet zone. The assistant cannot approve its own orders. Tests cover the gate, the HTTP server, and a red-team pass.

## Demo video script

Under 3 minutes. Target about 2 minutes 40 seconds. Stop at 3:00 even if a line is left. Public YouTube or Vimeo. No music. No logos. No stock footage. Say on screen, once, that the host, the voice, and the store are simulated.

Record a terminal at about 100 columns and the owner page at 390×844. The home code `home-demo-code` is a demo value. It will be typed on camera. Delete `data/` first so the home is not already set up.

Two terminals, same directory. Terminal 1 is the server. Terminal 2 is the simulated voice.

### 0:00–0:12 Title

On screen: **Household Promises**. The assistant proposes. The household's rules decide.

Say: "This is a server an assistant has to call before it spends money for a household."

### 0:12–0:22 What is real

On screen: Real: MCP server, checks, receipt log. Simulated: Alexa+ host, voice, sandbox store.

Say: "The host, the voice, and the store are simulated. The server is real."

### 0:22–0:28 Start

Terminal 1:

```
OWNER_KEY=home-demo-code npm start
```

It prints `household-promises MCP on http://127.0.0.1:3000/mcp`.

### 0:28–1:05 A promise, set by voice

Terminal 2:

```
node demo/walk.js promise
```

On screen, in order:

```
Household We're a family. Ask before anything over seventy-five dollars. No peanuts, ever.
Device    Here's what I'll promise your home. I'll always ask before spending more than $75.00. I'll tell you afterwards about anything over $20.00. I'll ask before swapping anything you asked for. I'll never bring peanuts into your home. I'll ask before messaging anyone. Shall I keep these promises?
Household Yes.
Assistant All set. I'll always ask before spending more than $75.00. I'll tell you afterwards about anything over $20.00. I'll ask before swapping anything you asked for. I'll never bring peanuts into your home. I'll ask before messaging anyone. You can change any of this just by asking.
```

Say: "Setup is spoken. Nothing is saved until a person says yes."

### 1:05–1:45 Over the limit, approved on the owner page

Terminal 2:

```
node demo/walk.js hold
```

```
Household Order the air fryer.
Assistant I've sent that to the person who runs your home to okay. Nothing happens until they do.
```

Open http://127.0.0.1:3000/owner. Type `home-demo-code`. Continue.

The card reads: "Go ahead and order 1 × air fryer for $89.99, delivered 2026-10-24?" and "Waiting because it costs $89.99, over your $75.00 ask-first limit."

Tap **Okay**. The page says "Done. Here's what I did: order 1 × air fryer for $89.99, delivered 2026-10-24."

Say: "Over seventy-five dollars waits for the person who runs the home. The price is the store's price."

### 1:45–2:05 Allergen, blocked

Terminal 2:

```
node demo/walk.js allergen
```

```
Household Order peanut butter.
Assistant I won't order 1 × peanut butter for $5.49, delivered 2026-10-24: it contains peanuts, and I promised never to bring that into your home.
```

Say: "Peanuts were refused. There is no approval for that."

### 2:05–2:40 Quiet zone, still on after restart

Terminal 2:

```
OWNER_KEY=home-demo-code node demo/walk.js zone
```

```
Venue     Quiet zone on for clinic. I'll hold anything I'm asked to do until it lifts.
```

Ctrl-C in terminal 1. Start the same server again. Do not delete `data/`.

```
OWNER_KEY=home-demo-code npm start
```

Terminal 2:

```
node demo/walk.js check
```

```
Household We need dish soap.
Assistant I'm in a quiet zone right now, so I can't do that. I've written it down.
```

Reload http://127.0.0.1:3000/owner. It still says "Quiet zone on for clinic. Set by the venue. It stays until the venue ends it."

Say: "The clinic quiet zone is not a tool the assistant can turn off. Restarting the server did not clear it. Dish soap would have gone through. It did not."

### 2:40–2:50 End

On screen: Household Promises. Darren Foote. Owings Mills, MD. `https://github.com/Darren-dev141/alexa-household-constitution`

Say: "Household Promises. Rules the assistant cannot talk its way out of."
