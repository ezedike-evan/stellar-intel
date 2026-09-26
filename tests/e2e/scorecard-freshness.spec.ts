import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { Keypair } from '@stellar/stellar-sdk';

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

// The append route only accepts outcomes signed by the sender over the intent
// hash, for a registered anchor and a corridor it serves. Each call uses a fresh
// random hash, since appends are insert-only.
const signer = Keypair.random();

function randomHash(): string {
  return randomBytes(32).toString('hex');
}

async function appendCompletedOutcome(request: APIRequestContext, anchorId: string): Promise<void> {
  const intentHash = randomHash();
  const signature = Buffer.from(signer.sign(Buffer.from(intentHash, 'hex'))).toString('base64');
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
      stellarTransactionId: randomHash(),
      publicKey: signer.publicKey(),
      signature,
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
  test('scorecard aggregate reflects a terminal outcome within 5 seconds', async ({ request }) => {
    // A registered anchor: the append route rejects ids outside the registry.
    // Other workers may append to it too, so assert on growth, not exact counts.
    const anchorId = 'cowrie';
    const before = await readSevenDayScorecard(request, anchorId);

    await appendCompletedOutcome(request, anchorId);

    await expect
      .poll(async () => (await readSevenDayScorecard(request, anchorId)).sampleSize, {
        timeout: 5_000,
        intervals: [100, 250, 500, 1_000],
      })
      .toBeGreaterThanOrEqual(before.sampleSize + 1);

    const middle = await readSevenDayScorecard(request, anchorId);
    await appendCompletedOutcome(request, anchorId);

    await expect
      .poll(async () => summarize(await readSevenDayScorecard(request, anchorId)).sampleSize, {
        timeout: 5_000,
        intervals: [100, 250, 500, 1_000],
      })
      .toBeGreaterThanOrEqual(middle.sampleSize + 1);
  });
});
