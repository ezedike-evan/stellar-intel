/**
 * lib/seo/faq-source.ts
 *
 * Filesystem access for the FAQ JSON-LD source (`docs/FAQ.md`, #1061).
 *
 * Split out of lib/seo/jsonld.ts because that module is imported by client
 * components (components/seo/AnchorsBreadcrumbs.tsx pulls in
 * `buildBreadcrumbList` / `jsonLdScriptProps`).  A top-level `node:fs` import
 * there reaches the browser chunking context, and Turbopack fails the build
 * with "the chunking context (unknown) does not support external modules
 * (request: node:fs)" on /anchors/page.  Everything left in jsonld.ts is pure
 * and safe on either side of the boundary; anything that touches the disk
 * lives here and is server-only.
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { FAQ_MARKDOWN_REL_PATH, MAX_FAQ_BYTES, FaqJsonLdError } from './jsonld';

function errorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') {
    return err.code;
  }
  return undefined;
}

export function readFaqMarkdown(relPath: string = FAQ_MARKDOWN_REL_PATH): string {
  const root = resolve(process.cwd());
  const allowed = resolve(root, FAQ_MARKDOWN_REL_PATH);
  const filePath = isAbsolute(relPath) ? resolve(relPath) : resolve(root, relPath);

  if (filePath !== allowed) {
    throw new FaqJsonLdError(`FAQ source path is not allowed: ${relPath}`);
  }

  let source: string;
  try {
    source = readFileSync(filePath, 'utf-8');
  } catch (err) {
    if (errorCode(err) === 'ENOENT') {
      throw new FaqJsonLdError(`FAQ source not found: ${filePath}`);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new FaqJsonLdError(`Failed to read FAQ source ${filePath}: ${message}`);
  }

  if (Buffer.byteLength(source, 'utf-8') > MAX_FAQ_BYTES) {
    throw new FaqJsonLdError(`FAQ source exceeds ${MAX_FAQ_BYTES} bytes: ${filePath}`);
  }

  return source;
}
