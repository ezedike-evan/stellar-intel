//! Admin authority for the reputation registry.
//!
//! Stores a single administrator address in instance storage and provides the
//! authorization gate used by mutating contract functions.
//!
//! ## Multisig governance
//!
//! The admin `Address` may be a Stellar multisig account — one whose
//! signature threshold requires M-of-N on-chain signers. `require_auth()`
//! delegates signature verification to the Stellar host, so no contract-level
//! vote counting is required. To migrate to multisig:
//!
//! 1. Create (or configure) a Stellar account with the desired signer set and
//!    medium-threshold equal to the required quorum (e.g. 2-of-3).
//! 2. Call `propose_admin` from the current single-key admin to nominate the
//!    multisig account.
//! 3. Have the multisig account call `accept_admin` (requiring M-of-N
//!    signatures on that transaction) to complete the handoff.
//!
//! See `docs/GOVERNANCE.md` for the full runbook and signer-change process.

use soroban_sdk::{Address, Env};

use crate::storage::DataKey;
use crate::Error;

/// Store the admin on first initialization. Returns `AlreadyInitialized` if an
/// admin is already set.
pub fn set_admin(env: &Env, admin: &Address) -> Result<(), Error> {
    if env.storage().instance().has(&DataKey::Admin) {
        return Err(Error::AlreadyInitialized);
    }
    env.storage().instance().set(&DataKey::Admin, admin);
    Ok(())
}

/// Read the stored admin, if initialized.
pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

/// Assert that `caller` is the stored admin and has authorized this invocation.
///
/// Returns:
///   - `NotInitialized` if `init` has not run,
///   - `Unauthorized`   if `caller` is not the stored admin.
pub fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)?;

    if &admin != caller {
        return Err(Error::Unauthorized);
    }

    admin.require_auth();
    Ok(())
}

/// Propose a new administrator (step 1 of 2 for a safe admin handoff).
///
/// The current admin nominates `candidate` as the next admin. The change does
/// not take effect until `candidate` calls `accept_admin`. At most one
/// proposal is live at a time; a second call replaces the pending candidate.
///
/// Returns `Unauthorized` if `caller` is not the current admin.
pub fn propose_admin(env: &Env, caller: &Address, candidate: &Address) -> Result<(), Error> {
    require_admin(env, caller)?;
    env.storage()
        .instance()
        .set(&DataKey::PendingAdmin, candidate);
    Ok(())
}

/// Accept a pending admin proposal (step 2 of 2).
///
/// `candidate` must be the address previously stored by `propose_admin`. On
/// success the stored admin is replaced by `candidate` and the pending
/// proposal is cleared.
///
/// Returns `Unauthorized` if there is no pending proposal or if `candidate`
/// does not match it.
pub fn accept_admin(env: &Env, candidate: &Address) -> Result<(), Error> {
    let pending: Address = env
        .storage()
        .instance()
        .get(&DataKey::PendingAdmin)
        .ok_or(Error::Unauthorized)?;

    if &pending != candidate {
        return Err(Error::Unauthorized);
    }

    candidate.require_auth();
    env.storage().instance().set(&DataKey::Admin, candidate);
    env.storage().instance().remove(&DataKey::PendingAdmin);
    Ok(())
}

/// Cancel a pending admin proposal.
///
/// Only the current admin may cancel. Clears the pending candidate without
/// transferring authority. No-op if no proposal is live.
///
/// Returns `Unauthorized` if `caller` is not the current admin.
pub fn cancel_admin_proposal(env: &Env, caller: &Address) -> Result<(), Error> {
    require_admin(env, caller)?;
    env.storage().instance().remove(&DataKey::PendingAdmin);
    Ok(())
}

/// Return the pending admin candidate, if any.
pub fn get_pending_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::PendingAdmin)
}
