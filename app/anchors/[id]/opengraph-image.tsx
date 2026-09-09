import { ImageResponse } from 'next/og';
import { ANCHORS } from '@/constants';

export const alt = 'Stellar Anchor Profile — Stellar Intel';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const SURFACE = '#0b0c0e';
const FOREGROUND = '#edefec';
const SECONDARY = '#9aa0a0';
const MUTED = '#7e8587';
const ACCENT = '#63dcae';
const BORDER = '#22262b';

export default async function AnchorDetailOpengraphImage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const { id } = await params;
  const anchor = ANCHORS.find((item) => item.id.toLowerCase() === id.toLowerCase());
  const name = anchor ? anchor.name : id;
  const corridors = anchor?.corridors?.length
    ? anchor.corridors.map((c) => c.toUpperCase()).join(', ')
    : 'Stellar Corridors';
  const subtitle = anchor
    ? `Reliability score, corridor coverage (${corridors}), and live quote health.`
    : 'Public health record and reliability metrics for Stellar off-ramp anchors.';

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
          ANCHOR HEALTH RECORD · PROFILE
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontSize: 80, fontWeight: 700, color: FOREGROUND }}>
          {name}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 32,
            color: SECONDARY,
            marginTop: 16,
            lineHeight: 1.4,
            maxWidth: 960,
          }}
        >
          {subtitle}
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
        <div style={{ display: 'flex', fontSize: 26, color: ACCENT }}>
          {anchor?.homeDomain ?? anchor?.serviceDomain ?? 'Verified Anchor'}
        </div>
      </div>
    </div>,
    { ...size }
  );
}
