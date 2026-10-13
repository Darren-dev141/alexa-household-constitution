# Product feedback

This covers only the tools we actually used. We have not run the `alexa-ai` CLI or connected to a live Alexa+ device (no developer login yet), so nothing here is about them.

## MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.32.1)

**Used for:** the Streamable HTTP server, tool registration, server-to-client questions (elicitation), and the official client in our tests and demo.

**What worked well**
- It negotiates protocol 2025-11-25 out of the box. `McpServer.registerTool` with zod schemas made the tool surface short and easy to read.
- With `elicitInput`, a tool can stop and ask the person mid-call. That is what lets our server ask the person before an order, so the assistant has no "yes" tool of its own.
- The client's `setRequestHandler(ElicitRequestSchema, …)` made the human side scriptable. Our tests cover yes, no and no answer end to end over real HTTP.

**What was hard**
- Elicitation only works over a stateful session: the server has to remember the conversation between requests. Our first stateless server built a fresh server for every request, so it could not ask questions at all. That isn't obvious until you try it.
- With sessions, the server must also handle requests that arrive with no session ID, and requests with an unknown one. We had to decide both cases ourselves. We serve the no-session case statelessly and return 404 for an unknown ID.

**Suggestion:** In the Streamable HTTP docs, add a short "which transport mode supports which features" table: stateless vs stateful, and whether elicitation, sampling and notifications are available in each.

## Alexa+ MCP Toolkit documentation

**Used for:** deciding the architecture: our own MCP server with Alexa+ as the client, the OAuth requirements, and how sessions and elicitation behave.

**What worked well**
- The overview states plainly that Alexa+ is the MCP client and that it consumes standard tools. Bringing our own server was straightforward to plan.
- The QuickStart's auth checklist is concrete: PKCE S256, RFC 9728 metadata, and what isn't supported yet (DCR, CIMD, OIDC).

**What was hard:** see the friction log, entries 2 and 3.
- The docs don't say whether `Mcp-Session-Id` is kept between tool calls.
- The docs don't say whether a yes/no elicitation is always put to the customer, or can be answered from context.

For a server that guards purchases, the second question decides whether elicitation can stand in for a person's confirmation.

**Suggestion:** Add a "confirmations" section for builders whose tools spend money or change a home. Cover how to make sure a question reaches a person, and what happens when the customer doesn't answer.
