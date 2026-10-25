import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TrustlinePreflight } from '@/components/onramp/TrustlinePreflight';
import * as horizon from '@/lib/stellar/horizon';
import { UserRejectedError } from '@/lib/stellar/errors';

vi.mock('@/lib/stellar/horizon', () => ({
  checkDepositPreflight: vi.fn(),
  buildChangeTrustTx: vi.fn(),
  signAndSubmitPayment: vi.fn(),
}));

const PUBLIC_KEY = 'GAI2X6XPCRM47DBZTMNQQHTFDR6E4LNY7XQDJ7T6GJL3DPEEQB3HSNVB';
const ASSET = { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' };

const check = vi.mocked(horizon.checkDepositPreflight);
const build = vi.mocked(horizon.buildChangeTrustTx);
const submit = vi.mocked(horizon.signAndSubmitPayment);

const ready = {
  accountExists: true,
  hasTrustline: true,
  trustlineAuthorized: true,
  balance: '10.0000000',
};
const noTrustline = {
  accountExists: true,
  hasTrustline: false,
  trustlineAuthorized: null,
  balance: null,
};
const noAccount = {
  accountExists: false,
  hasTrustline: false,
  trustlineAuthorized: null,
  balance: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  build.mockResolvedValue({} as Awaited<ReturnType<typeof horizon.buildChangeTrustTx>>);
  submit.mockResolvedValue({} as Awaited<ReturnType<typeof horizon.signAndSubmitPayment>>);
});

function renderGate(onReady = vi.fn(), asset = ASSET) {
  render(<TrustlinePreflight publicKey={PUBLIC_KEY} asset={asset} onReady={onReady} />);
  return onReady;
}

describe('TrustlinePreflight', () => {
  it('(a) shows a checking state while the preflight is in flight', async () => {
    let finish: (value: typeof ready) => void = () => {};
    check.mockReturnValue(new Promise((resolve) => (finish = resolve)));

    renderGate();

    expect(screen.getByText(/checking your wallet/i)).toBeTruthy();
    finish(ready);
    await screen.findByText(/ready to receive USDC/i);
  });

  it('(b) asks an unfunded wallet to be funded, with a Retry that re-checks', async () => {
    check.mockResolvedValueOnce(noAccount).mockResolvedValueOnce(ready);
    const onReady = renderGate();

    await screen.findByText(
      "This wallet isn't active on Stellar yet. Fund it with at least 1.5 XLM from an exchange or another wallet, then retry."
    );
    expect(onReady).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('(c) offers to add the trustline when it is missing', async () => {
    check.mockResolvedValue(noTrustline);
    renderGate();

    await screen.findByText('Your wallet needs a trustline for USDC before it can receive it.');
    expect(screen.getByRole('button', { name: 'Add USDC trustline' })).toBeTruthy();
  });

  it('(c) builds, signs and submits the trustline, then re-checks and becomes ready', async () => {
    check.mockResolvedValueOnce(noTrustline).mockResolvedValueOnce(ready);
    const onReady = renderGate();

    fireEvent.click(await screen.findByRole('button', { name: 'Add USDC trustline' }));

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(build).toHaveBeenCalledWith({
      sourcePublicKey: PUBLIC_KEY,
      assetCode: 'USDC',
      assetIssuer: ASSET.issuer,
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('(c) a Freighter rejection returns to the prompt without an error banner', async () => {
    check.mockResolvedValue(noTrustline);
    submit.mockRejectedValue(new UserRejectedError());
    renderGate();

    fireEvent.click(await screen.findByRole('button', { name: 'Add USDC trustline' }));

    await waitFor(() => expect(submit).toHaveBeenCalled());
    await screen.findByRole('button', { name: 'Add USDC trustline' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('(c) any other failure to add the trustline is shown, and the button stays', async () => {
    check.mockResolvedValue(noTrustline);
    submit.mockRejectedValue(new Error('tx_insufficient_balance'));
    renderGate();

    fireEvent.click(await screen.findByRole('button', { name: 'Add USDC trustline' }));

    expect((await screen.findByRole('alert')).textContent).toContain('tx_insufficient_balance');
    expect(screen.getByRole('button', { name: 'Add USDC trustline' })).toBeTruthy();
  });

  it('(d) explains an unauthorised trustline and offers no action', async () => {
    check.mockResolvedValue({ ...ready, trustlineAuthorized: false });
    const onReady = renderGate();

    await screen.findByText("The issuer hasn't authorised your USDC trustline yet.");
    expect(screen.queryByRole('button')).toBeNull();
    expect(onReady).not.toHaveBeenCalled();
  });

  it('(e) calls onReady exactly once when the wallet is ready', async () => {
    check.mockResolvedValue(ready);
    const onReady = renderGate();

    await screen.findByText(/ready to receive USDC/i);
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('re-checks when the asset changes, and calls onReady again for the new asset', async () => {
    check.mockResolvedValue(ready);
    const onReady = vi.fn();
    const { rerender } = render(
      <TrustlinePreflight publicKey={PUBLIC_KEY} asset={ASSET} onReady={onReady} />
    );
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));

    rerender(
      <TrustlinePreflight
        publicKey={PUBLIC_KEY}
        asset={{ code: 'NGNC', issuer: ASSET.issuer }}
        onReady={onReady}
      />
    );

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(2));
    expect(check).toHaveBeenLastCalledWith(PUBLIC_KEY, { code: 'NGNC', issuer: ASSET.issuer });
  });

  it('shows a retryable message when the check itself fails', async () => {
    check.mockRejectedValueOnce(new Error('Horizon unreachable')).mockResolvedValueOnce(ready);
    const onReady = renderGate();

    await screen.findByText(/Horizon unreachable/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
  });

  it('keeps its state text in a polite live region', async () => {
    check.mockResolvedValue(noTrustline);
    renderGate();

    const text = await screen.findByText(/needs a trustline for USDC/);
    expect(text.closest('[aria-live="polite"]')).not.toBeNull();
  });
});
