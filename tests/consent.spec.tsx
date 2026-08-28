import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CONSENT_VERSION, acceptTerms, clearAcceptance, hasAcceptedTerms } from '@/lib/consent';
import { ConsentModal } from '@/components/offramp/ConsentModal';

// #741 — a one-time Terms acknowledgment before a wallet's first execution.
// Gates execution only; browsing rates is not gated, because nothing has been
// committed to.

const WALLET_A = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const WALLET_B = 'GAZW2PQFFJGH7RH6PB5VQASJIRAGEMZCID72CXYHRM27QYP4R5YRY777';

beforeEach(() => {
  localStorage.clear();
});

describe('consent storage (#741)', () => {
  it('starts unaccepted and persists after acceptance', () => {
    expect(hasAcceptedTerms(WALLET_A)).toBe(false);
    acceptTerms(WALLET_A);
    expect(hasAcceptedTerms(WALLET_A)).toBe(true);
  });

  it('is keyed by wallet, not by browser', () => {
    acceptTerms(WALLET_A);
    // Consent is given by whoever signs. A shared machine must not carry one
    // wallet's acknowledgment over to another.
    expect(hasAcceptedTerms(WALLET_B)).toBe(false);
  });

  it('treats an empty wallet address as unaccepted', () => {
    acceptTerms('');
    expect(hasAcceptedTerms('')).toBe(false);
  });

  it('re-prompts when the terms version changes', () => {
    // A stored acceptance of older wording is not acceptance of the current
    // terms. Simulates a CONSENT_VERSION bump.
    localStorage.setItem(`offramp-terms-accepted:${WALLET_A}`, '2020-01-01');
    expect(hasAcceptedTerms(WALLET_A)).toBe(false);

    acceptTerms(WALLET_A);
    expect(localStorage.getItem(`offramp-terms-accepted:${WALLET_A}`)).toBe(CONSENT_VERSION);
  });

  it('reports unaccepted when storage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    // Prompting twice is a nuisance; executing without acknowledgment is not.
    expect(hasAcceptedTerms(WALLET_A)).toBe(false);
    spy.mockRestore();
  });

  it('does not throw when storage is unwritable', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    expect(() => acceptTerms(WALLET_A)).not.toThrow();
    spy.mockRestore();
  });

  it('clears an acceptance', () => {
    acceptTerms(WALLET_A);
    clearAcceptance(WALLET_A);
    expect(hasAcceptedTerms(WALLET_A)).toBe(false);
  });
});

describe('ConsentModal (#741)', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ConsentModal open={false} onAccept={vi.fn()} onCancel={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('requires the checkbox before accepting', () => {
    const onAccept = vi.fn();
    render(<ConsentModal open onAccept={onAccept} onCancel={vi.fn()} />);

    const confirm = screen.getByRole('button', { name: /accept and continue/i });
    // Accepting must be a deliberate act, not the same motion as dismissing.
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it('links to the Terms', () => {
    render(<ConsentModal open onAccept={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('link', { name: /terms/i })).toHaveAttribute('href', '/terms');
  });

  it('cancels on Escape', () => {
    const onCancel = vi.fn();
    render(<ConsentModal open onAccept={vi.fn()} onCancel={onCancel} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('is announced as a modal dialog', () => {
    render(<ConsentModal open onAccept={vi.fn()} onCancel={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName();
  });
});
