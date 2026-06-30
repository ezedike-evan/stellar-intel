//! Admin authority for the reputation registry.
//!
//! Stores a single administrator address in instance storage and provides the
//! authorization gate used by mutating contract functions.

use soroban_sdk::{contracttype, Address, Env};

use crate::Error;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// The contract administrator.
    Admin,
    /// The list of registered anchor ids.
    Anchors,
    /// The whitelist of publisher addresses.
    Publishers,
}

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

    // Enforce that the admin actually signed this invocation.
    admin.require_auth();
    Ok(())
}
