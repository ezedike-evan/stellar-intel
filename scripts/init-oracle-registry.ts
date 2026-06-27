/**
 * Seed the on-chain reputation oracle registry with the anchors defined in
 * constants/anchors.ts.
 *
 * Required env vars:
 *   ORACLE_CONTRACT_ID           — deployed Soroban reputation contract address (C…)
 *   ADMIN_SECRET_KEY             — admin keypair secret (S…)
 *
 * Optional env vars (defaults shown):
 *   NEXT_PUBLIC_STELLAR_NETWORK  — "mainnet" | "testnet"  (default: testnet)
 *   ORACLE_RPC_URL               — Soroban RPC endpoint
 *                                  (default: https://soroban-testnet.stellar.org)
 *
 * Usage:
 *   tsx --tsconfig tsconfig.scripts.json scripts/init-oracle-registry.ts
 */

import { contract, Keypair, Networks } from '@stellar/stellar-sdk';
import { ANCHORS } from '../constants/anchors';

// ─── Config ───────────────────────────────────────────────────────────────────

const CONTRACT_ID = process.env['ORACLE_CONTRACT_ID'];
const ADMIN_SECRET = process.env['ADMIN_SECRET_KEY'];
const NETWORK = process.env['NEXT_PUBLIC_STELLAR_NETWORK'] ?? 'testnet';
const RPC_URL =
  process.env['ORACLE_RPC_URL'] ??
  (NETWORK === 'mainnet'
    ? 'https://mainnet.sorobanrpc.com'
    : 'https://soroban-testnet.stellar.org');
const NETWORK_PASSPHRASE = NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

if (!CONTRACT_ID) throw new Error('ORACLE_CONTRACT_ID is required');
if (!ADMIN_SECRET) throw new Error('ADMIN_SECRET_KEY is required');

// ─── Types ────────────────────────────────────────────────────────────────────

type OracleClient = contract.Client & {
  register_anchor(args: {
    admin: string;
    anchor_id: string;
  }): Promise<{ signAndSend(): Promise<unknown> }>;
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const adminKeypair = Keypair.fromSecret(ADMIN_SECRET!);
  const { signTransaction } = contract.basicNodeSigner(adminKeypair, NETWORK_PASSPHRASE);

  // Build a contract client — reads the contract interface from the network at
  // runtime so method args are mapped automatically.
  const client = (await contract.Client.from({
    contractId: CONTRACT_ID!,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    publicKey: adminKeypair.publicKey(),
    signTransaction,
  })) as unknown as OracleClient;

  console.log(`Network:  ${NETWORK}`);
  console.log(`Contract: ${CONTRACT_ID}`);
  console.log(`Admin:    ${adminKeypair.publicKey()}`);
  console.log(`Anchors:  ${ANCHORS.map((a) => a.id).join(', ')}\n`);

  for (const anchor of ANCHORS) {
    process.stdout.write(`  register_anchor("${anchor.id}") … `);
    try {
      const tx = await client.register_anchor({
        admin: adminKeypair.publicKey(),
        anchor_id: anchor.id,
      });
      await tx.signAndSend();
      console.log('✓');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // AnchorExists is non-fatal — the registry may already be partially seeded.
      if (msg.includes('AnchorExists')) {
        console.log('already registered, skipping');
      } else {
        console.error(`FAILED: ${msg}`);
        process.exitCode = 1;
      }
    }
  }

  if (!process.exitCode) {
    console.log('\nRegistry seeded. Verify with:');
    console.log(
      `  soroban contract invoke --id ${CONTRACT_ID} --network ${NETWORK} -- list_anchors`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
