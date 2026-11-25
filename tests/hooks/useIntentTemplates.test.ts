import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useIntentTemplates } from '@/hooks/useIntentTemplates';
import { saveTemplate, templateStorageKey } from '@/lib/templates/store';
import { trackFunnelEvent } from '@/lib/analytics';

vi.mock('@/lib/analytics', async (orig) => ({
  ...(await orig<typeof import('@/lib/analytics')>()),
  trackFunnelEvent: vi.fn(),
}));

const WALLET_A = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const WALLET_B = 'GAZW2PQFFJGH7RH6PB5VQASJIRAGEMZCID72CXYHRM27QYP4R5YRY777';
const LABEL = 'Rent for Mum';

const offramp = (label = LABEL, amount = '120') =>
  ({ direction: 'offramp', label, corridorId: 'usdc-ngn', amount }) as const;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(trackFunnelEvent).mockClear();
});

describe('useIntentTemplates (#2158)', () => {
  it('is empty without a wallet and refuses to save', () => {
    const { result } = renderHook(() => useIntentTemplates(null, 'offramp'));
    expect(result.current.templates).toEqual([]);
    expect(result.current.save(offramp())).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('saves, renames, updates the amount and removes', () => {
    const { result } = renderHook(() => useIntentTemplates(WALLET_A, 'offramp'));

    act(() => {
      result.current.save(offramp());
    });
    expect(result.current.templates).toHaveLength(1);
    const id = result.current.templates[0]!.id;

    act(() => {
      result.current.rename(id, 'School fees');
    });
    expect(result.current.templates[0]?.label).toBe('School fees');

    act(() => {
      result.current.updateAmount(id, '250');
    });
    expect(result.current.templates[0]?.amount).toBe('250');

    act(() => {
      expect(result.current.remove(id)).toBe(true);
    });
    expect(result.current.templates).toEqual([]);
  });

  it('lists only the requested direction', () => {
    saveTemplate(WALLET_A, offramp());
    saveTemplate(WALLET_A, {
      direction: 'onramp',
      label: 'Top up',
      corridorId: 'usdc-ngn',
      amount: '50',
    });
    const { result } = renderHook(() => useIntentTemplates(WALLET_A, 'onramp'));
    expect(result.current.templates.map((t) => t.label)).toEqual(['Top up']);
  });

  it("shows the new wallet's templates after a rerender", () => {
    saveTemplate(WALLET_A, offramp('A template'));
    saveTemplate(WALLET_B, offramp('B template'));
    const { result, rerender } = renderHook(({ pk }) => useIntentTemplates(pk, 'offramp'), {
      initialProps: { pk: WALLET_A },
    });
    expect(result.current.templates.map((t) => t.label)).toEqual(['A template']);
    rerender({ pk: WALLET_B });
    expect(result.current.templates.map((t) => t.label)).toEqual(['B template']);
  });

  it('refreshes on a storage event for its key', () => {
    const { result } = renderHook(() => useIntentTemplates(WALLET_A, 'offramp'));
    expect(result.current.templates).toEqual([]);
    saveTemplate(WALLET_A, offramp());
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: templateStorageKey(WALLET_A) }));
    });
    expect(result.current.templates).toHaveLength(1);
  });

  it('sends analytics without the label', () => {
    const { result } = renderHook(() => useIntentTemplates(WALLET_A, 'offramp'));
    act(() => {
      result.current.save(offramp());
    });
    const id = result.current.templates[0]!.id;
    act(() => {
      result.current.rename(id, 'Renamed');
    });
    act(() => {
      result.current.exportJson();
    });
    act(() => {
      result.current.remove(id);
    });

    const calls = vi.mocked(trackFunnelEvent).mock.calls;
    expect(calls.map(([name]) => name)).toEqual([
      'template_saved',
      'template_updated',
      'templates_exported',
      'template_deleted',
    ]);
    expect(calls[0]?.[1]).toEqual({
      direction: 'offramp',
      corridor: 'usdc-ngn',
      amount_bucket: expect.any(String),
    });
    for (const call of calls) {
      expect(JSON.stringify(call)).not.toContain(LABEL);
      expect(JSON.stringify(call)).not.toContain('Renamed');
    }
  });

  it('round-trips exportJson into importJson replace', () => {
    const { result } = renderHook(() => useIntentTemplates(WALLET_A, 'offramp'));
    act(() => {
      result.current.save(offramp());
    });
    const text = result.current.exportJson();
    localStorage.clear();
    let outcome: ReturnType<typeof result.current.importJson> | undefined;
    act(() => {
      outcome = result.current.importJson(text, 'replace');
    });
    expect(outcome).toEqual({ ok: true, summary: { added: 1, updated: 0, skipped: 0 } });
    expect(result.current.templates.map((t) => t.label)).toEqual([LABEL]);
    expect(vi.mocked(trackFunnelEvent).mock.calls.at(-1)?.[0]).toBe('templates_imported');
  });
});
