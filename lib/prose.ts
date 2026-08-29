/**
 * lib/prose.ts
 *
 * Tailwind classes for rendering a markdown document as a page.
 *
 * Shared so /methodology and /terms cannot drift into looking like different
 * products. Both render a docs/ file directly, keeping the markdown as the
 * single source of its own content.
 *
 * Two things worth knowing before editing:
 *
 * Tables get `block` plus `overflow-x-auto`. Markdown offers no way to wrap a
 * table in a scroll container, and docs/ANCHOR_REPUTATION.md carries an API
 * table whose rows are far wider than a phone — without this the entire page
 * scrolled horizontally at 390px.
 *
 * Code and links get `break-words`. These documents are full of long endpoint
 * paths and file references, and a single unbroken token is the other way a
 * prose page overflows.
 */

export const PROSE_CLASSES = [
  '[&_h1]:type-title',
  '[&_h2]:mt-12 [&_h2]:text-xl [&_h2]:font-medium',
  '[&_h3]:mt-8 [&_h3]:text-base [&_h3]:font-medium',
  '[&_p]:text-secondary-text [&_p]:mt-4 [&_p]:leading-relaxed',
  '[&_ul]:text-secondary-text [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6',
  '[&_ol]:text-secondary-text [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6',
  '[&_a]:text-primary-text [&_a]:break-words [&_a]:underline [&_a]:underline-offset-4',
  '[&_a:hover]:text-accent',
  '[&_strong]:text-primary-text [&_strong]:font-medium',
  '[&_hr]:border-border [&_hr]:mt-12',
  '[&_blockquote]:border-border [&_blockquote]:text-secondary-text [&_blockquote]:mt-4 [&_blockquote]:border-l [&_blockquote]:pl-4',
  '[&_code]:bg-bg-sunken [&_code]:rounded-sm [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm [&_code]:break-words',
  '[&_pre]:border-border [&_pre]:bg-bg-sunken [&_pre]:mt-4 [&_pre]:overflow-x-auto [&_pre]:rounded-sm [&_pre]:border [&_pre]:p-4 [&_pre]:text-sm',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_table]:mt-4 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-sm',
  '[&_th]:border-border [&_th]:text-fg-muted [&_th]:border-b [&_th]:p-2 [&_th]:text-left [&_th]:font-mono [&_th]:text-xs [&_th]:font-medium [&_th]:tracking-wide',
  '[&_td]:border-border [&_td]:text-secondary-text [&_td]:border-b [&_td]:p-2 [&_td]:align-top',
].join(' ');
