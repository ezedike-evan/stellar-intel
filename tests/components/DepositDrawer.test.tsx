import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DepositDrawer, toAssetAmount } from '@/components/onramp/DepositDrawer';
import type { DepositRate } from '@/types';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/stellar/sep10', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar/sep10')>('@/lib/stellar/sep10');
  return { ...actual, authenticate: vi.fn() };
});

vi.mock('@/lib/stellar/sep24', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar/sep24')>('@/lib/stellar/sep24');
  return { ...actual, startDepositFlow: vi.fn() };
});

vi.mock('@/lib/stellar/anchors', () => ({ getResolvedAnchorById: vi.fn() }));

vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  trackFunnelEvent: vi.fn(),
}));

vi.mock('@/lib/consent', () => ({ hasAcceptedTerms: vi.fn(), acceptTerms: vi.fn() }));

// The preflight and the anchor's window are driven by buttons, so each test
// decides when the wallet is ready and how the interactive step ends.
vi.mock('@/components/onramp/TrustlinePreflight', () => ({
  TrustlinePreflight: ({
    asset,
    onReady,
  }: {
    asset: { code: string; issuer: string };
    onReady: () => void;
  }) => (
    <div data-testid="preflight" data-asset={`${asset.code}:${asset.issuer}`}>
      <button onClick={onReady}>Wallet ready</button>
    </div>
  ),
}));

vi.mock('@/components/offramp/KycIframe', () => ({
  KycIframe: ({
    url,
    origin,
    onComplete,
    onCancel,
    onError,
  }: {
    url: string;
    origin: string;
    onComplete: (transactionId: string) => void;
    onCancel: () => void;
    onError: (error: Error) => void;
  }) => (
    <div data-testid="kyc-iframe" data-url={url} data-origin={origin}>
      <button onClick={() => onComplete('txn-deposit-123')}>Anchor complete</button>
      <button onClick={onCancel}>Anchor cancel</button>
      <button onClick={() => onError(new Error('Failed to load KYC iframe'))}>Anchor error</button>
    </div>
  ),
}));

import * as sep10 from '@/lib/stellar/sep10';
import * as sep24 from '@/lib/stellar/sep24';
import * as anchors from '@/lib/stellar/anchors';
import * as consent from '@/lib/consent';
import { trackFunnelEvent } from '@/lib/analytics';

const mockAuthenticate = vi.mocked(sep10.authenticate);
const mockStartDepositFlow = vi.mocked(sep24.startDepositFlow);
const mockGetResolvedAnchorById = vi.mocked(anchors.getResolvedAnchorById);
const mockHasAcceptedTerms = vi.mocked(consent.hasAcceptedTerms);
const mockAcceptTerms = vi.mocked(consent.acceptTerms);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const PUBLIC_KEY = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI';

const RATE: DepositRate = {
  anchorId: 'cowrie',
  anchorName: 'Cowrie',
  corridorId: 'usdc-ngn',
  asset: `stellar:USDC:${ISSUER}`,
  fiatAmount: 150000,
  assetAmount: 99.5,
  fee: 1,
  feeType: 'flat',
  exchangeRate: 0.00066,
  totalReceived: 98,
  source: 'sep24-fee',
  updatedAt: new Date('2026-10-25T08:00:00.000Z'),
};

const ANCHOR = { id: 'cowrie', homeDomain: 'cowrie.exchange' };

const AUTH = {
  jwt: 'test.jwt.token',
  anchorDomain: 'cowrie.exchange',
  publicKey: PUBLIC_KEY,
  expiresAt: new Date(Date.now() + 86_400_000),
};

function renderDrawer(over: Partial<React.ComponentProps<typeof DepositDrawer>> = {}) {
  const props = {
    rate: RATE,
    amount: '150000',
    publicKey: PUBLIC_KEY,
    onClose: vi.fn(),
    onDepositStarted: vi.fn(),
    ...over,
  };
  render(<DepositDrawer {...props} />);
  return props;
}

async function startAndPassPreflight() {
  fireEvent.click(screen.getByRole('button', { name: 'Start deposit' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Wallet ready' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHasAcceptedTerms.mockReturnValue(true);
  mockGetResolvedAnchorById.mockResolvedValue(ANCHOR as never);
  mockAuthenticate.mockResolvedValue(AUTH);
  mockStartDepositFlow.mockResolvedValue({
    transactionId: 'txn-deposit-123',
    depositUrl: 'https://anchor.example/deposit?token=abc',
    transferServer: 'https://transfer.cowrie.exchange',
  });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DepositDrawer (#1478)', () => {
  it('shows the rate as an estimate and never promises a receipt', () => {
    renderDrawer();

    expect(screen.getByText('Estimated credit')).toBeTruthy();
    expect(screen.getByText('≈ 98 USDC')).toBeTruthy();
    expect(screen.getByText(/Estimate only/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/you will receive/i);
  });

  it('runs preflight, SEP-10 and the interactive window, then hands the transaction over', async () => {
    const props = renderDrawer();
    await startAndPassPreflight();

    const iframe = await screen.findByTestId('kyc-iframe');
    expect(iframe.getAttribute('data-url')).toBe('https://anchor.example/deposit?token=abc');
    expect(iframe.getAttribute('data-origin')).toBe('https://anchor.example');
    expect(mockGetResolvedAnchorById).toHaveBeenCalledWith('cowrie');
    expect(mockAuthenticate).toHaveBeenCalledWith(ANCHOR, PUBLIC_KEY);
    expect(mockStartDepositFlow).toHaveBeenCalledWith(
      ANCHOR,
      {
        jwt: 'test.jwt.token',
        assetCode: 'USDC',
        assetIssuer: ISSUER,
        // SEP-24 wants asset units (what the fiat buys), not the fiat amount shown to the user.
        amount: '99.5',
        account: PUBLIC_KEY,
      },
      expect.any(AbortSignal)
    );

    fireEvent.click(screen.getByRole('button', { name: 'Anchor complete' }));

    await waitFor(() =>
      expect(props.onDepositStarted).toHaveBeenCalledWith(
        'txn-deposit-123',
        'https://transfer.cowrie.exchange',
        'test.jwt.token',
        'cowrie.exchange'
      )
    );
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('checks the wallet for the row’s asset', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Start deposit' }));

    const preflight = await screen.findByTestId('preflight');
    expect(preflight.getAttribute('data-asset')).toBe(`USDC:${ISSUER}`);
  });

  it('does not authenticate or open the deposit before the preflight is ready', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Start deposit' }));
    await screen.findByTestId('preflight');

    expect(mockAuthenticate).not.toHaveBeenCalled();
    expect(mockStartDepositFlow).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Wallet ready' }));
    await waitFor(() => expect(mockStartDepositFlow).toHaveBeenCalledTimes(1));
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
  });

  it('returns to idle when the user cancels in the anchor’s window', async () => {
    const props = renderDrawer();
    await startAndPassPreflight();
    await screen.findByTestId('kyc-iframe');

    fireEvent.click(screen.getByRole('button', { name: 'Anchor cancel' }));

    await screen.findByRole('button', { name: 'Start deposit' });
    expect(screen.queryByTestId('kyc-iframe')).toBeNull();
    expect(props.onDepositStarted).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('returns to idle when the user cancels during the preflight', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Start deposit' }));
    await screen.findByTestId('preflight');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel deposit' }));

    await screen.findByRole('button', { name: 'Start deposit' });
    expect(mockStartDepositFlow).not.toHaveBeenCalled();
  });

  it('returns to idle when the wallet rejects the SEP-10 signature', async () => {
    mockAuthenticate.mockRejectedValue(new Error('User rejected the request'));
    renderDrawer();
    await startAndPassPreflight();

    await screen.findByRole('button', { name: 'Start deposit' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a non-retryable error for a Freighter network mismatch', async () => {
    mockAuthenticate.mockRejectedValue(new sep10.NetworkMismatchError('PUBLIC', 'TESTNET'));
    renderDrawer();
    await startAndPassPreflight();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Switch network in Freighter to PUBLIC');
    // The header X and the error action both close the drawer; neither retries.
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(mockStartDepositFlow).not.toHaveBeenCalled();
  });

  it('classifies any other failure and offers a retry', async () => {
    mockStartDepositFlow.mockRejectedValue(new Error('Anchor returned HTTP 500'));
    renderDrawer();
    await startAndPassPreflight();

    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('asks for the Terms first and starts only after they are accepted', async () => {
    mockHasAcceptedTerms.mockReturnValue(false);
    // The real acceptTerms persists the acknowledgement; the mock has to do so too.
    mockAcceptTerms.mockImplementation(() => mockHasAcceptedTerms.mockReturnValue(true));
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Start deposit' }));

    const checkbox = await screen.findByRole('checkbox');
    expect(screen.queryByTestId('preflight')).toBeNull();
    expect(mockGetResolvedAnchorById).not.toHaveBeenCalled();

    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: /accept|continue|agree/i }));

    await screen.findByTestId('preflight');
    expect(mockAcceptTerms).toHaveBeenCalledWith(PUBLIC_KEY);
  });

  it('shows an error instead of starting when the estimate has no asset amount', async () => {
    const { assetAmount: _unused, ...withoutAmount } = RATE;
    renderDrawer({ rate: withoutAmount });
    await startAndPassPreflight();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBeTruthy();
    expect(mockStartDepositFlow).not.toHaveBeenCalled();
  });
});

describe('DepositDrawer analytics (#1491)', () => {
  const track = vi.mocked(trackFunnelEvent);

  it('records the deposit starting once the anchor window opens, and not before', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Start deposit' }));
    await screen.findByTestId('preflight');
    expect(track).not.toHaveBeenCalledWith('onramp_deposit_started', expect.anything());

    fireEvent.click(screen.getByRole('button', { name: 'Wallet ready' }));
    await screen.findByTestId('kyc-iframe');

    expect(track).toHaveBeenCalledWith('onramp_deposit_started', {
      direction: 'onramp',
      corridor: 'usdc-ngn',
      anchor: 'cowrie',
      amount_bucket: '1000+',
    });
  });

  it('never sends the raw amount or the account', async () => {
    renderDrawer();
    await startAndPassPreflight();
    await screen.findByTestId('kyc-iframe');

    const sent = JSON.stringify(track.mock.calls);
    expect(sent).not.toContain('150000');
    expect(sent).not.toContain(PUBLIC_KEY);
  });

  it('records nothing when the deposit is cancelled before the window opens', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Start deposit' }));
    await screen.findByTestId('preflight');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel deposit' }));
    await screen.findByRole('button', { name: 'Start deposit' });

    expect(track).not.toHaveBeenCalledWith('onramp_deposit_started', expect.anything());
  });
});

describe('toAssetAmount', () => {
  it('formats to seven decimals and drops trailing zeros', () => {
    expect(toAssetAmount(100)).toBe('100');
    expect(toAssetAmount(99.5)).toBe('99.5');
    expect(toAssetAmount(0.12345678)).toBe('0.1234568');
    expect(toAssetAmount(10)).toBe('10');
  });

  it('rejects a missing or non-positive amount', () => {
    expect(() => toAssetAmount(undefined)).toThrow();
    expect(() => toAssetAmount(0)).toThrow();
    expect(() => toAssetAmount(Number.NaN)).toThrow();
  });
});
