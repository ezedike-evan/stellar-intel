import { describe, it, expect } from 'vitest';
import {
  IntentTemplateSchema,
  IntentTemplateInputSchema,
  TEMPLATE_SCHEMA_VERSION,
  templateCorridorLabel,
  isTemplateCorridorAvailable,
} from '@/lib/templates/schema';

describe('intent-templates-schema', () => {
  const validOfframp = {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    id: 'tpl-off-1',
    direction: 'offramp' as const,
    label: 'Send to Family',
    corridorId: 'usdc-ngn',
    amount: '150.50',
    createdAt: '2026-11-20T12:00:00.000Z',
    updatedAt: '2026-11-20T12:00:00.000Z',
  };

  const validOnramp = {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    id: 'tpl-on-1',
    direction: 'onramp' as const,
    label: 'Monthly Deposit',
    corridorId: 'usdc-ngn',
    amount: '500',
    assetId: 'stellar:native',
    createdAt: '2026-11-20T12:00:00.000Z',
    updatedAt: '2026-11-20T12:00:00.000Z',
  };

  it('parses valid off-ramp and on-ramp templates', () => {
    expect(IntentTemplateSchema.safeParse(validOfframp).success).toBe(true);
    expect(IntentTemplateSchema.safeParse(validOnramp).success).toBe(true);
  });

  it('rejects unknown properties (strict object)', () => {
    const withExtra = { ...validOfframp, recipientName: 'Jane Doe' };
    expect(IntentTemplateSchema.safeParse(withExtra).success).toBe(false);
  });

  it('validates label length and characters', () => {
    expect(
      IntentTemplateInputSchema.safeParse({
        direction: 'offramp',
        label: '',
        corridorId: 'usdc-ngn',
        amount: '100',
      }).success
    ).toBe(false);

    expect(
      IntentTemplateInputSchema.safeParse({
        direction: 'offramp',
        label: 'A'.repeat(61),
        corridorId: 'usdc-ngn',
        amount: '100',
      }).success
    ).toBe(false);

    expect(
      IntentTemplateInputSchema.safeParse({
        direction: 'offramp',
        label: 'Valid Label',
        corridorId: 'usdc-ngn',
        amount: '100',
      }).success
    ).toBe(true);
  });

  it('formats corridor labels', () => {
    expect(templateCorridorLabel('usdc-ngn')).toBe('USDC → NGN');
    expect(templateCorridorLabel('xlm-eurc')).toBe('XLM → EURC');
  });

  it('checks corridor availability', () => {
    const visible = new Set(['usdc-ngn']);
    expect(isTemplateCorridorAvailable(validOfframp as any, visible)).toBe(true);
    expect(isTemplateCorridorAvailable({ ...validOfframp, corridorId: 'usdc-brl' } as any, visible)).toBe(false);
  });
});
