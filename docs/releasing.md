# Releasing the hexsketch npm package

Publishing runs from GitHub Actions (`.github/workflows/release.yml`) with npm
trusted publishing: no npm token is stored anywhere, and each release on npm
links back to the commit that built it.

## Once

1. **Legal review.** Have a lawyer read `LICENSE` (BSL 1.1 and its Additional
   Use Grant) before the first release.
2. **npm account.** Create one at npmjs.com if needed and turn on two-factor
   authentication (Account > Two-Factor Authentication, "Authorization and
   writes").
3. **Trusted publisher.** On npmjs.com, open the `hexsketch` package >
   Settings > Trusted Publisher > GitHub Actions, and enter: owner
   `angus-e-mcmillan`, repository `HexSketch`, workflow `release.yml`,
   environment `npm`.
   npm adds a trusted publisher only to a package it already has, so publish
   the first version from your own machine (`npm login`, then from the repo
   root `npm run build:pkg && npm publish -w hexsketch --access public`), then
   add the trusted publisher and use the workflow from then on. Until then,
   the workflow makes the GitHub release and skips npm with a warning; it
   also skips a version that is already on npm, so a version published by
   hand can still be tagged.
4. **Optional approval gate.** GitHub > Settings > Environments > `npm` >
   Required reviewers: a release then waits for your click before publishing.

## Each release

1. Set `"version"` in `packages/hexsketch/package.json` and merge to `main`.
2. Tag and push: `git tag v0.1.0 && git push origin v0.1.0`.
3. The Release workflow tests, builds, makes the GitHub release (with the
   Claude Desktop extension and installer) and publishes to npm. It refuses
   a tag that doesn't match the package version.
