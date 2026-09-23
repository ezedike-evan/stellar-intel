import {
  Keypair,
  MemoID,
  MemoNone,
  MemoText,
  Networks,
  StrKey,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { resolveAnchor } from './sep1';
import { getCachedJwt, setCachedJwt, invalidateCachedJwt } from './jwt-cache';
import type { ResolvedAnchor, Sep10Auth } from '@/types';
import { UserRejectedError, WalletError, ErrorCode, Sep10ChallengeRejectedError } from './errors';

export { invalidateCachedJwt, getCachedJwt } from './jwt-cache';
export { Sep10ChallengeRejectedError } from './errors';
export type { Sep10ChallengeRejection } from './errors';

// ─── Typed errors ─────────────────────────────────────────────────────────────

export type ChallengeErrorCode =
  'FETCH_FAILED' | 'MISSING_FIELD' | 'WRONG_NETWORK' | 'INVALID_XDR' | 'NOT_VALIDATED';

export class ChallengeError extends Error {
  constructor(
    message: string,
    public readonly code: ChallengeErrorCode
  ) {
    super(message);
    this.name = 'ChallengeError';
  }
}

/**
 * Thrown before signing when Freighter's selected network doesn't match the
 * network the anchor's challenge is for. Carries friendly names for both sides
 * so the UI can tell the user exactly which network to switch to.
 */
export class NetworkMismatchError extends WalletError {
  constructor(
    public readonly expectedNetwork: string,
    public readonly walletNetwork: string
  ) {
    super(
      `Switch network in Freighter to ${expectedNetwork}. It is currently set to ${walletNetwork}.`,
      ErrorCode.NETWORK_MISMATCH
    );
    this.name = 'NetworkMismatchError';
  }
}

/** Maps a Stellar network passphrase to a human-readable network name. */
export function networkNameForPassphrase(passphrase: string): string {
  switch (passphrase) {
    case Networks.PUBLIC:
      return 'Mainnet (Public)';
    case Networks.TESTNET:
      return 'Testnet';
    case Networks.FUTURENET:
      return 'Futurenet';
    default:
      return passphrase;
  }
}

export class Sep10AuthError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'Sep10AuthError';
  }
}

// ─── Challenge types ──────────────────────────────────────────────────────────

declare const validatedBrand: unique symbol;

/**
 * A SEP-10 challenge that has passed {@link validateSep10Challenge}. The brand
 * means one can only be produced by the validator, so {@link signChallenge}
 * cannot be handed a raw anchor response by mistake.
 */
export interface Sep10Challenge {
  readonly transaction: string;
  readonly network_passphrase: string;
  readonly parsed: Transaction;
  /** The account the challenge asks to sign — always the connected wallet. */
  readonly clientAccountID: string;
  /** The home domain the challenge was matched against. */
  readonly homeDomain: string;
  readonly [validatedBrand]: true;
}

/** What the challenge must be checked against, all taken from the anchor's stellar.toml. */
export interface Sep10ChallengeExpectations {
  /** The anchor's SIGNING_KEY — must be the challenge source and must have signed it. */
  serverSigningKey: string;
  /**
   * Home domain(s) the first manage_data key may name (`<d> auth`). The
   * WEB_AUTH_ENDPOINT host is always allowed as well.
   */
  homeDomains: string | string[];
  /** WEB_AUTH_ENDPOINT; its host must match any `web_auth_domain` operation. */
  webAuthEndpoint: string;
  /** The wallet that is about to sign. The challenge must be for this account. */
  clientAccountId: string;
}

// Runtime twin of the brand: a challenge object reaches the signer only if the
// validator created it, even if a caller casts its way past the type.
const validatedChallenges = new WeakSet<object>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function decodeJwtExp(token: string): number {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT: expected 3 dot-separated segments');
  }
  const base64 = (parts[1] as string).replace(/-/g, '+').replace(/_/g, '/');
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(atob(base64)) as Record<string, unknown>;
  } catch {
    throw new Error('JWT payload could not be decoded');
  }
  if (typeof payload['exp'] !== 'number') {
    throw new Error('JWT is missing a numeric "exp" claim');
  }
  return payload['exp'];
}

// ─── Pre-flight checks on the toml ────────────────────────────────────────────

/**
 * Returns the parsed WEB_AUTH_ENDPOINT, refusing anything that is not https.
 * The challenge and the JWT both travel over this URL, so plain http would let
 * anyone on the path swap the challenge or read the token.
 */
export function requireHttpsWebAuthEndpoint(domain: string, webAuthEndpoint: string): URL {
  let url: URL;
  try {
    url = new URL(webAuthEndpoint);
  } catch {
    throw new Sep10ChallengeRejectedError(
      domain,
      'INSECURE_ENDPOINT',
      `WEB_AUTH_ENDPOINT "${webAuthEndpoint}" is not a valid URL`
    );
  }
  if (url.protocol !== 'https:') {
    throw new Sep10ChallengeRejectedError(
      domain,
      'INSECURE_ENDPOINT',
      `WEB_AUTH_ENDPOINT must use https, got "${url.protocol}//${url.host}"`
    );
  }
  return url;
}

/**
 * Returns the anchor's SIGNING_KEY, failing closed when it is absent or not a
 * valid Stellar public key. Without it there is no way to tell a challenge the
 * anchor issued from one somebody else built, so authentication must not start.
 */
export function requireSigningKey(domain: string, signingKey: string | null | undefined): string {
  if (!signingKey) {
    throw new Sep10ChallengeRejectedError(
      domain,
      'MISSING_SIGNING_KEY',
      'its stellar.toml does not publish a SIGNING_KEY'
    );
  }
  if (!StrKey.isValidEd25519PublicKey(signingKey)) {
    throw new Sep10ChallengeRejectedError(
      domain,
      'MISSING_SIGNING_KEY',
      'its stellar.toml SIGNING_KEY is not a valid Stellar public key'
    );
  }
  return signingKey;
}

// ─── Challenge validation ─────────────────────────────────────────────────────

/** Clock-skew allowance on either side of the challenge's timebounds (seconds). */
const TIMEBOUNDS_GRACE_SECONDS = 5 * 60;
/**
 * Longest timebounds window accepted (seconds). SEP-10 suggests 15 minutes,
 * but honest mainnet anchors issue up to 24 hours (cowrie and zeam both do), so
 * the cap sits there. It is a sanity bound, not a security control: a
 * sequence-0 challenge can never be submitted, however long it stays valid.
 */
const MAX_CHALLENGE_WINDOW_SECONDS = 24 * 60 * 60;

/**
 * Verifies a SEP-10 challenge before it goes anywhere near the wallet.
 *
 * The SDK's `WebAuth.readChallengeTx` is stricter than several honest mainnet
 * anchors (a text memo, a `web_auth_domain` set to the home domain, an auth
 * key naming the endpoint host), so the checks are implemented here and split
 * into two groups.
 *
 * Strict — these are what stop a real transaction being passed off as a login:
 * mainnet network; sequence number 0 (so the envelope can never be submitted);
 * source account is the toml's SIGNING_KEY; a valid SIGNING_KEY signature over
 * the mainnet hash; every operation is manage_data; the first operation is
 * sourced from the connected wallet and keyed `<d> auth` for one of this
 * anchor's domains; later operations are sourced from SIGNING_KEY (or are
 * `client_domain`); timebounds present, finite, current and no wider than 24
 * hours.
 *
 * Tolerated — cosmetic deviations that cannot move funds on a sequence-0
 * transaction: a missing `web_auth_domain` operation, or one whose value is any
 * of the anchor's domains rather than exactly the endpoint host; a text memo
 * (id and none are the spec; hash and return memos are still refused).
 */
export function validateSep10Challenge(
  transaction: string,
  networkPassphrase: string,
  expected: Sep10ChallengeExpectations,
  domain: string
): Sep10Challenge {
  if (networkPassphrase !== Networks.PUBLIC) {
    throw new ChallengeError(
      `Challenge is for wrong network: "${networkPassphrase}". Expected Stellar mainnet.`,
      'WRONG_NETWORK'
    );
  }

  const serverSigningKey = requireSigningKey(domain, expected.serverSigningKey);
  const webAuthUrl = requireHttpsWebAuthEndpoint(domain, expected.webAuthEndpoint);
  const reject = (detail: string): never => {
    throw new Sep10ChallengeRejectedError(domain, 'INVALID_CHALLENGE', detail);
  };

  const allowedDomains = new Set(
    [
      ...(Array.isArray(expected.homeDomains) ? expected.homeDomains : [expected.homeDomains]),
      webAuthUrl.hostname,
    ].map((d) => d.toLowerCase())
  );

  let tx: Transaction;
  try {
    const parsed = TransactionBuilder.fromXDR(transaction, Networks.PUBLIC);
    if (!(parsed instanceof Transaction)) {
      return reject('the challenge is a fee-bump transaction');
    }
    tx = parsed;
  } catch {
    return reject('the challenge is not a readable Stellar transaction');
  }

  // ── Strict ──
  if (tx.sequence !== '0') reject('the transaction sequence number is not zero');
  if (tx.source !== serverSigningKey) {
    reject("the transaction source is not the anchor's SIGNING_KEY");
  }

  const [first, ...rest] = tx.operations;
  if (!first) return reject('the transaction has no operations');
  if (tx.operations.some((op) => op.type !== 'manageData')) {
    reject('the transaction contains operations other than manage_data');
  }
  // Narrowed by the check above; re-asserted for the type system.
  if (first.type !== 'manageData') return reject('the first operation is not manage_data');

  if (first.source !== expected.clientAccountId) {
    throw new Sep10ChallengeRejectedError(
      domain,
      'WRONG_ACCOUNT',
      'the challenge is for a different account than the connected wallet'
    );
  }
  const authSuffix = ' auth';
  const authDomain = first.name.endsWith(authSuffix)
    ? first.name.slice(0, -authSuffix.length).toLowerCase()
    : null;
  if (!authDomain || !allowedDomains.has(authDomain)) {
    reject(`the auth key "${first.name}" does not name this anchor's domain`);
  }
  if (!first.value || first.value.length === 0) reject('the auth nonce is empty');

  for (const op of rest) {
    if (op.type !== 'manageData') continue; // already rejected above
    if (op.name === 'client_domain') continue; // sourced from the client domain's key by spec
    if (op.source !== serverSigningKey) {
      reject(`the "${op.name}" operation is not sourced from the anchor's SIGNING_KEY`);
    }
    // Tolerated: absent, or naming any of this anchor's domains.
    if (op.name === 'web_auth_domain') {
      const value = op.value ? new TextDecoder().decode(op.value).toLowerCase() : '';
      if (!allowedDomains.has(value)) {
        reject(`the web_auth_domain "${value}" does not match this anchor`);
      }
    }
  }

  const bounds = tx.timeBounds;
  if (!bounds) return reject('the transaction has no timebounds');
  const minTime = Number.parseInt(bounds.minTime, 10);
  const maxTime = Number.parseInt(bounds.maxTime, 10);
  if (!Number.isFinite(maxTime) || maxTime === 0) reject('the transaction never expires');
  const now = Math.floor(Date.now() / 1000);
  // Measured from now rather than from minTime: some servers leave minTime at
  // 0, and what matters is how long the signed challenge stays usable.
  if (maxTime - now > MAX_CHALLENGE_WINDOW_SECONDS + TIMEBOUNDS_GRACE_SECONDS) {
    reject('the transaction is valid for longer than 24 hours');
  }
  if (now < minTime - TIMEBOUNDS_GRACE_SECONDS) reject('the transaction is not valid yet');
  if (now > maxTime + TIMEBOUNDS_GRACE_SECONDS) reject('the transaction has expired');

  // Tolerated: text memo. Hash and return memos have no place in a login.
  if (tx.memo.type !== MemoNone && tx.memo.type !== MemoID && tx.memo.type !== MemoText) {
    reject(`the transaction carries a ${tx.memo.type} memo`);
  }

  // Signature over the mainnet hash, so this also re-pins the network.
  const serverKey = Keypair.fromPublicKey(serverSigningKey);
  const hash = tx.hash();
  const signed = tx.signatures.some((sig) => {
    try {
      return serverKey.verify(hash, sig.signature.toBytes());
    } catch {
      return false; // malformed signature bytes
    }
  });
  if (!signed) reject("the transaction is not signed by the anchor's SIGNING_KEY");

  const challenge = Object.freeze({
    transaction,
    network_passphrase: Networks.PUBLIC,
    parsed: tx,
    clientAccountID: first.source,
    homeDomain: authDomain as string,
  }) as Sep10Challenge;
  validatedChallenges.add(challenge);
  return challenge;
}

// ─── fetchSep10Challenge ──────────────────────────────────────────────────────

/**
 * Fetches the anchor's SEP-10 challenge and returns it only once it has passed
 * {@link validateSep10Challenge}. This is the single way a challenge enters
 * the sign flow.
 *
 * @param webAuthEndpoint - WEB_AUTH_ENDPOINT from the anchor's stellar.toml (https only).
 * @param publicKey - The connected wallet's account.
 * @param homeDomain - The domain whose stellar.toml advertised this endpoint.
 * @param serverSigningKey - SIGNING_KEY from that same stellar.toml.
 * @param extraHomeDomains - Other domains this anchor is known by that the
 *   challenge may legitimately name.
 */
export async function fetchSep10Challenge(
  webAuthEndpoint: string,
  publicKey: string,
  homeDomain: string,
  serverSigningKey: string | null | undefined,
  extraHomeDomains: string[] = []
): Promise<Sep10Challenge> {
  // Both pre-flight checks run before any network request, so a toml that
  // cannot support a verifiable login never gets as far as fetching one.
  const signingKey = requireSigningKey(homeDomain, serverSigningKey);
  const url = requireHttpsWebAuthEndpoint(homeDomain, webAuthEndpoint);
  url.searchParams.set('account', publicKey);
  url.searchParams.set('home_domain', homeDomain);

  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch (err) {
    throw new ChallengeError(
      `Network error fetching challenge from ${webAuthEndpoint}: ${String(err)}`,
      'FETCH_FAILED'
    );
  }

  if (!res.ok) {
    throw new ChallengeError(
      `Challenge fetch failed: HTTP ${res.status} from ${webAuthEndpoint}`,
      'FETCH_FAILED'
    );
  }

  const data = (await res.json()) as Record<string, unknown>;

  const transaction = data['transaction'];
  if (!transaction || typeof transaction !== 'string') {
    throw new ChallengeError(
      `Missing "transaction" field in challenge response from ${webAuthEndpoint}`,
      'MISSING_FIELD'
    );
  }

  const network_passphrase = data['network_passphrase'];
  if (!network_passphrase || typeof network_passphrase !== 'string') {
    throw new ChallengeError(
      `Missing "network_passphrase" field in challenge response from ${webAuthEndpoint}`,
      'MISSING_FIELD'
    );
  }

  const homeDomains = [...new Set([homeDomain, ...extraHomeDomains])];
  return validateSep10Challenge(
    transaction,
    network_passphrase,
    { serverSigningKey: signingKey, homeDomains, webAuthEndpoint, clientAccountId: publicKey },
    homeDomain
  );
}

// ─── Challenge signing ────────────────────────────────────────────────────────

/**
 * Hands a validated challenge to Freighter. Accepts only what
 * {@link validateSep10Challenge} produced — there is deliberately no overload
 * that takes a bare XDR string.
 */
export async function signChallenge(challenge: Sep10Challenge): Promise<string> {
  if (!validatedChallenges.has(challenge)) {
    throw new ChallengeError(
      'Refusing to sign a SEP-10 challenge that was not validated',
      'NOT_VALIDATED'
    );
  }
  const { transaction: challengeXdr, network_passphrase: networkPassphrase } = challenge;
  const { signTransaction, getNetwork } = await import('@stellar/freighter-api');

  // Pre-sign guard. Freighter surfaces an opaque error when its selected
  // network doesn't match the transaction's passphrase, so detect the mismatch
  // here and raise actionable guidance instead. If the network can't be read,
  // fall through and let the sign attempt proceed.
  try {
    const net = await getNetwork();
    if (!net.error && net.networkPassphrase && net.networkPassphrase !== networkPassphrase) {
      throw new NetworkMismatchError(
        networkNameForPassphrase(networkPassphrase),
        networkNameForPassphrase(net.networkPassphrase)
      );
    }
  } catch (err) {
    if (err instanceof NetworkMismatchError) throw err;
    // Couldn't read Freighter's network — proceed and let signing surface any issue.
  }

  const result = await signTransaction(challengeXdr, { networkPassphrase });

  if (result.error) {
    throw new UserRejectedError();
  }

  return result.signedTxXdr;
}

// ─── JWT exchange ─────────────────────────────────────────────────────────────

export async function submitChallenge(
  webAuthEndpoint: string,
  signedXdr: string
): Promise<{ token: string; expiresAt: Date }> {
  const res = await fetch(webAuthEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: signedXdr }),
  });

  if (!res.ok) {
    throw new Sep10AuthError(
      `JWT exchange failed: HTTP ${res.status} from ${webAuthEndpoint}`,
      res.status
    );
  }

  const data = (await res.json()) as Record<string, unknown>;
  const token = data['token'];

  if (!token || typeof token !== 'string') {
    throw new Error(`Missing "token" field in JWT response from ${webAuthEndpoint}`);
  }

  const exp = decodeJwtExp(token);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (exp <= nowSeconds) {
    throw new Error(`JWT has already expired (exp: ${exp})`);
  }

  return { token, expiresAt: new Date(exp * 1000) };
}

// ─── Full auth orchestrator ───────────────────────────────────────────────────

export async function authenticate(
  anchorOrDomain: ResolvedAnchor | string,
  publicKey: string
): Promise<Sep10Auth> {
  const anchor =
    typeof anchorOrDomain === 'string'
      ? await resolveAuthenticationAnchor(anchorOrDomain)
      : anchorOrDomain;

  const cached = getCachedJwt(anchor.homeDomain, publicKey);
  if (cached) return cached;

  const webAuthEndpoint = anchor.WEB_AUTH_ENDPOINT;
  if (!webAuthEndpoint || !anchor.capabilities.sep10) {
    throw new Error(`Anchor "${anchor.homeDomain}" does not support SEP-10 authentication.`);
  }
  // The SEP-10 home domain is the domain whose stellar.toml published this
  // endpoint and key. For anchors resolved through a service domain that
  // differs from the registry's homeDomain, accept either name.
  const tomlDomain = anchor.domain || anchor.homeDomain;
  const challenge = await fetchSep10Challenge(
    webAuthEndpoint,
    publicKey,
    tomlDomain,
    anchor.SIGNING_KEY,
    [anchor.homeDomain]
  );
  const signedXdr = await signChallenge(challenge);
  const { token: jwt, expiresAt } = await submitChallenge(webAuthEndpoint, signedXdr);

  const auth: Sep10Auth = { jwt, anchorDomain: anchor.homeDomain, publicKey, expiresAt };
  setCachedJwt(auth);
  return auth;
}

async function resolveAuthenticationAnchor(domain: string): Promise<ResolvedAnchor> {
  const sep1 = await resolveAnchor(domain);
  if (!sep1.capabilities.sep10) {
    throw new Error(`Anchor "${domain}" does not support SEP-10 authentication.`);
  }

  return {
    id: domain,
    name: domain,
    homeDomain: domain,
    corridors: [],
    assetCode: '',
    assetIssuer: '',
    ...sep1,
  };
}

/**
 * Drop the cached JWT for this anchor/account pair. Call this when a
 * downstream anchor request returns 401, so the next `authenticate` call
 * re-runs the full sign flow.
 */
export function invalidateSep10Token(anchorDomain: string, publicKey: string): void {
  invalidateCachedJwt(anchorDomain, publicKey);
}
