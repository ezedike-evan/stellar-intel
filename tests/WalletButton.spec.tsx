import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WalletButton } from '@/components/ui/WalletButton';
import * as WalletContextModule from '@/contexts/WalletContext';

vi.mock('@/contexts/WalletContext');

const mockUseWallet = vi.mocked(WalletContextModule.useWallet);

const base = {
  isInstalled: false,
  isConnected: false,
  publicKey: null,
  network: null,
  error: null,
  connect: vi.fn(),
  disconnect: vi.fn(),
};

beforeEach(() => vi.clearAllMocks());

// ─── State 1: not-detected ────────────────────────────────────────────────────

describe('WalletButton — not-detected state', () => {
  it('renders "Install Freighter" when the extension is not installed', () => {
    mockUseWallet.mockReturnValue({ ...base, isInstalled: false });
    render(<WalletButton />);
    expect(screen.getByText('Install Freighter')).toBeInTheDocument();
  });

  it('"Install Freighter" is a link to freighter.app', () => {
    mockUseWallet.mockReturnValue({ ...base, isInstalled: false });
    render(<WalletButton />);
    const link = screen.getByRole('link', { name: 'Install Freighter' });
    expect(link).toHaveAttribute('href', 'https://freighter.app');
  });

  it('does not render "Connect Wallet" in not-detected state', () => {
    mockUseWallet.mockReturnValue({ ...base, isInstalled: false });
    render(<WalletButton />);
    expect(screen.queryByText('Connect Wallet')).not.toBeInTheDocument();
  });
});

// ─── State 2: disconnected ────────────────────────────────────────────────────

describe('WalletButton — disconnected state', () => {
  it('renders "Connect Wallet" when installed but not connected', () => {
    mockUseWallet.mockReturnValue({ ...base, isInstalled: true, isConnected: false });
    render(<WalletButton />);
    expect(screen.getByText('Connect Wallet')).toBeInTheDocument();
  });

  it('clicking "Connect Wallet" calls connect()', () => {
    const connect = vi.fn();
    mockUseWallet.mockReturnValue({ ...base, isInstalled: true, isConnected: false, connect });
    render(<WalletButton />);
    fireEvent.click(screen.getByText('Connect Wallet'));
    expect(connect).toHaveBeenCalledOnce();
  });

  it('shows an error message when the hook exposes one', () => {
    mockUseWallet.mockReturnValue({
      ...base,
      isInstalled: true,
      isConnected: false,
      error: 'Connection rejected',
    });
    render(<WalletButton />);
    expect(screen.getByText('Connection rejected')).toBeInTheDocument();
  });

  it('does not render "Install Freighter" in disconnected state', () => {
    mockUseWallet.mockReturnValue({ ...base, isInstalled: true, isConnected: false });
    render(<WalletButton />);
    expect(screen.queryByText('Install Freighter')).not.toBeInTheDocument();
  });
});

// ─── State 3: wrong-network ───────────────────────────────────────────────────

describe('WalletButton — wrong-network state', () => {
  it('renders "Wrong network" when connected on a non-PUBLIC network', () => {
    mockUseWallet.mockReturnValue({
      ...base,
      isInstalled: true,
      isConnected: true,
      network: 'TESTNET',
      publicKey: 'GABCDEF',
    });
    render(<WalletButton />);
    expect(screen.getByText('Wrong network')).toBeInTheDocument();
  });

  it('shows "Mainnet required" as the target network label', () => {
    mockUseWallet.mockReturnValue({
      ...base,
      isInstalled: true,
      isConnected: true,
      network: 'TESTNET',
    });
    render(<WalletButton />);
    expect(screen.getByText('Mainnet required')).toBeInTheDocument();
  });

  it('renders a "How to switch" link', () => {
    mockUseWallet.mockReturnValue({
      ...base,
      isInstalled: true,
      isConnected: true,
      network: 'FUTURENET',
    });
    render(<WalletButton />);
    expect(screen.getByRole('link', { name: 'How to switch' })).toBeInTheDocument();
  });

  it('does not render the public key in wrong-network state', () => {
    mockUseWallet.mockReturnValue({
      ...base,
      isInstalled: true,
      isConnected: true,
      network: 'TESTNET',
      publicKey: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789',
    });
    render(<WalletButton />);
    expect(screen.queryByText('GABC...6789')).not.toBeInTheDocument();
  });
});

// ─── State 4: connected ───────────────────────────────────────────────────────

describe('WalletButton — connected state', () => {
  it('renders the truncated public key when connected on Mainnet', () => {
    mockUseWallet.mockReturnValue({
      ...base,
      isInstalled: true,
      isConnected: true,
      network: 'PUBLIC',
      publicKey: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789',
    });
    render(<WalletButton />);
    expect(screen.getByText('GABC...6789')).toBeInTheDocument();
  });

  it('renders the "Mainnet" badge', () => {
    mockUseWallet.mockReturnValue({
      ...base,
      isInstalled: true,
      isConnected: true,
      network: 'PUBLIC',
      publicKey: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789',
    });
    render(<WalletButton />);
    expect(screen.getByText('Mainnet')).toBeInTheDocument();
  });

  it('does not render "Wrong network" when correctly connected', () => {
    mockUseWallet.mockReturnValue({
      ...base,
      isInstalled: true,
      isConnected: true,
      network: 'PUBLIC',
      publicKey: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789',
    });
    render(<WalletButton />);
    expect(screen.queryByText('Wrong network')).not.toBeInTheDocument();
  });

  it('does not render "Connect Wallet" when connected', () => {
    mockUseWallet.mockReturnValue({
      ...base,
      isInstalled: true,
      isConnected: true,
      network: 'PUBLIC',
      publicKey: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789',
    });
    render(<WalletButton />);
    expect(screen.queryByText('Connect Wallet')).not.toBeInTheDocument();
  });
});
