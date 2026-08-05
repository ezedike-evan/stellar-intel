//! Admin-gated contract upgrade hook (roadmap #197, issue #352).
//!
//! Implements Soroban's standard in-place upgrade pattern: an authorized admin
//! swaps the contract's WASM bytecode via the deployer's
//! `update_current_contract_wasm`. That host operation replaces only the
//! executable code — it never touches the
//! contract's storage entries — so every persisted value (anchor outcomes, the
//! anchor registry, the version stamp) survives the upgrade untouched. A
//! monotonically increasing version is persisted so callers can observe which
//! revision is live.
//!
//! The module owns its admin and version keys outright. This keeps the upgrade
//! authority independent of the wider admin lifecycle that other sub-issues of
//! #197 are still wiring up, so the hook compiles and is testable on its own.

use soroban_sdk::{contracttype, Address, BytesN, Env};

use crate::Error;

/// Instance-storage keys owned by this module.
///
/// The variant names are intentionally distinct from keys used elsewhere in the
/// contract so the serialized keys can never collide with another module's
/// storage.
#[contracttype]
#[derive(Clone)]
enum UpgradeKey {
    /// Address authorized to upgrade the contract.
    UpgradeAdmin,
    /// Live contract version, bumped on every successful upgrade.
    Version,
    /// Address nominated to become the upgrade admin, pending its acceptance.
    PendingUpgradeAdmin,
}

/// Version stamped on a freshly initialized contract, before any upgrade.
const INITIAL_VERSION: u32 = 1;

/// Bind the upgrade administrator and stamp the initial version.
///
/// One-shot: panics if the upgrade admin has already been set, so the authority
/// cannot be silently rotated by a later caller. Deliberate rotation goes
/// through [`propose_upgrade_admin`] / [`accept_upgrade_admin`] (#963).
pub fn init(env: &Env, admin: Address) {
    let storage = env.storage().instance();
    if storage.has(&UpgradeKey::UpgradeAdmin) {
        panic!("upgrade admin already initialized");
    }
    storage.set(&UpgradeKey::UpgradeAdmin, &admin);
    storage.set(&UpgradeKey::Version, &INITIAL_VERSION);
}

/// Swap the contract's WASM to `new_wasm_hash`, preserving all stored state.
///
/// Requires the stored upgrade admin's authorization. The persisted version is
/// incremented *before* the swap so the freshly installed bytecode boots on the
/// bumped version.
pub fn apply(env: &Env, new_wasm_hash: BytesN<32>) {
    let storage = env.storage().instance();
    let admin: Address = storage
        .get(&UpgradeKey::UpgradeAdmin)
        .expect("upgrade admin not initialized");

    // Admin-only: reverts unless the stored admin signed this invocation.
    admin.require_auth();

    let next = current_version(env) + 1;
    storage.set(&UpgradeKey::Version, &next);

    env.deployer().update_current_contract_wasm(new_wasm_hash);
}

/// Return the address authorized to upgrade the contract, if one is bound.
///
/// Read-only. Exposed so custody can be audited from outside: whether the
/// upgrade authority is a different account from the operational admin, and
/// whether either is a multisig account, is otherwise unobservable — you would
/// have to trust an assertion about it (#913).
pub fn get_upgrade_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&UpgradeKey::UpgradeAdmin)
}

/// Return the live contract version, or `0` if the upgrade hook is uninitialized.
pub fn current_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&UpgradeKey::Version)
        .unwrap_or(0)
}

// ─── Rotation (#963) ──────────────────────────────────────────────────────────
//
// `init` is one-shot, and for a long time that was the only way to set this
// role — so once bound it could never be changed. A lost key meant the contract
// could never be upgraded again; a compromised one could not be revoked. That
// is a sharper problem than for the operational admin, because `apply` replaces
// the contract's entire code.
//
// Two-step, mirroring `admin.rs`: the nominee must accept, so a mistyped
// address cannot brick the role rather than merely failing.

/// Read the stored upgrade admin, or `Unauthorized` when unset.
fn require_upgrade_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    let admin: Address = env
        .storage()
        .instance()
        .get(&UpgradeKey::UpgradeAdmin)
        .ok_or(Error::NotInitialized)?;

    if &admin != caller {
        return Err(Error::Unauthorized);
    }

    admin.require_auth();
    Ok(())
}

/// Nominate a new upgrade administrator (step 1 of 2).
///
/// Takes effect only when `candidate` calls [`accept_upgrade_admin`]. At most
/// one proposal is live; a second call replaces the pending candidate.
pub fn propose_upgrade_admin(
    env: &Env,
    caller: &Address,
    candidate: &Address,
) -> Result<(), Error> {
    require_upgrade_admin(env, caller)?;
    env.storage()
        .instance()
        .set(&UpgradeKey::PendingUpgradeAdmin, candidate);
    Ok(())
}

/// Accept a pending upgrade-admin proposal (step 2 of 2).
///
/// `candidate` must be the address stored by [`propose_upgrade_admin`] and must
/// authorize this call — which is the property that makes a typo recoverable:
/// an address nobody controls can never accept, so the role stays where it is.
pub fn accept_upgrade_admin(env: &Env, candidate: &Address) -> Result<(), Error> {
    let pending: Address = env
        .storage()
        .instance()
        .get(&UpgradeKey::PendingUpgradeAdmin)
        .ok_or(Error::Unauthorized)?;

    if &pending != candidate {
        return Err(Error::Unauthorized);
    }

    candidate.require_auth();
    env.storage()
        .instance()
        .set(&UpgradeKey::UpgradeAdmin, candidate);
    env.storage()
        .instance()
        .remove(&UpgradeKey::PendingUpgradeAdmin);
    Ok(())
}

/// Withdraw a pending proposal. Current upgrade admin only.
pub fn cancel_upgrade_proposal(env: &Env, caller: &Address) -> Result<(), Error> {
    require_upgrade_admin(env, caller)?;
    env.storage()
        .instance()
        .remove(&UpgradeKey::PendingUpgradeAdmin);
    Ok(())
}

/// The address nominated to become upgrade admin, if any.
///
/// Read-only, and exposed for the same reason as [`get_upgrade_admin`]: a
/// pending handover of the code-replacement authority should be observable from
/// outside rather than taken on trust (#913).
pub fn get_pending_upgrade_admin(env: &Env) -> Option<Address> {
    env.storage()
        .instance()
        .get(&UpgradeKey::PendingUpgradeAdmin)
}
