import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiSpec } from '../lib/api/openapi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '../public/openapi.json');

mkdirSync(dirname(outPath), { recursive: true });

const spec = buildOpenApiSpec();
writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n', 'utf-8');

console.log(`OpenAPI spec written to ${outPath}`);
