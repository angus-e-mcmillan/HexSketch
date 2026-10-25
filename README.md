# HexSketch

A chemical structure editor that runs in the browser: https://hexsketch.com

- Drawing tools, clicks and keyboard shortcuts that work like your favorite drawing tool.
- Copy a structure into Word, PowerPoint, Google Docs or Slides, then copy it
  back into HexSketch to edit it. The structure travels inside the picture
  (alt text and a PNG text chunk), so plain copy and paste is enough.
- IUPAC names, formula, exact mass, molecular weight, m/z and elemental
  analysis, written under the structure.
- Opens and saves CDXML and MOL; exports PNG, SVG and PDF.
- Works with AI assistants: a link such as
  `https://hexsketch.com/#smiles=CC(%3DO)Oc1ccccc1C(%3DO)O` opens a structure
  ready to edit, and Edit › Copy for AI puts the name, SMILES, formula, masses
  and a link back to the drawing on the clipboard for pasting into a chat.
  Links carry the structure after the `#`, which browsers never send to a server.

Everything runs locally in the browser. Drawings are never uploaded; the only
thing sent anywhere is what someone types into File › Send Feedback.

## Development

Needs Node 22.

```sh
npm install
npm run dev          # http://localhost:5174
npm test
npm run typecheck
npm run build:web    # static build in apps/web/dist
```

`tools/opsin/fetch.sh` downloads OPSIN (needs Java) so the naming tests can
check generated names by parsing them back. Without it those tests are skipped.

```
packages/core      molecule model, SMILES, MOL, CDXML, formula and mass, payload
packages/render    depiction to SVG and PDF
packages/editor    tools, hotkeys, undo
packages/naming    offline IUPAC naming
apps/web           the app, plus worker.ts for the feedback endpoint
```

## Deployment

The site is a Cloudflare Worker serving the static build (`apps/web/wrangler.jsonc`).
Only `/api/feedback` runs code; feedback is stored in Workers KV.

```sh
npx wrangler login
npm run deploy:web
npm run feedback     # print received feedback
```
