import { describe, it, expect } from 'vitest';
import {
  IntentTemplateSchema,
  IntentTemplateInputSchema,
  IntentTemplateExportSchema,
  TEMPLATE_SCHEMA_VERSION,
  TEMPLATE_EXPORT_FORMAT,
  templateCorridorLabel,
  isTemplateCorridorAvailable,
} from '@/lib/templates/schema';

describe('intent-templates-schema (#2154 / TPL001)', () => {
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

  describe('label validation', () => {
    it('rejects empty or whitespace-only labels', () => {
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
          label: '   ',
          corridorId: 'usdc-ngn',
          amount: '100',
        }).success
      ).toBe(false);
    });

    it('rejects labels exceeding 60 characters', () => {
      expect(
        IntentTemplateInputSchema.safeParse({
          direction: 'offramp',
          label: 'A'.repeat(61),
          corridorId: 'usdc-ngn',
          amount: '100',
        }).success
      ).toBe(false);
    });

    it('trims label on parse', () => {
      const res = IntentTemplateInputSchema.safeParse({
        direction: 'offramp',
        label: '  My Template  ',
        corridorId: 'usdc-ngn',
        amount: '100',
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.label).toBe('My Template');
      }
    });

    it('rejects a newline character in label', () => {
      expect(
        IntentTemplateInputSchema.safeParse({
          direction: 'offramp',
          label: 'My\nTemplate',
          corridorId: 'usdc-ngn',
          amount: '100',
        }).success
      ).toBe(false);
    });
  });

  describe('off-ramp amount validation', () => {
    it('rejects 0, negative amounts, and more than 7 decimal places', () => {
      expect(
        IntentTemplateInputSchema.safeParse({
          direction: 'offramp',
          label: 'Test',
          corridorId: 'usdc-ngn',
          amount: '0',
        }).success
      ).toBe(false);

      expect(
        IntentTemplateInputSchema.safeParse({
          direction: 'offramp',
          label: 'Test',
          corridorId: 'usdc-ngn',
          amount: '-1',
        }).success
      ).toBe(false);

      expect(
        IntentTemplateInputSchema.safeParse({
          direction: 'offramp',
          label: 'Test',
          corridorId: 'usdc-ngn',
          amount: '1.12345678', // 8 dp
        }).success
      ).toBe(false);
    });

    it('accepts valid amounts such as 100.5', () => {
      expect(
        IntentTemplateInputSchema.safeParse({
          direction: 'offramp',
          label: 'Test',
          corridorId: 'usdc-ngn',
          amount: '100.5',
        }).success
      ).toBe(true);
    });
  });

  describe('strict object enforcement (no PII smuggling)', () => {
    it('rejects unknown key recipientName for both directions', () => {
      expect(
        IntentTemplateSchema.safeParse({
          ...validOfframp,
          recipientName: 'Jane Doe',
        }).success
      ).toBe(false);

      expect(
        IntentTemplateSchema.safeParse({
          ...validOnramp,
          recipientName: 'Jane Doe',
        }).success
      ).toBe(false);
    });
  });

  describe('on-ramp assetId and depositMethod validation', () => {
    it('accepts stellar:native and valid SEP-38 assetId, rejects bare symbols', () => {
      expect(
        IntentTemplateInputSchema.safeParse({
          direction: 'onramp',
          label: 'Native',
          corridorId: 'usdc-ngn',
          amount: '50',
          assetId: 'stellar:native',
        }).success
      ).toBe(true);

      expect(
        IntentTemplateInputSchema.safeParse({
          direction: 'onramp',
          label: 'USDC Token',
          corridorId: 'usdc-ngn',
          amount: '50',
          assetId: 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        }).success
      ).toBe(true);

      expect(
        IntentTemplateInputSchema.safeParse({
          direction: 'onramp',
          label: 'Bare Symbol',
          corridorId: 'usdc-ngn',
          amount: '50',
          assetId: 'USDC',
        }).success
      ).toBe(false);
    });

    it('rejects unsupported depositMethod wire', () => {
      expect(
        IntentTemplateInputSchema.safeParse({
          direction: 'onramp',
          label: 'Wire deposit',
          corridorId: 'usdc-ngn',
          amount: '50',
          depositMethod: 'wire',
        }).success
      ).toBe(false);
    });
  });

  describe('IntentTemplateInputSchema omitting omitted fields', () => {
    it('rejects an id key in input', () => {
      expect(
        IntentTemplateInputSchema.safeParse({
          id: 'tpl-attempted-id',
          direction: 'offramp',
          label: 'Test',
          corridorId: 'usdc-ngn',
          amount: '100',
        }).success
      ).toBe(false);
    });
  });

  describe('IntentTemplateExportSchema', () => {
    it('rejects wrong format, version: 2, or over 50 templates', () => {
      const validExport = {
        format: TEMPLATE_EXPORT_FORMAT,
        version: 1,
        exportedAt: '2026-11-20T12:00:00.000Z',
        templates: [validOfframp],
      };
      expect(IntentTemplateExportSchema.safeParse(validExport).success).toBe(true);

      expect(
        IntentTemplateExportSchema.safeParse({
          ...validExport,
          format: 'invalid/format',
        }).success
      ).toBe(false);

      expect(
        IntentTemplateExportSchema.safeParse({
          ...validExport,
          version: 2,
        }).success
      ).toBe(false);

      const tooMany = Array.from({ length: 51 }, (_, i) => ({
        ...validOfframp,
        id: `tpl-${i}`,
      }));
      expect(
        IntentTemplateExportSchema.safeParse({
          ...validExport,
          templates: tooMany,
        }).success
      ).toBe(false);
    });
  });

  describe('helper functions', () => {
    it('formats corridor labels', () => {
      expect(templateCorridorLabel('usdc-ngn')).toBe('USDC → NGN');
      expect(templateCorridorLabel('xlm-eurc')).toBe('XLM → EURC');
    });

    it('checks corridor availability', () => {
      const visible = new Set(['usdc-ngn']);
      expect(isTemplateCorridorAvailable(validOfframp as any, visible)).toBe(true);
      expect(
        isTemplateCorridorAvailable({ ...validOfframp, corridorId: 'usdc-brl' } as any, visible)
      ).toBe(false);
    });
  });
});
