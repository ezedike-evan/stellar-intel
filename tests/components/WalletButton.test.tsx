import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WalletButton } from '@/components/ui/WalletButton';
import * as useFreighterModule from '@/hooks/useFreighter';

vi.mock('@/hooks/useFreighter');

const mockUseFreighter = vi.mocked(useFreighterModule.useFreighter);

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

describe('WalletButton', () => {
  it('renders "Install Freighter" when isInstalled is false', () => {
    mockUseFreighter.mockReturnValue({ ...base, isInstalled: false });
    render(<WalletButton />);
    expect(screen.getByText('Install Freighter')).toBeInTheDocument();
  });

  it('renders "Connect Wallet" button when installed but not connected', () => {
    mockUseFreighter.mockReturnValue({ ...base, isInstalled: true, isConnected: false });
    render(<WalletButton />);
    expect(screen.getByText('Connect Wallet')).toBeInTheDocument();
  });

  it('clicking "Connect Wallet" calls the connect() function', () => {
    const connect = vi.fn();
    mockUseFreighter.mockReturnValue({ ...base, isInstalled: true, isConnected: false, connect });
    render(<WalletButton />);
    fireEvent.click(screen.getByText('Connect Wallet'));
    expect(connect).toHaveBeenCalledOnce();
  });

  it('renders the truncated public key when connected', () => {
    mockUseFreighter.mockReturnValue({
      ...base,
      isInstalled: true,
      isConnected: true,
      publicKey: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789',
      network: 'PUBLIC',
    });
    render(<WalletButton />);
    expect(screen.getByText('GABC...6789')).toBeInTheDocument();
    expect(screen.getByText('Mainnet')).toBeInTheDocument();
  });

  it('renders the error message when the hook exposes an error', () => {
    mockUseFreighter.mockReturnValue({
      ...base,
      isInstalled: true,
      isConnected: false,
      error: 'Please switch Freighter to Mainnet',
    });
    render(<WalletButton />);
    expect(screen.getByText('Please switch Freighter to Mainnet')).toBeInTheDocument();
  });
});
