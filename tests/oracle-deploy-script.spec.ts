// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Keypair, scValToNative, xdr } from '@stellar/stellar-sdk';
import { buildDeployOperation, parseArgs } from '@/scripts/lib/oracle-deploy';

// The contract's __constructor(admin, upgrade_admin) binds both authorities at
// deploy. The mainnet script passed no constructor arguments, so an instance
// deployed with it would have had neither bound (#1404). These tests make no
// network calls.

const ADMIN = Keypair.random().publicKey();
const UPGRADE_ADMIN = Keypair.random().publicKey();
const HASH = 'ab'.repeat(32);

const deployArgs = (...extra: string[]) => [
  '--mode',
  'deploy-contract',
  '--wasm-hash',
  HASH,
  ...extra,
];

describe('parseArgs: deploy-contract (#1404)', () => {
  it('accepts two distinct admins given as flags', () => {
    const args = parseArgs(deployArgs('--admin', ADMIN, '--upgrade-admin', UPGRADE_ADMIN), {});
    expect(args.admin).toBe(ADMIN);
    expect(args.upgradeAdmin).toBe(UPGRADE_ADMIN);
    expect(args.mode).toBe('deploy-contract');
  });

  it('falls back to ORACLE_ADMIN and ORACLE_UPGRADE_ADMIN', () => {
    const args = parseArgs(deployArgs(), {
      ORACLE_ADMIN: ADMIN,
      ORACLE_UPGRADE_ADMIN: UPGRADE_ADMIN,
    });
    expect(args.admin).toBe(ADMIN);
    expect(args.upgradeAdmin).toBe(UPGRADE_ADMIN);
  });

  it('lets a flag override the environment', () => {
    const other = Keypair.random().publicKey();
    const args = parseArgs(deployArgs('--admin', other), {
      ORACLE_ADMIN: ADMIN,
      ORACLE_UPGRADE_ADMIN: UPGRADE_ADMIN,
    });
    expect(args.admin).toBe(other);
  });

  it('rejects a missing --admin', () => {
    expect(() => parseArgs(deployArgs('--upgrade-admin', UPGRADE_ADMIN), {})).toThrow(/--admin/);
  });

  it('rejects a missing --upgrade-admin', () => {
    expect(() => parseArgs(deployArgs('--admin', ADMIN), {})).toThrow(/--upgrade-admin/);
  });

  it('rejects equal admin and upgrade-admin addresses', () => {
    expect(() => parseArgs(deployArgs('--admin', ADMIN, '--upgrade-admin', ADMIN), {})).toThrow(
      /different accounts/
    );
  });

  it('rejects a malformed G-address', () => {
    expect(() =>
      parseArgs(deployArgs('--admin', 'not-an-address', '--upgrade-admin', UPGRADE_ADMIN), {})
    ).toThrow(/valid Stellar public key/);
    // A secret key is not a public key, and must not be accepted by mistake.
    expect(() =>
      parseArgs(
        deployArgs('--admin', Keypair.random().secret(), '--upgrade-admin', UPGRADE_ADMIN),
        {}
      )
    ).toThrow(/valid Stellar public key/);
  });

  it('does not require the admins to upload the wasm', () => {
    const args = parseArgs(['--mode', 'upload-wasm'], {});
    expect(args.mode).toBe('upload-wasm');
    expect(args.admin).toBeNull();
  });

  it('defaults to a dry run, and refuses --live together with --dry-run', () => {
    const args = parseArgs(deployArgs('--admin', ADMIN, '--upgrade-admin', UPGRADE_ADMIN), {});
    expect(args.dryRun).toBe(true);
    expect(() =>
      parseArgs(
        deployArgs('--admin', ADMIN, '--upgrade-admin', UPGRADE_ADMIN, '--live', '--dry-run'),
        {}
      )
    ).toThrow(/either --dry-run or --live/);
  });

  it('reports --help instead of exiting the process', () => {
    expect(parseArgs(['--help'], {}).help).toBe(true);
  });
});

describe('buildDeployOperation (#1404)', () => {
  const deployer = Keypair.random().publicKey();

  /** The CreateContractV2 args of the operation, round-tripped through XDR. */
  function createArgsOf(op: ReturnType<typeof buildDeployOperation>) {
    const body = xdr.Operation.fromXDR(op.toXDR()).body;
    if (body.type !== 'invokeHostFunction') {
      throw new Error(`expected an invoke-host-function operation, got ${body.type}`);
    }
    const hostFunction = body.invokeHostFunctionOp.hostFunction;
    if (hostFunction.type !== 'hostFunctionTypeCreateContractV2') {
      throw new Error(`expected a CreateContractV2 host function, got ${hostFunction.type}`);
    }
    return hostFunction.createContractV2;
  }

  const op = () =>
    buildDeployOperation({
      deployer,
      wasmHash: Buffer.from(HASH, 'hex'),
      salt: Buffer.alloc(32, 7),
      admin: ADMIN,
      upgradeAdmin: UPGRADE_ADMIN,
    });

  it('carries the admin and upgrade admin as the two constructor args, in that order', () => {
    const args = createArgsOf(op()).constructorArgs;
    expect(args).toHaveLength(2);
    expect(scValToNative(args[0]!)).toBe(ADMIN);
    expect(scValToNative(args[1]!)).toBe(UPGRADE_ADMIN);
  });

  it('creates the contract from the given wasm hash and salt', () => {
    const create = createArgsOf(op());

    if (create.executable.type !== 'contractExecutableWasm') {
      throw new Error('expected a wasm executable');
    }
    expect(Buffer.from(create.executable.wasmHash.toBytes()).toString('hex')).toBe(HASH);

    const preimage = create.contractIdPreimage;
    if (preimage.type !== 'contractIdPreimageFromAddress') {
      throw new Error('expected an address preimage');
    }
    expect(Buffer.from(preimage.fromAddress.salt.toBytes()).equals(Buffer.alloc(32, 7))).toBe(true);
  });
});
