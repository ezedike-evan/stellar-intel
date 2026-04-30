const fs = require('fs');

const testFiles = ['tests/lib/sep24.test.ts', 'tests/sep24-fee.spec.ts', 'tests/sep24-withdraw.spec.ts'];

for (const file of testFiles) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/vi\.stubGlobal\('fetch', vi\.fn\(async \(\) => \(\{/g, "vi.stubGlobal('fetch', vi.fn(async (url) => { if (url && url.endsWith('/info')) return { ok: true, json: async () => ({ withdraw: {} }) }; return {");
  content = content.replace(/vi\.stubGlobal\('fetch', vi\.fn\(async \(url: string\) => \{/g, "vi.stubGlobal('fetch', vi.fn(async (url: string) => { if (url && url.endsWith('/info')) return { ok: true, json: async () => ({ withdraw: {} }) };");
  content = content.replace(/vi\.stubGlobal\('fetch', vi\.fn\(async \(\) => \{/g, "vi.stubGlobal('fetch', vi.fn(async (url) => { if (url && url.endsWith('/info')) return { ok: true, json: async () => ({ withdraw: {} }) };");
  content = content.replace(/vi\.stubGlobal\('fetch', vi\.fn\(\(_url: string, opts/g, "vi.stubGlobal('fetch', vi.fn((_url: string, opts");
  content = content.replace(/vi\.stubGlobal\('fetch', vi\.fn\(async \(_url: string, opts: RequestInit\) => \{/g, "vi.stubGlobal('fetch', vi.fn(async (_url: string, opts: RequestInit) => { if (_url && _url.endsWith('/info')) return { ok: true, json: async () => ({ withdraw: {} }) } as any;");
  fs.writeFileSync(file, content);
}
