# Brand assets

Canonical Stellar Intel brand assets. All source files live here; derived
raster assets (PNG at the exact sizes GitHub, X, and OpenGraph expect) are
regenerated from these sources.

## Inventory

| File | Size | Purpose |
|------|------|---------|
| `social-preview.svg` | 1280 × 640 | GitHub **Settings → Social preview** image. Source of truth. |
| `social-preview.png` | 1280 × 640 | PNG export uploaded to GitHub. Regenerate after every SVG edit. |
| `og.png` _(planned)_ | 1200 × 630 | OpenGraph card for blog posts and link previews. |
| `x-card.png` _(planned)_ | 1200 × 1200 | Square X / Twitter card variant. |
| `wordmark-light.svg` _(planned)_ | — | Wordmark on light backgrounds. |
| `wordmark-dark.svg` _(planned)_ | — | Wordmark on dark backgrounds. |
| `favicon-*.png` _(planned)_ | 16/32/180/192/512 | Favicon set referenced from `app/layout.tsx`. |

## Regenerating the GitHub social preview

```bash
# Option A: rsvg-convert (preferred — exact DPI, sharp gradients).
rsvg-convert -o public/brand/social-preview.png \
  -w 1280 -h 640 public/brand/social-preview.svg

# Option B: inkscape (fallback; matches above).
inkscape public/brand/social-preview.svg \
  --export-type=png --export-width=1280 --export-height=640 \
  --export-filename=public/brand/social-preview.png
```

Then upload via GitHub → **Settings → Social preview → Upload an image**.

## Design tokens

- Background: linear gradient `#0b1020 → #17204a`
- Accent: linear gradient `#7c5cff → #3ad29f`
- Body text: `#cfd6ff`
- Muted text: `#aab1d9`
- Chip outline: `#33407a` on `#1a2350`

Keep these consistent across every brand asset. When introducing a new
asset, reuse the tokens above rather than sampling colours by eye.
