import { NextRequest, NextResponse } from 'next/server';
import { Networks, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { withRequestLogger } from '@/lib/logger';
import { enforceRateLimit } from '@/lib/api/response';
import { ANCHORS } from '@/lib/stellar/anchors';
import { resolveToml } from '@/lib/stellar/sep1';
import { getClientDomain, getClientDomainKeypair } from '@/lib/stellar/client-domain';
import { validateSep10Challenge } from '@/lib/stellar/sep10';

export const dynamic = 'force-dynamic';

// ─── POST /api/sep10/client-domain ─────────────────────────────────────────────
//
// Co-signs the `client_domain` operation of a SEP-10 challenge (#1327).
//
// When a wallet authenticates with an anchor on our behalf it sets
// `client_domain` to our domain. The challenge then carries a `manage_data`
// operation sourced by our signing key, which the anchor expects us — and only
// us — to sign, so it can attribute the session to us. The browser cannot hold
// that key, so it posts the challenge here and we add the one signature.
//
// This route must never become a general-purpose signing oracle. Before it
// signs anything it re-runs the full SEP-10 validation the client library runs
// (mainnet, sequence 0, anchor-sourced, anchor-signed, manage_data only,
// timebounds ≤ 24h) against the anchor's own published SIGNING_KEY, and then
// requires exactly one `client_domain` operation, naming our domain, sourced by
// our key. Anything else is rejected before the keypair is touched.
export async function POST(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.sep10.client-domain', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.sep10.client-domain',
      maxRequests: 20,
    });
    if (limited) return limited;

    const badRequest = (message: string): NextResponse =>
      NextResponse.json({ error: message }, { status: 400 });

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return badRequest('Request body must be valid JSON');
    }

    const transaction = body['transaction'];
    const homeDomain = body['homeDomain'];
    if (typeof transaction !== 'string' || transaction.length === 0) {
      return badRequest('transaction must be a base64 XDR string');
    }
    if (typeof homeDomain !== 'string' || homeDomain.length === 0) {
      return badRequest('homeDomain must be a string');
    }

    // Fail closed when the server has no client_domain identity to sign with.
    const keypair = getClientDomainKeypair();
    const ourDomain = getClientDomain();
    if (!keypair || !ourDomain) {
      logger.warn({ event: 'client_domain_unconfigured' });
      return NextResponse.json(
        { error: 'client_domain signing is not configured', code: 'client_domain_unconfigured' },
        { status: 503 }
      );
    }
    const ourPublicKey = keypair.publicKey();

    // The requested home domain must be an anchor we know, matched on either its
    // registered home domain or its service domain.
    const requested = homeDomain.toLowerCase();
    const anchor = ANCHORS.find(
      (a) =>
        a.homeDomain.toLowerCase() === requested || a.serviceDomain?.toLowerCase() === requested
    );
    if (!anchor) {
      logger.warn({ event: 'unregistered_home_domain', homeDomain: requested });
      return badRequest('homeDomain is not a registered anchor');
    }

    // Resolve the anchor's own toml for the keys the challenge is checked against.
    const tomlDomain = anchor.serviceDomain ?? anchor.homeDomain;
    const toml = await resolveToml(tomlDomain);
    if (!toml.ok) {
      logger.warn({ event: 'toml_unresolved', anchor: tomlDomain });
      return badRequest(`could not resolve stellar.toml for ${tomlDomain}`);
    }
    const { SIGNING_KEY: signingKey, WEB_AUTH_ENDPOINT: webAuthEndpoint } = toml.data;
    if (!signingKey || !webAuthEndpoint) {
      logger.warn({ event: 'toml_missing_sep10_fields', anchor: tomlDomain });
      return badRequest(`${tomlDomain} does not publish SIGNING_KEY and WEB_AUTH_ENDPOINT`);
    }

    // Parse the challenge to read the client account (the first op's source) that
    // the validation is anchored to, and to hold the envelope we will sign.
    let tx: Transaction;
    try {
      const parsed = TransactionBuilder.fromXDR(transaction, Networks.PUBLIC);
      if (!(parsed instanceof Transaction))
        return badRequest('challenge is a fee-bump transaction');
      tx = parsed;
    } catch {
      return badRequest('challenge is not a readable Stellar transaction');
    }
    const clientAccountId = tx.operations[0]?.source;
    if (!clientAccountId) return badRequest('challenge has no operations');

    // Full SEP-10 validation against the anchor's published key/endpoint.
    try {
      validateSep10Challenge(
        transaction,
        Networks.PUBLIC,
        {
          serverSigningKey: signingKey,
          homeDomains: [...new Set([tomlDomain, anchor.homeDomain])],
          webAuthEndpoint,
          clientAccountId,
        },
        tomlDomain
      );
    } catch (err) {
      logger.warn({
        event: 'challenge_rejected',
        anchor: tomlDomain,
        reason: err instanceof Error ? err.message : String(err),
      });
      return badRequest('challenge failed SEP-10 validation');
    }

    // Exactly one client_domain op, naming our domain, sourced by our key. This
    // is what keeps the route from signing arbitrary manage_data on our behalf.
    const clientDomainOps = tx.operations.filter(
      (op) => op.type === 'manageData' && op.name === 'client_domain'
    );
    if (clientDomainOps.length !== 1) {
      logger.warn({ event: 'client_domain_op_count', count: clientDomainOps.length });
      return badRequest('challenge must carry exactly one client_domain operation');
    }
    const clientDomainOp = clientDomainOps[0];
    if (!clientDomainOp || clientDomainOp.type !== 'manageData') {
      return badRequest('client_domain op is malformed');
    }
    const value = clientDomainOp.value
      ? new TextDecoder().decode(clientDomainOp.value).toLowerCase()
      : '';
    if (value !== ourDomain) {
      logger.warn({ event: 'client_domain_value_mismatch' });
      return badRequest('client_domain operation does not name our domain');
    }
    if (clientDomainOp.source !== ourPublicKey) {
      logger.warn({ event: 'client_domain_source_mismatch' });
      return badRequest('client_domain operation is not sourced by our signing key');
    }

    // Add our one signature and hand the signed challenge back.
    tx.sign(keypair);
    logger.info({ event: 'client_domain_signed', anchor: tomlDomain, result: 'ok' });
    return NextResponse.json(
      { transaction: tx.toEnvelope().toXDR('base64') },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  });
}
