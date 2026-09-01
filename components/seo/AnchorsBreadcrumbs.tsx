'use client';

import { usePathname, useParams } from 'next/navigation';
import { ANCHORS } from '@/constants';
import { buildBreadcrumbList, jsonLdScriptProps, type BreadcrumbItem } from '@/lib/seo/jsonld';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';

// Matches the visible nav trail for each /anchors/* page (#1062): the index
// page's own h1 ("Anchors"), the standings page's own h1 ("Anchor standings",
// app/anchors/standings/page.tsx), and — for a detail page — the same
// ANCHORS entry the page itself renders as its title.
export function buildAnchorsBreadcrumbItems(
  pathname: string | null,
  anchorId: string | undefined
): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [
    { name: 'Home', url: SITE_URL },
    { name: 'Anchors', url: `${SITE_URL}/anchors` },
  ];

  if (anchorId) {
    const anchor = ANCHORS.find((item) => item.id === anchorId);
    items.push({
      name: anchor?.name ?? anchorId,
      url: `${SITE_URL}/anchors/${anchorId}`,
    });
  } else if (pathname === '/anchors/standings') {
    items.push({ name: 'Anchor standings', url: `${SITE_URL}/anchors/standings` });
  }

  return items;
}

/**
 * Emits the `/anchors/*` BreadcrumbList (#1062).
 *
 * Split out of app/anchors/layout.tsx because the trail needs `usePathname`
 * and `useParams`, and that layout has to stay a server component — it owns
 * the route's `metadata` export, which a client component cannot provide.
 */
export function AnchorsBreadcrumbs() {
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();

  return (
    <script
      // eslint-disable-next-line react/no-danger
      {...jsonLdScriptProps(buildBreadcrumbList(buildAnchorsBreadcrumbItems(pathname, params.id)))}
    />
  );
}
