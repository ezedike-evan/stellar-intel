import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { WEBHOOK_EVENT_KINDS } from '@/lib/webhooks/schema';
import { WEBHOOK_PAYLOAD_SCHEMAS } from '@/types/webhooks';

describe('Webhook documentation parity', () => {
  const docsPath = resolve(process.cwd(), 'docs/WEBHOOKS.md');
  const docsContent = readFileSync(docsPath, 'utf8');

  it('documents every webhook event kind under a ### <kind> heading', () => {
    for (const kind of WEBHOOK_EVENT_KINDS) {
      expect(docsContent).toContain(`### ${kind}`);
    }
  });

  it('provides a valid JSON payload example for every event kind', () => {
    for (const kind of WEBHOOK_EVENT_KINDS) {
      const heading = `### ${kind}`;
      const headingIdx = docsContent.indexOf(heading);
      expect(headingIdx).toBeGreaterThanOrEqual(0);

      const afterHeading = docsContent.slice(headingIdx + heading.length);
      const codeBlockMatch = afterHeading.match(/```json\s*\n([\s\S]*?)\n```/);
      expect(codeBlockMatch, `Missing json code block for ${kind}`).toBeTruthy();

      const rawJson = codeBlockMatch?.[1] ?? '';
      let parsed: unknown;
      expect(() => {
        parsed = JSON.parse(rawJson);
      }, `Invalid JSON for ${kind}`).not.toThrow();

      const schema = WEBHOOK_PAYLOAD_SCHEMAS[kind];
      const result = schema.safeParse(parsed);
      expect(
        result.success,
        `Payload for ${kind} did not conform to schema: ${result.error?.message}`
      ).toBe(true);
    }
  });
});
