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

Checked November 2026. The Claude connector directory was submitted in
November 2026 (status: claude.ai/directory/manage; mcp-review@anthropic.com).

### 1. The official MCP Registry

Free and not reviewed. Glama, mcp.directory and PulseMCP copy from it, so do
it first. `.github/workflows/publish-mcp.yml` publishes `server.json`, with
GitHub proving to the registry that the repo is ours (no token, no login).

1. Merge the branch with that workflow into `main` (the Actions tab only
   offers to run workflows that are on `main`).
2. github.com/angus-e-mcmillan/HexSketch › **Actions** › **Publish to MCP
   Registry** › **Run workflow** › branch `main` › **Run workflow**.
3. When it's green, check
   `https://registry.modelcontextprotocol.io/v0.1/servers?search=hexsketch`.

From then on it runs on every version tag (`v0.1.9`, ...), alongside
`release.yml`, with the version from `packages/hexsketch/package.json`. The
registry takes each version once, so a re-run of the same version fails;
that's harmless. After the first npm publish, add the npm package to
`server.json` (`packages`) and `"mcpName": "io.github.angus-e-mcmillan/hexsketch"`
to `packages/hexsketch/package.json`.

### 2. Claude's connector directory (Anthropic)

Done. Give the longer description, the connector URL, the privacy page and
three prompts from the README ("Things to ask").

### 3. Directory sites

Each needs a browser and a sign-in (GitHub where offered). Use the texts from
"The short version" and "The longer description" above.

- **Glama** (glama.ai/mcp/servers). It picks up the registry entry and public
  GitHub repos within a day or so. Search "HexSketch"; if it isn't there,
  **Add Server** and paste the repo URL. Sign in with GitHub and **Claim**
  it: `glama.json` at the repo root names the maintainer, which is how Glama
  checks the claim. Then edit the description and categories (Science,
  Chemistry). Glama also lists remote connectors (glama.ai/mcp/connectors):
  add `https://mcp.hexsketch.com/mcp` there too, so it's scored. Copy the
  score badge Glama shows (Markdown) for the awesome list below.
- **Smithery** (smithery.ai). Sign in with GitHub › **Publish server** ›
  choose the URL (remote) option › `https://mcp.hexsketch.com/mcp`. Smithery
  connects to read the tools; no login needed as the server has none. Set
  the name and the one-line description.
- **mcp.so**. Sign in › **Submit** › paste the repo URL; reviewed before it
  goes live. Skip the paid "featured" option.
- **mcpservers.org/submit**. Free form: name, repo URL, one-line description,
  category (Science or Other). Skip the paid option.
- **mcp.directory**. **Submit**, paste the repo URL.
- **PulseMCP** is closed to submissions; it takes servers from the registry.

### 4. Awesome lists (pull requests)

Easiest in the browser: open the "edit" link, GitHub forks the list for you,
paste the line in the place given, **Commit changes** › **Propose changes** ›
**Create pull request**.

**awesome-mcp-servers** (for servers with a public repo).
Edit: github.com/punkpeye/awesome-mcp-servers/edit/main/README.md. In
*Biology, Medicine and Bioinformatics* (find `name="bio"`), add after the
`ammawla/encode-toolkit` line (alphabetical):
```
- [angus-e-mcmillan/HexSketch](https://github.com/angus-e-mcmillan/HexSketch) 📇 ☁️ 🏠 🍎 🪟 🐧 - Chemical structure editor inside the chat: the AI sees what you draw and draws back molecules, reaction schemes and mechanisms, with offline IUPAC names, SMILES checks and CDXML/MOL/PNG export.
```
Once Glama lists HexSketch, put its badge between the link and 📇, as the
other entries do; the maintainers merge those first. PR title:
`Add HexSketch`. PR text: "Adds HexSketch, a chemical structure editor MCP
server (hosted and local). Glama: <link to the Glama page>."

**awesome-remote-mcp-servers** (for hosted URLs).
Edit: github.com/punkpeye/awesome-remote-mcp-servers/edit/main/README.md. In
*Science & Research* (find `name="science--research"`), add after the
`FERS: structural finite-element analysis` entry and before `Ithy Research
Library`:
```
- [HexSketch](https://hexsketch.com/ai) `https://mcp.hexsketch.com/mcp`
  🔓 - Chemical structure editor in the chat: draw molecules, reaction schemes and mechanisms with the AI; offline IUPAC names, SMILES checks, CDXML/MOL export.
```
Once Glama lists the connector, add its badge as a line between those two,
indented two spaces, as the other entries do.

**awesome-cheminformatics**.
Edit: github.com/hsiaoyi0504/awesome-cheminformatics/edit/master/README.md.
Under *Applications › Visualization*, add after the `DataWarrior` line:
```
* [HexSketch](https://hexsketch.com) - Chemical structure editor in the browser with offline IUPAC naming, CDXML/MOL support and an MCP server that lets AI assistants draw structures and reaction schemes.
```

### 5. Reddit

r/mcp and r/ClaudeAI for the MCP side, alongside the chemistry subreddits in
docs/launch.md. Lead with the demo video.
