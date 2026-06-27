const { readFileSync } = require('fs');
const { spawnSync } = require('child_process');
const { resolve } = require('path');

const cfgPath = resolve(process.cwd(), 'tests', 'e2e', 'release.config.ts');
const raw = readFileSync(cfgPath, 'utf8');

// naive extraction of string paths from the ts export
const files = Array.from(raw.matchAll(/'([^']+)'/g)).map((m) => m[1]);

if (!files.length) {
  console.error('No files found in release.config.ts');
  process.exit(2);
}

console.log('Running release suite for files:', files);

const res = spawnSync('npx', ['vitest', 'run', ...files], { stdio: 'inherit' });
process.exit(res.status || 0);
