# Anchor Logo Assets

Per-anchor logo files live in this directory and are resolved by anchor id:

```text
public/anchors/{anchor-id}.svg
```

For example, the `moneygram` anchor id resolves to
`public/anchors/moneygram.svg` and is served at `/anchors/moneygram.svg`.

## Requirements

- Use the exact `id` from `constants/anchors.ts` as the filename.
- Preferred format: SVG with a square viewBox.
- Canvas size: 128 x 128 px minimum, 512 x 512 px maximum.
- Keep artwork centered with transparent padding so it works inside a circular
  mask.
- Do not include remote image references, scripts, animation, or embedded fonts.

When a logo file is missing or fails to load, `AnchorLogo` renders a clean
initial-letter fallback from the anchor name.
