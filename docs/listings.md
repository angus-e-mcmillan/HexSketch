# Listings

Text for the places HexSketch is listed, ready for the owner to submit. Submit
only once `https://mcp.hexsketch.com/mcp` is deployed and works in Claude
(docs/connector.md), since every listing points to it.

## The short version

- **Name:** HexSketch
- **One line (under 100 characters):** Draw, name and check chemical structures with a chemist, in an editor inside the chat.
- **Tagline:** Chemists think in sketches. LLMs think in text. HexSketch lets chemists talk to LLMs with structures.
- **Connector URL:** `https://mcp.hexsketch.com/mcp` (streamable HTTP, no login)
- **Website:** https://hexsketch.com/ai · **Privacy:** https://hexsketch.com/privacy · **Source:** https://github.com/angus-e-mcmillan/HexSketch
- **Picture:** `docs/images/sitagliptin-scheme.png`
- **Licence:** BSL 1.1 (free to use, including at work; each version becomes Apache-2.0 after four years)
- **Categories:** science, chemistry, research, drawing

## The longer description

HexSketch puts a real chemical structure editor inside the chat. The chemist
draws and the assistant sees the drawing as it changes. The assistant answers
by drawing back in the same editor: structures, reaction schemes with
reagents above the arrow and conditions below, highlighted groups and short
notes. Related compounds are drawn the same way round, so a scheme reads like
one a chemist drew.

Behind it are tools that get the chemistry right: offline IUPAC names,
formula, exact mass, molecular weight and m/z, a check that catches mistakes
in a SMILES before the user sees it, comparison of stereoisomers, and export
to PNG, SVG, PDF, CDXML (ChemDraw) and MOL. Every structure comes with a
hexsketch.com link that opens it ready to edit.

There are no accounts. The connector keeps only the editors open in chats,
deleting each a day after it was last used, and doesn't log what is drawn.
For an offline setup, the Claude Desktop extension runs everything locally.

Tools: `open_sketcher`, `read_sketcher`, `show_in_sketcher`,
`render_structure`, `name_structure`, `analyze_structure`,
`validate_structure`, `convert_structure`, `compare_structures`,
`structure_link`.

## Where to submit

1. **Claude's connector directory (Anthropic).** Use the remote MCP server
   submission form linked from the Claude help centre. Give the longer
   description, the connector URL, the privacy page, and three example prompts
   from the README ("Things to ask"). The tools already carry the read-only and
   destructive hints that reviewers check.
2. **The official MCP Registry** (registry.modelcontextprotocol.io).
   `server.json` at the repo root is ready. Install `mcp-publisher` (see the
   registry's quickstart), then, from the repo root:
   `mcp-publisher login github`, then `mcp-publisher publish`. The name
   `io.github.angus-e-mcmillan/hexsketch` works with that GitHub login. After
   the first npm publish, add the npm package to `server.json` (`packages`)
   and `"mcpName": "io.github.angus-e-mcmillan/hexsketch"` to
   `packages/hexsketch/package.json`.
3. **Smithery** (smithery.ai): add it as a remote server by its URL, with the
   one-line description.
4. **Glama** (glama.ai/mcp/servers): it lists public GitHub repos with MCP
   servers. Find HexSketch there or add the repo, then claim it with the GitHub
   account and paste the longer description.
5. **awesome-mcp-servers** (github.com/punkpeye/awesome-mcp-servers): a pull
   request adding one line in alphabetical order to the science or biology
   and chemistry section:
   ```
   - [angus-e-mcmillan/HexSketch](https://github.com/angus-e-mcmillan/HexSketch) 📇 ☁️ 🏠 - Chemical structure editor in the chat: draw, name and check molecules and reaction schemes with the AI (offline IUPAC names, SMILES checks, CDXML/MOL/PNG).
   ```
   (📇 TypeScript, ☁️ hosted, 🏠 local; check the legend at the top of their
   README in case it has changed.)
6. **awesome-cheminformatics** (github.com/hsiaoyi0504/awesome-cheminformatics):
   a pull request under the visualization or drawing section:
   ```
   - [HexSketch](https://hexsketch.com) - Chemical structure editor in the browser with offline IUPAC naming, CDXML/MOL support and an MCP server for AI assistants.
   ```
