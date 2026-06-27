import { ImageResponse } from 'next/og';

// OpenGraph / Twitter social-preview image for the landing route (B092 / #525).
// Next.js auto-wires this as og:image and twitter:image.

export const alt = 'Stellar Intel — Real-time rate comparison on Stellar';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '80px',
        background: 'linear-gradient(135deg, #0b1020 0%, #111a3a 55%, #1b2a6b 100%)',
        color: '#ffffff',
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          fontSize: 30,
          letterSpacing: 6,
          textTransform: 'uppercase',
          color: '#8fb0ff',
        }}
      >
        Stellar Network
      </div>
      <div style={{ display: 'flex', fontSize: 92, fontWeight: 800, marginTop: 16 }}>
        Stellar Intel
      </div>
      <div
        style={{
          display: 'flex',
          fontSize: 40,
          marginTop: 24,
          maxWidth: 900,
          color: '#c7d2fe',
          lineHeight: 1.3,
        }}
      >
        Real-time rate comparison for off-ramps, on-ramps, yield, and swaps.
      </div>
    </div>,
    { ...size }
  );
}
