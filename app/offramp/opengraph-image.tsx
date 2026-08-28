import { ImageResponse } from 'next/og';

export const alt = 'USDC off-ramp rates — Stellar Intel';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OfframpOpengraphImage() {
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
        Stellar Intel
      </div>
      <div style={{ display: 'flex', fontSize: 80, fontWeight: 800, marginTop: 16 }}>
        USDC Off-Ramp Rates
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
        Live SEP-38 quotes across every integrated Stellar anchor.
      </div>
    </div>,
    { ...size }
  );
}
