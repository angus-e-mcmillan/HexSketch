# HexSketch for AI agents: plan

## Vision

Chemists communicate by drawing. AI assistants communicate in text, and today
they "draw" molecules by writing SMILES and rendering a bare RDKit image that
nobody can edit, or by hand-writing SVG that is often wrong.

HexSketch becomes the drawing surface between a chemist and an AI:

- The AI proposes a structure; it opens in HexSketch, inside the chat where
  the host supports it, or one click away where it does not.
- The chemist edits it by drawing: fixes stereochemistry, moves a substituent,
  draws a reaction arrow. They can also start from a blank canvas and draw the
  question.
- The edited structure goes back to the AI as SMILES/CDXML plus its name and
  formula, so the conversation continues from what was drawn.
- Anything the AI or the chemist produces can be pasted into Word,
  PowerPoint or Google Docs and still opens for editing, as it does today.

Agents get headless tools for everything else: render a structure
(SVG/PNG/PDF/CDXML/MOL), name it, compute formula and mass, convert formats,
and check a SMILES they wrote for mistakes.

The agent tooling is free and is how chemists find HexSketch. Revenue comes
later from organizations (enterprise/self-hosted licences, embedding in lab
notebooks, a hosted API); that is out of scope for this plan.

## Guardrails: hexsketch.com keeps working for people

1. One item per branch and pull request. Nothing is merged or deployed
   without review; deploys stay manual (`npm run deploy:web`).
2. `npm test` and `npm run build:web` pass on every PR (item 0 adds CI).
3. Changes to the web app are additive: no change in behaviour for someone who
   never touches the new features.
4. The privacy promise stands: the web app makes no new network requests and
   drawings are never uploaded. Deep links use the URL fragment (`#...`),
   which browsers never send to the server. The page CSP is not loosened.
5. AI pieces live in new packages and apps (`packages/agent`, `apps/mcp`,
   `apps/mcp-worker`). The hexsketch.com Worker is not changed; a hosted
   MCP server, if deployed, is a separate Worker.
6. Steps that need the owner's accounts (npm publish, Cloudflare deploy,
   registry listings, testing in Claude Desktop) are prepared and written up
   in the PR, never done by an agent.

## Decisions

- Delivery: one branch and pull request per item; the owner reviews and merges.
- Cadence: a scheduled session picks up the next item each weekday morning (Europe/Berlin).
- Licence: source-available. Free for people and AI agents to use, including
  at work; a paid licence for embedding HexSketch in commercial products.
  Item 3 proposes the exact licence text (e.g. PolyForm Shield, BSL, or a
  custom licence) and the owner chooses before anything is published.

## Items

Status: `[ ]` not started, `[~]` PR open, `[x]` merged.

### [ ] 0. Foundations
- GitHub Actions workflow: install, `npm test`, `npm run build:web` on PRs.
- Typecheck step (`tsc --noEmit`) if the repo passes it today; otherwise note why not.
- Why: every later item is reviewed against a green check, so the site cannot break silently.

### [ ] 1. Deep links and "Copy for AI" (web app)
- `hexsketch.com/#smiles=<SMILES>` and `#cdxml=<payload>` open that structure on load.
  `#cdxml=` reuses the existing payload encoding (deflate + base64url, `HexSketch:1:`).
  Bad input shows a message and an empty canvas, never a broken page.
- Opening a link does not overwrite unsaved work silently (use the existing
  document/recent mechanism, or ask).
- Edit menu: "Copy for AI" puts plain text on the clipboard: name, SMILES,
  formula, exact mass, MW, and a deep link back to the drawing.
- Edit menu: "Copy Link" copies the deep link alone.
- A `structureLink()` helper in `packages/core` so agents and the web app build identical links.
- Why: works in every AI tool today (Claude, ChatGPT, Codex) with nothing installed.
  An agent writes a link; the chemist clicks and edits. The chemist draws; one copy puts it in the chat.

### [ ] 2. Headless agent toolkit (`packages/agent`)
- Pure functions over `core`/`render`/`naming`, each taking SMILES, MOL or CDXML:
  `render` (svg, pdf, cdxml, mol; png where a rasterizer is available),
  `name`, `analyze` (formula, exact mass, MW, m/z, elemental analysis),
  `convert`, `validate` (parse errors, valence problems, unusual charges, with
  canonical SMILES so an agent can compare against what it meant), `link`.
- PNG output embeds the HexSketch payload, so agent-made images stay editable.
- Choose a PNG rasterizer for Node (e.g. resvg WASM) and record the choice and size in the PR.
- Tests for each function, including bad input.
- Why: one tested core that the CLI, the MCP server and the hosted server all call.

### [ ] 3. Packaging and CLI
- Build `core`, `render`, `naming`, `agent` to JS with type declarations,
  publishable to npm (packages export TS source today).
- `hexsketch` CLI: `npx hexsketch render "<smiles>" -o out.svg --name`,
  plus `name`, `analyze`, `convert`, `validate`, `link`.
- A browser bundle usable from a CDN (jsdelivr/unpkg) so AI-built web pages
  and Claude artifacts can render structures.
- Source-available licence (see Decisions): the PR compares two or three
  candidate licences against the goals there and adds none until the owner picks.
- Publishing only from GitHub Actions with npm trusted publishing (provenance,
  no long-lived npm token). The PR lists the owner's setup steps, including
  two-factor auth on the npm account.
- Why: Codex, Claude Code and scripts can use HexSketch with one command.

### [ ] 4. Local MCP server (`apps/mcp`)
- stdio MCP server using the official TypeScript SDK, exposing tools
  `render_structure`, `name_structure`, `analyze_structure`,
  `convert_structure`, `validate_structure`, `structure_link`.
- Tool descriptions written for models: when to use each, input formats, and
  "always show the user the link or image".
- Every result includes canonical SMILES and name so the agent can self-check.
- Tested with the MCP Inspector or an SDK client in a test; setup instructions
  for Claude Desktop, Claude Code, Codex and Cursor.
- A Claude Desktop extension (`.mcpb`) wrapping the same server: one-click
  local install, nothing leaves the user's machine.
- Why: makes HexSketch a first-class tool in every MCP client, with no server to run.

### [ ] 5. MCP App: the drawing interface
- Tool `open_sketcher` (optional starting structure) returns an MCP Apps UI
  resource: the HexSketch editor bundled into a single self-contained HTML
  file (no CDN, so host CSPs do not block it), mounted with `mountApp`.
- "Send to AI" action returns the drawing to the model as SMILES, CDXML,
  name and formula; the AI's next proposal can be loaded back into the same view.
- Hosts without MCP Apps get the deep link instead.
- Owner tests in Claude Desktop / Claude.ai and ChatGPT; the PR gives exact steps.
- Why: this is the chemist-AI drawing loop, the core of the vision.

### [ ] 6. Claude connector (`apps/mcp-worker`)
- The same tools and the MCP App over streamable HTTP on a separate
  Cloudflare Worker (`mcp.hexsketch.com`), so it works as a connector in
  Claude (web, mobile, desktop) and in ChatGPT.
- Low risk by design: stateless, no accounts or login, no secrets, nothing
  stored or logged beyond Cloudflare's defaults; rate limited; input size and
  CPU bounded; separate from the hexsketch.com Worker.
- Structures sent by the AI pass through the Worker (not stored); the privacy
  page says so and points to the local options for users who need that.
- A privacy policy page on hexsketch.com and a connector-directory submission
  prepared for the owner to send.
- Deploy is a manual step for the owner.

### [ ] 7. Docs and distribution
- `hexsketch.com/llms.txt` and a short `/ai` page for people (static files, no code).
- A Claude skill describing how to use HexSketch for chemistry.
- README section with a demo GIF of the chemist-AI loop and one-line installs;
  listing text prepared for the MCP registry, Glama, Smithery,
  awesome-mcp-servers and awesome-cheminformatics (the owner submits).
- GitHub repo linked from npm, the listings, the `/ai` page and the app's Help
  menu ("Star on GitHub").
- Launch notes for after item 5 works: Show HN, r/chemistry, chemistry
  Bluesky/X, built around a short video of the in-chat editor.

### [ ] 8. Proof
- Naming benchmark: a public set of structures, names round-tripped through
  OPSIN, accuracy reported and reproducible.
- Depiction comparison against RDKit on the same set.
- Results published as a page; gaps found become follow-up issues.

## Working notes for scheduled sessions

- Work the first item whose status is `[ ]` and whose dependencies are merged
  (3 needs 2; 4 needs 2; 5 needs 1 and 4; 6 needs 5; 7 needs 4). If the next
  item is blocked on an unmerged PR, take the next unblocked one or stop and say so.
- Update this file's status line for the item in the same PR.
- Follow the guardrails above. Keep each PR to one item.
