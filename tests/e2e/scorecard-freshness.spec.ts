import { expect, test, type APIRequestContext } from '@playwright/test';

type Scorecard =
  | {
      state: 'ok';
      sampleSize: number;
      fillRate: number;
    }
  | {
      state: 'insufficient_data';
      sampleSize: number;
    };

async function appendCompletedOutcome(
  request: APIRequestContext,
  anchorId: string,
  intentHash: string
): Promise<void> {
  const response = await request.post('/api/reputation/append', {
    data: {
      intentHash,
      anchorId,
      corridor: 'usdc-ngn',
      quotedRate: '1580',
      deliveredRate: '1580',
      quotedAmount: '100',
      deliveredAmount: '158000',
      settleSeconds: 4,
      outcome: 'completed',
      stellarTransactionId: `tx-${intentHash}`,
    },
  });

  expect(response.status()).toBe(201);
}

async function readSevenDayScorecard(
  request: APIRequestContext,
  anchorId: string
): Promise<Scorecard> {
  const response = await request.get(`/api/reputation/${encodeURIComponent(anchorId)}`);
  expect(response.ok()).toBeTruthy();

  const body = (await response.json()) as {
    scorecards?: Record<string, Scorecard>;
  };

  const scorecard = body.scorecards?.['7'];
  expect(scorecard).toBeDefined();
  return scorecard as Scorecard;
}

function summarize(scorecard: Scorecard): {
  state: Scorecard['state'];
  sampleSize: number;
  fillRate: number | null;
} {
  return {
    state: scorecard.state,
    sampleSize: scorecard.sampleSize,
    fillRate: scorecard.state === 'ok' ? scorecard.fillRate : null,
  };
}

test.describe('scorecard freshness', () => {
  test('scorecard aggregate reflects a terminal outcome within 5 seconds', async ({
    request,
  }, testInfo) => {
    const anchorId = `scorecard-freshness-${testInfo.workerIndex}-${Date.now()}`;

    await appendCompletedOutcome(request, anchorId, `${anchorId}-baseline`);

    await expect
      .poll(async () => summarize(await readSevenDayScorecard(request, anchorId)), {
        timeout: 5_000,
        intervals: [100, 250, 500, 1_000],
      })
      .toEqual({ state: 'ok', sampleSize: 1, fillRate: 1 });

    const initial = await readSevenDayScorecard(request, anchorId);
    expect(initial.state).toBe('ok');
    if (initial.state !== 'ok') return;

    await appendCompletedOutcome(request, anchorId, `${anchorId}-terminal`);

    await expect
      .poll(async () => summarize(await readSevenDayScorecard(request, anchorId)), {
        timeout: 5_000,
        intervals: [100, 250, 500, 1_000],
      })
      .toEqual({
        state: 'ok',
        sampleSize: initial.sampleSize + 1,
        fillRate: initial.fillRate,
      });
  });
});
