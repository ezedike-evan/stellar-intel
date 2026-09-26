import type { MetadataRoute } from 'next';
import { ANCHORS } from '@/constants/anchors';
import { DOCS_ROUTES } from '@/app/docs/nav';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: 'weekly',
    },
    {
      url: `${SITE_URL}/offramp`,
      lastModified: now,
      changeFrequency: 'daily',
    },
    {
      url: `${SITE_URL}/anchors`,
      lastModified: now,
      changeFrequency: 'daily',
    },
    {
      url: `${SITE_URL}/anchors/standings`,
      lastModified: now,
      changeFrequency: 'daily',
    },
    {
      url: `${SITE_URL}/history`,
      lastModified: now,
      changeFrequency: 'weekly',
    },
    {
      url: `${SITE_URL}/methodology`,
      lastModified: now,
      changeFrequency: 'weekly',
    },
    {
      url: `${SITE_URL}/faq`,
      lastModified: now,
      changeFrequency: 'weekly',
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified: now,
      changeFrequency: 'yearly',
    },
    ...ANCHORS.map((anchor) => ({
      url: `${SITE_URL}/anchors/${anchor.id}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
    })),
    ...DOCS_ROUTES.map((route) => ({
      url: `${SITE_URL}${route.href}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
    })),
  ];
}
