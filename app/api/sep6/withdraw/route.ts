import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const TRANSFER_SERVER_PATTERN = /^https:\/\//;
const ASSET_CODE_PATTERN = /^[A-Z]{1,12}$/;
const ACCOUNT_PATTERN = /^G[A-Z2-7]{55}$/;
const AMOUNT_PATTERN = /^\d+(\.\d+)?$/;

// ─── POST /api/sep6/withdraw ──────────────────────────────────────────────────
//
// Server-side SEP-6 withdraw + customer proxy. Runs anchor calls from Node so
// the browser is never blocked by anchor CORS policies. JWTs and KYC field
// values are forwarded to the anchor but never written to logs.
export async function POST(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.sep6.withdraw', async (logger) => {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }

    const transferServer = body['transferServer'];
    const assetCode = body['assetCode'];
    const account = body['account'];
    const amount = body['amount'];
    const jwt = body['jwt']; // SEP-10 auth token — never logged

    if (typeof transferServer !== 'string' || !TRANSFER_SERVER_PATTERN.test(transferServer)) {
      logger.warn({ event: 'invalid_transfer_server' });
      return NextResponse.json(
        { error: 'transferServer must be an https:// URL' },
        { status: 400 }
      );
    }

    if (typeof assetCode !== 'string' || !ASSET_CODE_PATTERN.test(assetCode)) {
      logger.warn({ event: 'invalid_asset_code', assetCode });
      return NextResponse.json(
        { error: 'assetCode must be 1–12 uppercase letters' },
        { status: 400 }
      );
    }

    if (typeof account !== 'string' || !ACCOUNT_PATTERN.test(account)) {
      logger.warn({ event: 'invalid_account' });
      return NextResponse.json(
        { error: 'account must be a valid Stellar public key (G…)' },
        { status: 400 }
      );
    }

    if (amount !== undefined && (typeof amount !== 'string' || !AMOUNT_PATTERN.test(amount))) {
      logger.warn({ event: 'invalid_amount' });
      return NextResponse.json(
        { error: 'amount must be a positive decimal string' },
        { status: 400 }
      );
    }

    // Build anchor URL — only safe, non-PII params go into the log event
    const anchorUrl = new URL(`${transferServer}/withdraw`);
    anchorUrl.searchParams.set('asset_code', assetCode);
    anchorUrl.searchParams.set('account', account);
    if (typeof amount === 'string') anchorUrl.searchParams.set('amount', amount);

    // Forward any extra anchor-specific fields from the body (e.g. type, dest)
    // KYC values (names, account numbers) are forwarded but never logged
    const KYC_FIELDS = new Set(['jwt', 'transferServer', 'assetCode', 'account', 'amount']);
    for (const [key, value] of Object.entries(body)) {
      if (!KYC_FIELDS.has(key) && typeof value === 'string') {
        anchorUrl.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (typeof jwt === 'string' && jwt.length > 0) {
      headers['Authorization'] = `Bearer ${jwt}`;
    }

    logger.info({
      event: 'sep6_withdraw_proxy',
      transferServer,
      assetCode,
      // jwt and KYC fields intentionally omitted
    });

    const anchorRes = await fetch(anchorUrl.toString(), { headers });
    const anchorBody: unknown = await anchorRes.json().catch(() => null);

    logger.info({ event: 'sep6_withdraw_response', status: anchorRes.status });

    return NextResponse.json(anchorBody, {
      status: anchorRes.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  });
}

// ─── GET /api/sep6/withdraw/customer ─────────────────────────────────────────
//
// Proxies SEP-12 /customer GET for KYC status — used before initiating a
// withdraw when the anchor requires identity verification.
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.sep6.customer', async (logger) => {
    const { searchParams } = new URL(request.url);
    const transferServer = searchParams.get('transferServer');
    const jwt = request.headers.get('authorization'); // forwarded from client, never logged

    if (!transferServer || !TRANSFER_SERVER_PATTERN.test(transferServer)) {
      logger.warn({ event: 'invalid_transfer_server' });
      return NextResponse.json(
        { error: 'transferServer must be an https:// URL' },
        { status: 400 }
      );
    }

    // Forward non-sensitive query params to /customer
    const customerUrl = new URL(`${transferServer}/customer`);
    for (const [key, value] of searchParams.entries()) {
      if (key !== 'transferServer') {
        customerUrl.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (jwt) headers['Authorization'] = jwt; // do not log

    logger.info({ event: 'sep6_customer_proxy', transferServer });

    const res = await fetch(customerUrl.toString(), { headers });
    const body: unknown = await res.json().catch(() => null);

    return NextResponse.json(body, {
      status: res.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  });
}
