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
  // ─── State 1: not-detected ────────────────────────────────────────────────────
  describe('not-detected state', () => {
    it('renders "Install Freighter" when isInstalled is false', () => {
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
  describe('disconnected state', () => {
    it('renders "Connect Wallet" button when installed but not connected', () => {
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

    it('does not render "Install Freighter" in disconnected state', () => {
      mockUseWallet.mockReturnValue({ ...base, isInstalled: true, isConnected: false });
      render(<WalletButton />);
      expect(screen.queryByText('Install Freighter')).not.toBeInTheDocument();
    });
  });

  // ─── State 3: wrong-network ───────────────────────────────────────────────────
  describe('wrong-network state', () => {
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
  describe('connected state', () => {
    const publicKey = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789';

    it('renders the truncated public key when connected on Mainnet', () => {
      mockUseWallet.mockReturnValue({
        ...base,
        isInstalled: true,
        isConnected: true,
        network: 'PUBLIC',
        publicKey,
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
        publicKey,
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
        publicKey,
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
        publicKey,
      });
      render(<WalletButton />);
      expect(screen.queryByText('Connect Wallet')).not.toBeInTheDocument();
    });

    describe('connected dropdown', () => {
      function renderConnected(disconnect = vi.fn()) {
        mockUseWallet.mockReturnValue({
          ...base,
          isInstalled: true,
          isConnected: true,
          publicKey,
          network: 'PUBLIC',
          disconnect,
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
        renderConnected(disconnect);
        fireEvent.click(screen.getByRole('button', { name: /GABC/ }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Disconnect' }));
        expect(disconnect).toHaveBeenCalledOnce();
      });
    });
  });
});
