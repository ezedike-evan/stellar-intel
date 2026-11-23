import { describe, it, expect, vi } from 'vitest';
import {
  submitDispute,
  DisputeSubmitError,
  type SubmitDisputeInput,
} from '@/lib/reputation/dispute-client';
import { DISPUTE_CATEGORY_LABELS } from '@/lib/reputation/dispute-ladder';

describe('dispute-client — submitDispute (#2135)', () => {
  const baseInput: SubmitDisputeInput = {
    intentHash: 'a'.repeat(64),
    publicKey: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    signature: 'valid_sig_base64',
    anchorId: 'moneygram',
    category: 'delayed',
    notes: 'Transfer took over 24 hours',
  };

  it('posts the right body and returns { id, ref } on 201', async () => {
    let capturedUrl = '';
    let capturedOptions: RequestInit | undefined;

    const mockFetch = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        status: 201,
        json: async () => ({
          id: '12345678-1234-1234-1234-123456789abc',
          ref: 'abcdef0123456789',
        }),
      } as Response;
    });

    const result = await submitDispute(baseInput, mockFetch as unknown as typeof fetch);

    expect(capturedUrl).toBe('/api/reputation/dispute');
    expect(capturedOptions?.method).toBe('POST');
    expect(capturedOptions?.headers).toEqual({ 'Content-Type': 'application/json' });

    const sentBody = JSON.parse(capturedOptions?.body as string);
    expect(sentBody).toEqual({
      intentHash: baseInput.intentHash,
      publicKey: baseInput.publicKey,
      signature: baseInput.signature,
      anchorId: baseInput.anchorId,
      category: 'delayed',
      reason: 'Transfer took over 24 hours',
    });

    expect(result).toEqual({
      id: '12345678-1234-1234-1234-123456789abc',
      ref: 'abcdef0123456789',
    });
  });

  it('uses category label as reason when notes are empty', async () => {
    let capturedBody: any;
    const mockFetch = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      capturedBody = JSON.parse(options.body as string);
      return {
        status: 201,
        json: async () => ({ id: 'disp-id', ref: 'disp-ref' }),
      } as Response;
    });

    await submitDispute({ ...baseInput, notes: '   ' }, mockFetch as unknown as typeof fetch);

    expect(capturedBody.reason).toBe(DISPUTE_CATEGORY_LABELS['delayed']);
  });

  it('maps 404 to outcome not recorded message', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 404,
      json: async () => ({ code: 'NOT_FOUND', message: 'No outcome recorded' }),
    });

    await expect(
      submitDispute(baseInput, mockFetch as unknown as typeof fetch)
    ).rejects.toThrowError(
      new DisputeSubmitError(
        "Your transfer's outcome has not been recorded yet. Try again in a minute.",
        404
      )
    );
  });

  it('maps 409 to dispute already open message', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 409,
      json: async () => ({ code: 'CONFLICT', message: 'An open dispute already exists' }),
    });

    await expect(
      submitDispute(baseInput, mockFetch as unknown as typeof fetch)
    ).rejects.toThrowError(
      new DisputeSubmitError('A dispute for this transfer is already open.', 409)
    );
  });

  it('maps 429 to rate limit message', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 429,
      json: async () => ({ code: 'RATE_LIMITED', message: 'Too many requests' }),
    });

    await expect(
      submitDispute(baseInput, mockFetch as unknown as typeof fetch)
    ).rejects.toThrowError(
      new DisputeSubmitError('Too many disputes from this wallet today.', 429)
    );
  });

  it('maps 403 to only wallet can dispute message', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 403,
      json: async () => ({ code: 'FORBIDDEN', message: 'Forbidden' }),
    });

    await expect(
      submitDispute(baseInput, mockFetch as unknown as typeof fetch)
    ).rejects.toThrowError(
      new DisputeSubmitError('Only the wallet that made this transfer can dispute it.', 403)
    );
  });

  it('uses body message on generic error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 500,
      json: async () => ({ message: 'Database connection failed' }),
    });

    await expect(
      submitDispute(baseInput, mockFetch as unknown as typeof fetch)
    ).rejects.toThrowError(new DisputeSubmitError('Database connection failed', 500));
  });

  it('uses fallback message on error without body message', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 502,
      json: async () => {
        throw new Error('Not JSON');
      },
    });

    await expect(
      submitDispute(baseInput, mockFetch as unknown as typeof fetch)
    ).rejects.toThrowError(new DisputeSubmitError('Could not submit the dispute.', 502));
  });
});
