/**
 * lib/seo/jsonld.ts
 *
 * Shared helpers for emitting schema.org JSON-LD. `app/page.tsx` already
 * inlines a `FinancialProduct` block by hand; this module gives the
 * `BreadcrumbList` blocks on `/docs/*` and `/anchors/*` (#1062) the same
 * shape without duplicating the escaping logic.
 */

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export interface BreadcrumbListJsonLd {
  '@context': 'https://schema.org';
  '@type': 'BreadcrumbList';
  itemListElement: Array<{
    '@type': 'ListItem';
    position: number;
    name: string;
    item: string;
  }>;
}

export function buildBreadcrumbList(items: BreadcrumbItem[]): BreadcrumbListJsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/**
 * Props for a `<script type="application/ld+json">` tag. Every `<` in the
 * serialized JSON is escaped to its unicode form — the same guard
 * `app/page.tsx`'s inline structured-data script uses — because an
 * unescaped `</script>` inside the JSON string would close the tag early
 * and dump raw JSON into the page.
 */
export function jsonLdScriptProps(data: unknown): {
  type: 'application/ld+json';
  dangerouslySetInnerHTML: { __html: string };
} {
  return {
    type: 'application/ld+json',
    dangerouslySetInnerHTML: { __html: JSON.stringify(data).replace(/</g, '\\u003c') },
  };
}
