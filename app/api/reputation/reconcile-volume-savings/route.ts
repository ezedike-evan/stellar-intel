import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { getReputationStore } from '@/lib/reputation/store';
import { getVolumeSavings } from '@/lib/oracle/read';
import { checkCronAuth } from '@/lib/api/cron-auth';
import { checkDurableStore } from '@/lib/api/store-guard';

export const runtime = 'nodejs';

interface ReconciliationStatus {
  corridor: string;
  dbVolumeUsdc: number;
  dbSavingsUsdc: number;
  dbSettlementCount: number;
  chainVolumeUsdc: number;
  chainSavingsUsdc: number;
  chainSettlementCount: number;
  reconciled: boolean;
  discrepancies: string[];
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = checkCronAuth(request);
  if (unauthorized) return unauthorized;

  return withRequestLogger(request, 'api.reputation.reconcile-volume-savings', async (logger) => {
    const unavailable = checkDurableStore();
    if (unavailable) {
      logger.warn({ event: 'reconcile_volume_savings_store_unavailable' });
      return unavailable;
    }

    try {
      const store = getReputationStore();

      // Get all published outcomes that were successful
      const allRows = await store.query();
      const publishedCompleted = allRows.filter(
        (r) => r.publishedAt !== null && r.outcome === 'completed'
      );

      // Group by corridor
      const corridors = Array.from(new Set(publishedCompleted.map((r) => r.corridor)));
      const results: ReconciliationStatus[] = [];

      for (const corridor of corridors) {
        const corridorRows = publishedCompleted.filter((r) => r.corridor === corridor);

        let dbVolume = 0;
        let dbSavings = 0;

        for (const row of corridorRows) {
          const quotedAmount = Number(row.quotedAmount);
          dbVolume += quotedAmount;

          const baselineRate = Number(row.quotedRate);
          if (row.deliveredAmount && baselineRate > 0) {
            const deliveredAmount = Number(row.deliveredAmount);
            const baselineCost = deliveredAmount / baselineRate;
            const savings = Math.max(0, baselineCost - quotedAmount);
            dbSavings += savings;
          }
        }

        // Fetch on-chain values
        const chainStats = await getVolumeSavings(corridor);

        // Convert DB values to microUSDC for exact comparison
        const dbVolumeMicro = Math.round(dbVolume * 1_000_000);
        const dbSavingsMicro = Math.round(dbSavings * 1_000_000);
        const dbCount = corridorRows.length;

        const chainVolumeMicro = chainStats ? chainStats.volumeUsdc : 0;
        const chainSavingsMicro = chainStats ? chainStats.savingsUsdc : 0;
        const chainCount = chainStats ? chainStats.settlementCount : 0;

        const discrepancies: string[] = [];
        // Allow a small rounding tolerance of 1 microUSDC due to float representation
        if (Math.abs(dbVolumeMicro - chainVolumeMicro) > 1) {
          discrepancies.push(
            `Volume mismatch: DB ${dbVolumeMicro} microUSDC, Chain ${chainVolumeMicro} microUSDC`
          );
        }
        if (Math.abs(dbSavingsMicro - chainSavingsMicro) > 1) {
          discrepancies.push(
            `Savings mismatch: DB ${dbSavingsMicro} microUSDC, Chain ${chainSavingsMicro} microUSDC`
          );
        }
        if (dbCount !== chainCount) {
          discrepancies.push(`Settlement count mismatch: DB ${dbCount}, Chain ${chainCount}`);
        }

        const reconciled = discrepancies.length === 0;
        if (!reconciled) {
          logger.warn({
            event: 'volume_savings_mismatch',
            corridor,
            discrepancies,
          });
        }

        results.push({
          corridor,
          dbVolumeUsdc: dbVolumeMicro,
          dbSavingsUsdc: dbSavingsMicro,
          dbSettlementCount: dbCount,
          chainVolumeUsdc: chainVolumeMicro,
          chainSavingsUsdc: chainSavingsMicro,
          chainSettlementCount: chainCount,
          reconciled,
          discrepancies,
        });
      }

      const allReconciled = results.every((r) => r.reconciled);
      return NextResponse.json({
        ok: true,
        reconciled: allReconciled,
        corridors: results,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ event: 'reconcile_volume_savings_failed', error: message });
      return NextResponse.json(
        { error: 'Failed to reconcile volume and savings' },
        { status: 500 }
      );
    }
  });
}

export const POST = GET;
