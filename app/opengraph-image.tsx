import { ImageResponse } from 'next/og';

// OpenGraph / Twitter social-preview image for the landing route (B092 / #525).
// Next.js auto-wires this as og:image and twitter:image.
//
// This card travels further than any page on the site — it is what appears in
// every share, every link unfurl and every grant review. It was a blue gradient
// carrying "The execution layer for stablecoin off-ramps", a claim
// docs/POSITIONING.md retires by name, which made it the single furthest-
// travelling copy of a statement the project had already withdrawn.
//
// It now uses the product surface and states the thesis. Colours are inlined
// rather than read from tokens because this renders in a separate Satori
// context with no access to the stylesheet; they are the same values as the
// `.dark` block in app/globals.css and must be updated together.

export const alt = 'Stellar Intel — a public health record for Stellar off-ramp anchors';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const SURFACE = '#0b0c0e';
const FOREGROUND = '#edefec';
const SECONDARY = '#9aa0a0';
const MUTED = '#7e8587';
const ACCENT = '#63dcae';
const BORDER = '#22262b';

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px 80px',
        background: SURFACE,
        color: FOREGROUND,
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 40, height: 1, background: BORDER }} />
        <div style={{ display: 'flex', fontSize: 24, letterSpacing: 2, color: MUTED }}>
          probed every 5 minutes · 4 signals
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontSize: 86, fontWeight: 700, color: SECONDARY }}>
          What anchors say.
        </div>
        <div style={{ display: 'flex', fontSize: 86, fontWeight: 700, marginTop: 4 }}>
          What anchors did.
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          borderTop: `1px solid ${BORDER}`,
          paddingTop: 28,
        }}
      >
        <div style={{ display: 'flex', fontSize: 28, fontWeight: 700, letterSpacing: 1 }}>
          STELLAR INTEL
        </div>
        {/* The one accent on the card, on the fact that carries the argument. */}
        <div style={{ display: 'flex', fontSize: 26, color: ACCENT }}>
          1 of 7 advertise a quote server
        </div>
      </div>
    </div>,
    { ...size }
  );
}
