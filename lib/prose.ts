/**
 * lib/prose.ts
 *
 * Tailwind classes for rendering a markdown document as a page.
 *
 * Shared so /methodology and /terms cannot drift into looking like different
 * products. Both render a docs/ file directly, keeping the markdown as the
 * single source of its own content.
 */

export const PROSE_CLASSES = [
  '[&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:text-gray-900 dark:[&_h1]:text-white',
  '[&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-gray-900 dark:[&_h2]:text-white',
  '[&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-gray-900 dark:[&_h3]:text-white',
  '[&_p]:mt-3 [&_p]:leading-relaxed [&_p]:text-gray-600 dark:[&_p]:text-gray-300',
  '[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6 [&_ul]:text-gray-600 dark:[&_ul]:text-gray-300',
  '[&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6 [&_ol]:text-gray-600 dark:[&_ol]:text-gray-300',
  '[&_a]:text-blue-600 [&_a]:underline dark:[&_a]:text-blue-400',
  '[&_code]:rounded [&_code]:bg-gray-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-sm dark:[&_code]:bg-gray-800',
  '[&_pre]:mt-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-gray-200 [&_pre]:bg-gray-50 [&_pre]:p-4 [&_pre]:text-sm dark:[&_pre]:border-gray-700 dark:[&_pre]:bg-gray-900/60',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_table]:mt-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm',
  '[&_th]:border [&_th]:border-gray-200 [&_th]:bg-gray-50 [&_th]:p-2 [&_th]:text-left dark:[&_th]:border-gray-700 dark:[&_th]:bg-gray-900/60',
  '[&_td]:border [&_td]:border-gray-200 [&_td]:p-2 dark:[&_td]:border-gray-700',
].join(' ');
