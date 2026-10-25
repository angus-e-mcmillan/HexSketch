# Licensing

**Decided:** Business Source License 1.1 for the whole repository (`LICENSE`),
with each version changing to Apache-2.0 four years after it is first
published. The link and picture-payload format, its spec and the code that
reads and writes it are MIT (`LICENSE-MIT`), so any tool can make and read
HexSketch links and pictures. Fonts keep their own licence (SIL OFL 1.1).

The Additional Use Grant in `LICENSE` makes everyday use free, commercial and
inside companies included. Distributing HexSketch, or hosting it, as part of a
product or service offered to others needs a commercial licence. This is not
legal advice: have a lawyer read `LICENSE` before the first npm release.

Still open: a contributor licence agreement (CLA), needed before accepting
outside contributions so they can be included in commercial licences.

The comparison the decision was made from follows.

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
