# Live-anchor tests

Specs here talk to real anchors over the real network.

- Name them `<name>.live.spec.ts`; only that pattern is collected.
- They run in the `live-anchors` vitest project (`npm run test:live`), on the
  schedule in `.github/workflows/live-anchor-checks.yml`.
- `npm test` never runs them: the `unit` project excludes this directory, so an
  anchor being down cannot fail a merge.
