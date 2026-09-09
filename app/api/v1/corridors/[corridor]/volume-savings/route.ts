import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withV1 } from '@/lib/api/v1';
import { getVolumeSavings } from '@/lib/oracle/read';
import { isValidCorridorId } from '@/lib/stellar/anchors';

export const runtime = 'nodejs';

const ParamsSchema = z.object({
  corridor: z.string().min(1),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ corridor: string }> }
): Promise<NextResponse> {
  return withV1(
    request,
    { bucket: 'v1.corridors.volume-savings', maxRequests: 90 },
    async (ctx) => {
      const resolvedParams = await params;
      const parsed = ParamsSchema.safeParse(resolvedParams);
      if (!parsed.success || !isValidCorridorId(parsed.data.corridor)) {
        return ctx.error('validation_error', 'Invalid corridor ID', 400);
      }

      const { corridor } = parsed.data;

      try {
        const stats = await getVolumeSavings(corridor);
        if (!stats) {
          return {
            status: 200,
            body: {
              corridor,
              volumeUsdc: 0,
              savingsUsdc: 0,
              settlementCount: 0,
              updatedAt: 0,
            },
          };
        }

        return {
          status: 200,
          body: {
            corridor,
            volumeUsdc: stats.volumeUsdc,
            savingsUsdc: stats.savingsUsdc,
            settlementCount: stats.settlementCount,
            updatedAt: stats.updatedAt,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return ctx.error('internal_error', `Failed to fetch volume and savings: ${message}`, 500);
      }
    }
  );
}
