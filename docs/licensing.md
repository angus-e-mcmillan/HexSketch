# Licence for the published package: options

Nothing is published until the owner picks one; `packages/hexsketch` stays
`"private": true` until then. This is a comparison to decide from, not legal
advice: have whichever licence is chosen read by a lawyer before the first
release.

## What the licence has to do (from the plan)

1. Free for people and AI agents to use, **including at work** (a chemist at a
   pharma company running it through Claude is the main audience).
2. **A paid licence for embedding** HexSketch in commercial products (lab
   notebooks, data platforms, a competitor's sketcher, a hosted API resold).
3. Source visible on GitHub, so people can read, star and contribute.
4. Accepted where the package needs to be listed: npm, MCP registries,
   connector directories.

## Candidates

| | Free use at work | Stops unpaid embedding | Well known | Becomes open source |
|---|---|---|---|---|
| **BSL 1.1** with an Additional Use Grant | Yes, via the grant | Yes, via the grant's wording | Yes (MariaDB, Sentry, CockroachDB, HashiCorp) | Yes, on a Change Date (e.g. Apache-2.0 after 4 years) |
| **PolyForm Shield 1.0** | Yes | Only products that *compete* with HexSketch; an ELN embedding it may not count | Moderately | No |
| **Elastic License 2.0** | Yes | No: it forbids offering it as a managed service, not embedding | Yes (Elastic) | No |
| PolyForm Noncommercial 1.0 | **No**: bars commercial use, so pharma chemists couldn't use it | Yes | Moderately | No |
| MIT / Apache-2.0 | Yes | **No** | Yes | Already is |

## Recommendation: BSL 1.1

- **Additional Use Grant** (the part that makes everyday use free), along the
  lines of: *"You may use the Licensed Work for any purpose, including
  commercial purposes, except distributing it, or making it available as a
  hosted service, as part of a product or service offered to third parties."*
  Using HexSketch, the CLI, the MCP server or the connector, at work or not, is
  covered. Building it into something you sell or host for others needs a
  commercial licence.
- **Change Date**: four years after each release. **Change Licence**:
  Apache-2.0. Old versions become open source over time, which reassures
  adopters and keeps the newest work protected.
- Scope: the npm package, MCP server and connector code. The web app at
  hexsketch.com can carry the same licence for consistency.

Trade-offs to accept:
- BSL isn't an OSI open-source licence. A few curated lists and some companies'
  policies only accept OSI licences. npm, MCP registries and Claude's connector
  directory don't require one.
- Contributions: outside contributors would need to agree that their code can
  be sold under the commercial licence, usually through a short contributor
  licence agreement (CLA). Decide before accepting the first outside PR.

## After choosing

1. Add `LICENSE` at the repo root (and in `packages/hexsketch`) with the
   chosen text and parameters.
2. In `packages/hexsketch/package.json`: set `"license"` (`"BUSL-1.1"` for
   BSL) and remove `"private": true`.
3. Follow `docs/releasing.md`.
