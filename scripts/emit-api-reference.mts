import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateApiReferenceMarkdown,
  type OpenApiSpec,
} from '../lib/api/api-reference-generator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const specPath = resolve(__dirname, '../public/openapi.json');
const outPath = resolve(__dirname, '../docs/API_REFERENCE.md');

mkdirSync(dirname(outPath), { recursive: true });

const spec = JSON.parse(readFileSync(specPath, 'utf8')) as OpenApiSpec;
const markdown = generateApiReferenceMarkdown(spec);

writeFileSync(outPath, markdown, 'utf8');

console.log(`API reference documentation generated at ${outPath}`);
