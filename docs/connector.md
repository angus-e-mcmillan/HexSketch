# The HexSketch connector for Claude

`apps/mcp-worker` is HexSketch as a remote MCP server at
`https://mcp.hexsketch.com/mcp`. Added to Claude as a connector, it gives
Claude the same tools and in-chat editor as the local server, with nothing
to install.

- **Where it runs:** its own Cloudflare Worker (`hexsketch-mcp`), separate
  from the hexsketch.com Worker, so a problem here can't affect the editor.
- **What it keeps:** open editors only, in Durable Objects: one `Sketch` per
  editor and one `Conversation` per MCP session. Each deletes itself a day
  after it was last used.
- **What it doesn't have:** accounts, secrets, or logging of what is drawn.
  `apps/web/public/privacy.html` (hexsketch.com/privacy) says this for users.
- **Limits:**
  - 300 requests a minute per conversation, and 600 new conversations a
    minute per address (generous, since Claude's servers share a few);
  - 2 MB per request and 1 MB per drawing.
- **What it costs:** mostly open editors, which ask for the AI's updates:
  - every 2 s just after a change, every 5 s after 2 quiet minutes, every
    30 s after 15 and once a minute after 30;
  - every 30 s while out of sight, stopping after 10 minutes out of sight;
  - one Worker request and one Durable Object call each time.

## Deploy (by hand)

You need the Cloudflare account that hosts hexsketch.com.

- **The free plan is enough to start.** It allows 10 ms of CPU time per
  request. Most requests take far less, measured in Node:
  - an editor's check, or a structure shown in the editor: 1 to 4 ms;
  - naming a drug-sized molecule: about 5 ms.
- **What may fail on it:** a PNG (about 45 ms), or naming a large molecule
  or a whole scheme (about 20 ms). Claude then sees an error.
- **Before others use it**, move to **Workers Paid** ($5 a month). In the
  Cloudflare dashboard it is under Workers & Pages > Plans, not the
  website's Pro plan, which isn't needed.

1. In a terminal, in your HexSketch folder, get the latest code:
   `git checkout main && git pull`, then `npm ci`.
2. Deploy: `npm run deploy:mcp`. This builds the in-chat editor and uploads
   the Worker. The first time, wrangler may open the browser to log in, and
   it creates `mcp.hexsketch.com` itself.
3. Check it: `npm run smoke:mcp -- https://mcp.hexsketch.com/mcp`. Every line
   should start with `ok`, ending with `All good.`
4. Deploy hexsketch.com too (`npm run deploy:web`), so the privacy page
   (hexsketch.com/privacy) is live.
5. Add a spending alert: Cloudflare dashboard > Manage Account > Billing >
   Notifications, for example at $20, so you hear early if usage climbs.

## Add it to Claude

1. In Claude (claude.ai or the desktop app): **Settings > Connectors > Add
   custom connector**.
2. Name: `HexSketch`. URL: `https://mcp.hexsketch.com/mcp`. No other
   settings are needed (there is no login).
3. In a new chat, ask: *Open the HexSketch sketcher with ibuprofen*. If Claude
   asks whether to allow the HexSketch tools or app, allow them.

If you also installed HexSketch locally (the installer or the extension),
turn one of them off, so Claude doesn't see every tool twice.

## Try it locally

`npm run dev:mcp` serves it at `http://127.0.0.1:8787/mcp`, and
`npm run smoke:mcp` checks it there. CI runs both on every pull request.
