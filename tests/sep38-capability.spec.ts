import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { ANCHORS, CORRIDORS } from '@/constants';

// #720 — can any registered anchor serve a SEP-38 firm quote for USDC→NGN?
//
// The answer is captured from a live probe rather than asserted, and the
// capture is committed so the answer has a date on it. Regenerate with
// `npx tsx scripts/probe-sep38.mts --write-fixture`.
//
// Nothing here touches the network: a third-party anchor must never be able to
// red the main branch. The live probe runs on demand and in nightly.

interface Capture {
  capturedAt: string;
  answer: string;
  anchors: Record<
    string,
    {
      homeDomain: string;
      tomlHttp: number | null;
      anchorQuoteServer: string | null;
      sep38Assets?: string[];
    }
  >;
}

const capture = JSON.parse(
  readFileSync('tests/fixtures/sep38/capability-capture.json', 'utf8')
) as Capture;

describe('SEP-38 capability capture (#720)', () => {
  it('covers every registered anchor', () => {
    // A capture that silently skips an anchor would answer the wrong question.
    const captured = Object.keys(capture.anchors).sort();
    expect(captured).toEqual(ANCHORS.map((a) => a.id).sort());
  });

  it('records when it was taken', () => {
    expect(Number.isNaN(Date.parse(capture.capturedAt))).toBe(false);
  });

  it('records that USDC→NGN has no firm-quote anchor', () => {
    const ngnAnchors = ANCHORS.filter((a) => a.corridors.includes('usdc-ngn')).map((a) => a.id);
    expect(ngnAnchors.length).toBeGreaterThan(0);

    // The finding: all three NGN anchors are reachable and serve transfer
    // rails, but none advertises ANCHOR_QUOTE_SERVER. So the USDC→NGN demo
    // cannot use a firm quote — it is indicative pricing or nothing (#789).
    for (const id of ngnAnchors) {
      expect(capture.anchors[id]?.tomlHttp).toBe(200);
      expect(capture.anchors[id]?.anchorQuoteServer).toBeNull();
    }
  });

  it('identifies zeam as the only SEP-38 anchor, serving BRL', () => {
    const capable = Object.entries(capture.anchors).filter(([, a]) => a.anchorQuoteServer);
    expect(capable.map(([id]) => id)).toEqual(['zeam']);

    const assets = capture.anchors['zeam']?.sep38Assets ?? [];
    expect(assets.some((a) => a.includes('BRL'))).toBe(true);
    // Not NGN, and — despite the registry listing zeam on usdc-zar — not ZAR.
    expect(assets.some((a) => a.includes('NGN'))).toBe(false);
    expect(assets.some((a) => a.includes('ZAR'))).toBe(false);
  });
});

describe('registry reflects the probe (#720)', () => {
  it('marks zeam as sep38-capable', () => {
    const zeam = ANCHORS.find((a) => a.id === 'zeam');
    // The `seps` array omitted sep38 even though the TOML advertised a quote
    // server, so nothing downstream could route a firm quote to it.
    expect(zeam?.seps ?? []).toContain('sep38');
  });

  it('marks no other anchor as sep38-capable', () => {
    const claiming = ANCHORS.filter((a) => a.seps?.includes('sep38')).map((a) => a.id);
    expect(claiming).toEqual(['zeam']);
  });

  it('has a corridor for the only firm-quote asset pair', () => {
    // zeam's SEP-38 offers BRL, and usdc-brl is a configured corridor — so
    // #789's firm-quote path has somewhere real to run, just not on NGN.
    expect(CORRIDORS.map((c) => c.id)).toContain('usdc-brl');
  });
});
