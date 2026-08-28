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

describe('WalletButton', () => {
  it('renders "Install Freighter" when isInstalled is false', () => {
    mockUseWallet.mockReturnValue({ ...base, isInstalled: false });
    render(<WalletButton />);
    expect(screen.getByText('Install Freighter')).toBeInTheDocument();
  });

  it('renders "Connect Wallet" button when installed but not connected', () => {
    mockUseWallet.mockReturnValue({ ...base, isInstalled: true, isConnected: false });
    render(<WalletButton />);
    expect(screen.getByText('Connect Wallet')).toBeInTheDocument();
  });

  it('clicking "Connect Wallet" calls the connect() function', () => {
    const connect = vi.fn();
    mockUseWallet.mockReturnValue({ ...base, isInstalled: true, isConnected: false, connect });
    render(<WalletButton />);
    fireEvent.click(screen.getByText('Connect Wallet'));
    expect(connect).toHaveBeenCalledOnce();
  });

  it('renders the truncated public key when connected', () => {
    mockUseWallet.mockReturnValue({
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
    mockUseWallet.mockReturnValue({
      ...base,
      isInstalled: true,
      isConnected: false,
      error: 'Please switch Freighter to Mainnet',
    });
    render(<WalletButton />);
    expect(screen.getByText('Please switch Freighter to Mainnet')).toBeInTheDocument();
  });

  describe('connected dropdown', () => {
    const publicKey = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789';

    function renderConnected() {
      mockUseWallet.mockReturnValue({
        ...base,
        isInstalled: true,
        isConnected: true,
        publicKey,
        network: 'PUBLIC',
      });
      return render(<WalletButton />);
    }

    it('opens the dropdown and shows Disconnect, Transaction history, and Stellar Expert items', () => {
      renderConnected();
      fireEvent.click(screen.getByRole('button', { name: /GABC/ }));

      expect(screen.getByRole('menuitem', { name: 'Disconnect' })).toBeInTheDocument();
      const historyLink = screen.getByRole('menuitem', { name: 'Transaction history' });
      expect(historyLink).toHaveAttribute('href', '/history');
      expect(screen.getByRole('menuitem', { name: 'View on Stellar Expert' })).toHaveAttribute(
        'href',
        expect.stringContaining(publicKey)
      );
    });

    it('calls disconnect() when the Disconnect item is clicked', () => {
      const disconnect = vi.fn();
      mockUseWallet.mockReturnValue({
        ...base,
        isInstalled: true,
        isConnected: true,
        publicKey,
        network: 'PUBLIC',
        disconnect,
      });
      render(<WalletButton />);
      fireEvent.click(screen.getByRole('button', { name: /GABC/ }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Disconnect' }));
      expect(disconnect).toHaveBeenCalledOnce();
    });
  });
});
