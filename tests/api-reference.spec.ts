import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateApiReferenceMarkdown, type OpenApiSpec } from '@/lib/api/api-reference-generator';

const root = process.cwd();
const specPath = join(root, 'public/openapi.json');
const docPath = join(root, 'docs/API_REFERENCE.md');

const spec = JSON.parse(readFileSync(specPath, 'utf8')) as OpenApiSpec;

describe('API reference documentation generator (#1078)', () => {
  it('committed docs/API_REFERENCE.md exists and matches generated spec', () => {
    expect(
      existsSync(docPath),
      'docs/API_REFERENCE.md must exist (run `npm run emit-api-reference`)'
    ).toBe(true);

    const committedDoc = readFileSync(docPath, 'utf8');
    const generatedDoc = generateApiReferenceMarkdown(spec);

    expect(
      committedDoc,
      'docs/API_REFERENCE.md has drifted from public/openapi.json. Run `npm run emit-api-reference`.'
    ).toBe(generatedDoc);
  });

  it('covers every path and method in public/openapi.json', () => {
    const generatedDoc = generateApiReferenceMarkdown(spec);

    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const method of Object.keys(methods)) {
        const signature = `### \`${method.toUpperCase()} ${path}\``;
        expect(
          generatedDoc.includes(signature),
          `Generated documentation must include endpoint ${method.toUpperCase()} ${path}`
        ).toBe(true);
      }
    }
  });

  it('keeps a description containing pipes, backslashes or newlines inside its table cell', () => {
    const nasty: OpenApiSpec = {
      ...spec,
      paths: {
        '/api/v1/escape-check': {
          get: {
            summary: 'Escape check',
            parameters: [
              {
                name: 'mode',
                in: 'query',
                required: false,
                // A backslash immediately before a pipe is the case escaping
                // only `|` gets wrong: it emits `\\|`, which renders as a
                // backslash plus a real cell break.
                description: 'Either `a\\|b` or\ntwo | three',
                schema: { type: 'string' },
              },
            ],
            responses: { '200': { description: 'OK | fine' } },
          },
        },
      },
    };

    const generated = generateApiReferenceMarkdown(nasty);
    const rows = generated.split('\n').filter((line) => line.startsWith('| `mode`'));
    expect(rows).toHaveLength(1);

    // Five columns => six `|` delimiters. Any unescaped pipe from the
    // description would add another, and a newline would split the row.
    const delimiters = (rows[0]!.match(/(?<!\\)\|/g) ?? []).length;
    expect(delimiters).toBe(6);
    expect(rows[0]).toContain('\\\\\\|');
    expect(rows[0]).not.toMatch(/\n/);
  });

  it('detects drift when OpenAPI spec is altered', () => {
    const modifiedSpec: OpenApiSpec = {
      ...spec,
      paths: {
        ...spec.paths,
        '/api/v1/test-drift-endpoint': {
          get: {
            summary: 'Test drift endpoint',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    };

    const generated = generateApiReferenceMarkdown(modifiedSpec);
    const committedDoc = readFileSync(docPath, 'utf8');

    expect(generated).not.toBe(committedDoc);
    expect(generated).toContain('/api/v1/test-drift-endpoint');
  });
});
