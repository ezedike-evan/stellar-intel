/**
 * Real SEP-10 challenge XDRs for tests, built with the SDK rather than
 * hand-written strings, so the validator is exercised against the same bytes an
 * anchor would send.
 */
import { randomBytes } from 'node:crypto';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  WebAuth,
} from '@stellar/stellar-sdk';
import type { xdr } from '@stellar/stellar-sdk';

export interface ValidChallengeOptions {
  server: Keypair;
  clientAccountId: string;
  homeDomain: string;
  webAuthDomain: string;
  timeoutSeconds?: number;
}

/** A spec-conformant challenge exactly as an honest anchor would issue it. */
export function buildValidChallenge(opts: ValidChallengeOptions): string {
  return WebAuth.buildChallengeTx(
    opts.server,
    opts.clientAccountId,
    opts.homeDomain,
    opts.timeoutSeconds ?? 300,
    Networks.PUBLIC,
    opts.webAuthDomain
  );
}

export interface CustomChallengeOptions {
  /** Transaction source account. Defaults to the signer's key. */
  sourceAccountId?: string;
  /** Keypair that signs the envelope; omit or pass null to leave it unsigned. */
  signer?: Keypair | null;
  sequence?: bigint;
  clientAccountId: string;
  homeDomain: string;
  webAuthDomain: string;
  /** Operations placed before the standard auth manage_data op. */
  prependOps?: xdr.Operation[];
  /** Operations appended after the web_auth_domain op. */
  appendOps?: xdr.Operation[];
  timeoutSeconds?: number;
}

/**
 * A challenge-shaped transaction with one property bent out of spec, for the
 * negative cases the SDK builder refuses to produce.
 */
export function buildCustomChallenge(opts: CustomChallengeOptions): string {
  const source = opts.sourceAccountId ?? opts.signer?.publicKey();
  if (!source) throw new Error('buildCustomChallenge needs a source account or a signer');

  // TransactionBuilder increments the account sequence once on build.
  const sequence = (opts.sequence ?? 0n) - 1n;
  // SEP-10 nonce: 48 random bytes, base64-encoded to 64 characters.
  const nonce = randomBytes(48).toString('base64');

  let builder = new TransactionBuilder(new Account(source, sequence.toString()), {
    fee: '100',
    networkPassphrase: Networks.PUBLIC,
  });
  for (const op of opts.prependOps ?? []) builder = builder.addOperation(op);
  builder = builder
    .addOperation(
      Operation.manageData({
        name: `${opts.homeDomain} auth`,
        value: nonce,
        source: opts.clientAccountId,
      })
    )
    .addOperation(
      Operation.manageData({
        name: 'web_auth_domain',
        value: opts.webAuthDomain,
        source,
      })
    );
  for (const op of opts.appendOps ?? []) builder = builder.addOperation(op);

  const tx = builder.setTimeout(opts.timeoutSeconds ?? 300).build();
  if (opts.signer) tx.sign(opts.signer);
  return tx.toEnvelope().toXDR('base64');
}

/** A payment out of the client's account — what a hostile anchor would try to sneak in. */
export function drainPayment(from: string, to: string): xdr.Operation {
  return Operation.payment({
    source: from,
    destination: to,
    asset: Asset.native(),
    amount: '1000',
  });
}
