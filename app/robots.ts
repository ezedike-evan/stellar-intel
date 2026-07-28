import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://stellar-intel.vercel.app';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/api/*', '/admin/', '/admin/*', '/_next/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
