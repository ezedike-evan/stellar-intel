import { expect, test, describe } from 'vitest';
import { redactProperties } from '../lib/analytics';

describe('Analytics Redaction', () => {
  test('removes explicit PII fields', () => {
    const props = {
      amount: '100',
      recipientName: 'John Doe',
      account: 'GBABC123...',
      email: 'john@example.com',
    };

    const safe = redactProperties(props);
    expect(safe.amount).toBe('100');
    expect(safe.recipientName).toBe('[REDACTED]');
    expect(safe.account).toBe('[REDACTED]');
    expect(safe.email).toBe('[REDACTED]');
  });

  test('redacts Stellar wallet addresses in any string', () => {
    const props = {
      customData: 'GAQGOMSAVCGROUUEOOREMNNGXZV7F757GJJF4O6MM26E2Z4J6O33H5O7',
      normalString: 'hello world',
    };

    const safe = redactProperties(props);
    expect(safe.customData).toBe('[REDACTED_WALLET]');
    expect(safe.normalString).toBe('hello world');
  });

  test('redacts emails in any string', () => {
    const props = {
      feedback: 'this is not an email',
      contact: 'test@example.com',
    };

    const safe = redactProperties(props);
    expect(safe.contact).toBe('[REDACTED_EMAIL]');
    expect(safe.feedback).toBe('this is not an email');
  });
});
