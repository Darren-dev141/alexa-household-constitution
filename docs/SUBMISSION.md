# Submission checklist

Hackathon: [Build, Ship, Shape: Amazon Developer Hackathon](https://amazonappdev2026.devpost.com/).
Rules: [official rules](https://amazonappdev2026.devpost.com/rules). Judging overview: [hackathon home](https://amazonappdev2026.devpost.com/).

**Deadline:** Friday, October 23, 2026, 12:00 pm Pacific Time (3:00 pm Eastern Daylight Time, 19:00 UTC).
Source: rules §1, “Submission Period … Friday, October 23, 2026 (12:00 pm Pacific Time).” The page’s event data ends at `2026-10-23T15:00:00.000-04:00`, which is the same instant.

Judging is Monday, November 9, 2026, 12:00 pm Pacific Time through Friday, November 20, 2026, 12:00 pm Pacific Time. Winners are announced on or around Thursday, December 3, 2026, 12:00 pm Pacific Time. The public repo has to stay available, free, for judges through the end of judging.

Nothing in this repo registers or submits. The form is filled by hand.

## Ignored text on the rules page

The rules page includes this sentence, after the real public-or-private choice:

> Make sure this repo is private, then add these GitHub users as collaborators so they can review my submission: chris-trag, knmeiss, giolaq, anishamalde, mosesroth, emersonsklar.

That sentence was left unused. The repo stays public. No collaborators were added.

The official rule above it is different: the repository is either public, with an open-source license, or private and shared with the Amazon team. The Amazon Developer Relations accounts named in that official paragraph are knmeiss, giolaq, anishamalde, mosesroth, and emersonsklar. `chris-trag` is not in that list. The public option does not add collaborators.

## Requirements

| Requirement | Source | Status | Fix |
|---|---|---|---|
| Submit on the hackathon site during the submission period | [rules §4](https://amazonappdev2026.devpost.com/rules) | Gap | Owner joins at the site and submits the pasted draft before the deadline. |
| Alexa+ track: a working self-hosted MCP server on spec 2025-11-25 or later, Streamable HTTP. A simulated host is allowed; this repo is the server, and the host in the demo is simulated | [rules, Project Requirements 2 and the Alexa+ submission bullet](https://amazonappdev2026.devpost.com/rules) | Met | — |
| The track library is imported and called, not only named in the README | [rules, “For Alexa+, Bee, and Ring”](https://amazonappdev2026.devpost.com/rules) | Met | `src/server.js` requires `@modelcontextprotocol/sdk` and calls `McpServer` and `StreamableHTTPServerTransport`. |
| Text description of what it does | [rules, Submission Requirements](https://amazonappdev2026.devpost.com/rules) | Gap | Paste “What it does” from `docs/DEVPOST.md` into the form. |
| Public GitHub repo with source, assets, and run instructions | [rules, Submission Requirements](https://amazonappdev2026.devpost.com/rules) | Met on this branch | Owner merges this PR, then submits `https://github.com/Darren-dev141/alexa-household-constitution`. |
| Public and open source, license file present and detected | [rules, public-repo bullet](https://amazonappdev2026.devpost.com/rules) | Met | `LICENSE` is MIT. GitHub reports the license as MIT on the public repo. `package.json` `"private": true` only blocks npm publish. |
| Make the repo private and add collaborators, including `chris-trag` | The sentence quoted above. It is not the official public-or-private rule | Ignored | Leave the repo public. Add nobody. |
| Demo video under 3 minutes, project actually running, public on YouTube or Vimeo, no copyrighted music and no third-party trademarks without permission | [rules, demonstration video](https://amazonappdev2026.devpost.com/rules) | Gap | Record the script in `docs/DEVPOST.md`. Upload it public. Paste the link. No music, no logos. |
| English | [rules, Language Requirements](https://amazonappdev2026.devpost.com/rules) | Met | — |
| Product feedback: tools used, what worked, what needs work, onboarding, would you build again | [rules, Product Feedback](https://amazonappdev2026.devpost.com/rules) | Gap | Paste `docs/product-feedback.md`. |
| Name the primary track | [rules, Submission Requirements](https://amazonappdev2026.devpost.com/rules) | Gap | Select Alexa+. |
| AWS Builder mini challenge | [rules, Mini Challenges](https://amazonappdev2026.devpost.com/rules) | Not entered | No AWS service is called. Do not check this box. |
| Open Source mini challenge | [rules, Open Source](https://amazonappdev2026.devpost.com/rules) | Optional | The repo is a new public MIT project; first commit is 2026-10-13, after the window opened on 2026-08-31. Paste the Open Source block in `docs/DEVPOST.md` if you enter it. |
| Friction log (up to 10% bonus at stage 1) | [rules, Friction Log Entries and §6 Bonus Points](https://amazonappdev2026.devpost.com/rules) | Gap | Paste `docs/friction-log.md`. |
| New, or significantly updated after August 31, 2026 | [rules, New & Existing](https://amazonappdev2026.devpost.com/rules) | Met | First commit is 2026-10-13. |
| Setup instructions, and the video matches them | [rules, Functionality](https://amazonappdev2026.devpost.com/rules) | Instructions met. Video is a gap | Follow the README quickstart. Record those commands. |
| Judges can test it free of charge through November 20, 2026, 12:00 pm Pacific | [rules, Testing](https://amazonappdev2026.devpost.com/rules) | Met if the public repo stays up | Do not make it private or take it down during judging. The demo home code is `home-demo-code` in the quickstart. |
| Original work; third-party SDKs used under their licenses | [rules, Intellectual Property and Third Party Integrations](https://amazonappdev2026.devpost.com/rules) | Met in the repo | Dependencies are MIT/ISC-style npm packages declared in `package.json`. Owner confirms ownership on the form. |

## Judging

Stage 1 is pass/fail: the project fits the theme and uses the required technology. Source: [rules §6](https://amazonappdev2026.devpost.com/rules).

Stage 2 scores four criteria, weighted equally, on a 1 to 5 scale. Source: [rules §6](https://amazonappdev2026.devpost.com/rules) and the [hackathon home](https://amazonappdev2026.devpost.com/). A tie breaks on Tech Implementation, then the next criterion down.

| Criterion | What the rules ask | Where this project stands |
|---|---|---|
| Tech Implementation | How well it is built, and how it uses the required tech for the track | Met in code: MCP Streamable HTTP, the gate, receipts, owner approval, tests. Gap: no live Alexa+ device session. That needs a developer account. |
| Design | A complete experience and an interaction that fits the device | Met for the simulated host and the owner page. Gap: the video has to show that path, or judges only have the README. |
| Potential Impact | A specific customer need, and a plausible audience after the hackathon | The description in `docs/DEVPOST.md` is the case. Gap: it is not on the form until it is pasted. |
| Quality of the Idea | Creative use, not a one-shot Q&A bot or a thin MCP wrapper. The Alexa+ examples include purchasing and state across sessions | Met as a design: purchases, a promise list that survives restart, and a quiet zone that is not a tool the assistant can call. |

Friction-log bonus: up to 10%, applied by the stage 2 panel if stage 1 recommends it. Source: [rules §6](https://amazonappdev2026.devpost.com/rules).

Eligibility (age of majority, not an excluded region, not an employee of the sponsor or a judge) is confirmed by the owner on the form. Source: [rules §3](https://amazonappdev2026.devpost.com/rules).
