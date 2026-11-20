import { ImageResponse } from 'next/og';

export const alt = 'Stellar on-ramp estimates — Stellar Intel';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Deposit figures are estimates (the anchor sets the final rate inside its
// deposit window), so this card says "estimates" and never promises a rate.
export default function OnrampOpengraphImage() {
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
        On-Ramp Estimates
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
        Compare deposit estimates across Stellar anchors. The anchor sets the final rate.
      </div>
    </div>,
    { ...size }
  );
}
