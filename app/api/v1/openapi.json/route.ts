import { NextResponse } from 'next/server';
import { buildOpenApiSpec } from '@/lib/api/openapi';

export const dynamic = 'force-dynamic';

export async function GET() {
  const spec = buildOpenApiSpec();
  return NextResponse.json(spec, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
