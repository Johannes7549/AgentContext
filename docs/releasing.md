# Releasing

All public packages share one version (fixed versioning):
`@agentcontext/{shared,tokenization,strategies,storage,retrieval,observability,core,mcp-server}`.
`@agentcontext/benchmarks` and `@agentcontext/examples` are private.

## One-time setup

1. Create the free npm organization **`agentcontext`** at npmjs.com.
2. Create an npm **automation token** with publish rights to it.
3. Add it to the GitHub repository as the secret **`NPM_TOKEN`**
   (Settings → Secrets and variables → Actions).

## Release steps

```sh
node scripts/set-version.mjs 0.2.0          # bump every published package
# update CHANGELOG.md and add docs/releases/v0.2.0.md
pnpm install                                 # refresh the lockfile
node scripts/check-release.mjs 0.2.0         # versions, notes, changelog
pnpm check && pnpm bench && node scripts/pack-test.mjs
git commit -am "Release v0.2.0"
git tag v0.2.0
git push origin main v0.2.0                  # triggers .github/workflows/release.yml
```

The release workflow re-runs every check, the benchmark gate, the pack and
clean-install test and a production dependency audit, then publishes to npm
with provenance and creates the GitHub release with the notes and the
benchmark report attached.

## What the pack test verifies

`scripts/pack-test.mjs` packs every published package and checks that:

- tarballs contain no source, tests, source maps, build info or data files;
- each has a LICENSE and README, and no `workspace:` dependency specifiers;
- `npm install` of the tarballs into an empty project succeeds;
- the installed TypeScript API works and the installed MCP server starts,
  reports the package version and lists its tools.
