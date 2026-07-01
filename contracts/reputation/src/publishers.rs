//! Publisher whitelist storage helpers.
//!
//! Publishers are held in instance storage and only authorized publishers can
//! submit outcomes once the purge endpoint is enabled.
//!
//! ## Footprint optimisation
//! Each publisher has a dedicated `DataKey::Publisher(addr)` persistent entry.
//! `is_authorized` costs one persistent read instead of scanning the full Vec.
//! The `Publishers` Vec in instance storage is maintained only for the admin
//! list-view; it is never touched by the hot write paths.

use soroban_sdk::{Address, Env, Vec};

use crate::storage::DataKey;
use crate::Error;

/// Load the current publisher whitelist (empty if none registered yet).
pub fn list(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Publishers)
        .unwrap_or_else(|| Vec::new(env))
}

/// Append a publisher to the whitelist. Returns `PublisherExists` if the
/// address is already present.
///
/// Membership is checked via a single persistent `Publisher` read; the full
/// `Publishers` Vec is only loaded to append for `list_publishers`.
pub fn add(env: &Env, publisher: Address) -> Result<(), Error> {
    let flag_key = DataKey::Publisher(publisher.clone());
    if env.storage().persistent().has(&flag_key) {
        return Err(Error::PublisherExists);
    }

    env.storage().persistent().set(&flag_key, &true);

    let mut publishers = list(env);
    publishers.push_back(publisher);
    env.storage().instance().set(&DataKey::Publishers, &publishers);
    Ok(())
}

/// Remove a publisher from the whitelist. Returns `PublisherNotFound` if it
/// does not exist.
pub fn revoke(env: &Env, publisher: Address) -> Result<(), Error> {
    let flag_key = DataKey::Publisher(publisher.clone());
    if !env.storage().persistent().has(&flag_key) {
        return Err(Error::PublisherNotFound);
    }

    env.storage().persistent().remove(&flag_key);

    let publishers = list(env);
    let mut remaining = Vec::new(env);
    for existing in publishers.iter() {
        if existing != publisher {
            remaining.push_back(existing);
        }
    }
    env.storage().instance().set(&DataKey::Publishers, &remaining);
    Ok(())
}

/// Checks whether the caller is currently authorized to submit outcomes.
///
/// Single persistent read — O(1) regardless of whitelist size.
pub fn is_authorized(env: &Env, publisher: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Publisher(publisher.clone()))
}
