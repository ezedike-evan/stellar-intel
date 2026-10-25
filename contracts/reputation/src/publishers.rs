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

use soroban_sdk::{Address, Env, String, Vec};

use crate::storage::{self, DataKey};
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
    storage::extend_persistent(env, &flag_key);

    let mut publishers = list(env);
    publishers.push_back(publisher);
    env.storage()
        .instance()
        .set(&DataKey::Publishers, &publishers);
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
    // A revoked publisher must not keep a scope that a later re-add would inherit.
    clear_scope(env, publisher.clone());

    let publishers = list(env);
    let mut remaining = Vec::new(env);
    for existing in publishers.iter() {
        if existing != publisher {
            remaining.push_back(existing);
        }
    }
    env.storage()
        .instance()
        .set(&DataKey::Publishers, &remaining);
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

/// The gate every publisher write goes through: the caller must have authorised
/// this invocation and be whitelisted.
///
/// Also extends the whitelist flag's TTL. The flag is read on every publisher
/// write and was otherwise written once and never extended, so after it
/// archived every write stalled until someone restored it (audit P2, contract
/// TTL). A publisher that is writing therefore keeps its own flag alive.
/// [`is_authorized`] stays for read-only use, which must not write.
pub fn require_publisher(env: &Env, publisher: &Address) -> Result<(), Error> {
    publisher.require_auth();

    let flag_key = DataKey::Publisher(publisher.clone());
    if !env.storage().persistent().has(&flag_key) {
        return Err(Error::PublisherUnauthorized);
    }
    storage::extend_persistent(env, &flag_key);
    Ok(())
}

/// Restrict `publisher` to the listed corridors. Replaces any earlier scope.
pub fn set_scope(env: &Env, publisher: Address, corridors: Vec<String>) {
    let key = DataKey::PublisherScope(publisher);
    env.storage().persistent().set(&key, &corridors);
    storage::extend_persistent(env, &key);
}

/// Remove `publisher`'s scope, restoring access to every registered corridor.
pub fn clear_scope(env: &Env, publisher: Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::PublisherScope(publisher));
}

/// The corridors `publisher` is limited to, or `None` if it is unscoped.
pub fn get_scope(env: &Env, publisher: &Address) -> Option<Vec<String>> {
    env.storage()
        .persistent()
        .get(&DataKey::PublisherScope(publisher.clone()))
}

/// Succeeds when `publisher` has no scope (backwards compatible) or its scope
/// contains `corridor`; otherwise `PublisherOutOfScope`. One leaked key then
/// can only touch the corridors it was granted (audit M-5, per-corridor
/// publisher scoping).
pub fn require_in_scope(env: &Env, publisher: &Address, corridor: &String) -> Result<(), Error> {
    match get_scope(env, publisher) {
        Some(scope) if !scope.contains(corridor) => Err(Error::PublisherOutOfScope),
        Some(_) => {
            // Keep a scope that is being used alive, like the publisher flag.
            storage::extend_persistent(env, &DataKey::PublisherScope(publisher.clone()));
            Ok(())
        }
        None => Ok(()),
    }
}
