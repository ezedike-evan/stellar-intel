import type { MetadataRoute } from 'next';
import { ANCHORS } from '@/constants/anchors';

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
      url: `${SITE_URL}/history`,
      lastModified: now,
      changeFrequency: 'weekly',
    },
    ...ANCHORS.map((anchor) => ({
      url: `${SITE_URL}/anchors/${anchor.id}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
    })),
  ];
}
