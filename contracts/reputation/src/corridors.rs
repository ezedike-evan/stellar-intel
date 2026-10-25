//! Corridor registry storage helpers.
//!
//! Mirrors `anchors.rs`: an ordered list of corridor ids in instance storage
//! (admin list-view only), with a per-corridor persistent `CorridorTag` so the
//! publisher write paths check membership with one read and never load the list.
//!
//! Without a registry, `publish_corridor_rate` and `add_volume_savings` accepted
//! any corridor string, so a publisher key could create unlimited persistent
//! entries under invented ids (audit M-5).

use soroban_sdk::{Env, String, Vec};

use crate::storage::DataKey;
use crate::Error;

/// Load the current corridor list (empty if none registered yet).
pub fn list(env: &Env) -> Vec<String> {
    env.storage()
        .instance()
        .get(&DataKey::Corridors)
        .unwrap_or_else(|| Vec::new(env))
}

/// Append a corridor id to the registry. Returns `CorridorExists` if the id is
/// already present.
pub fn register(env: &Env, corridor: String) -> Result<(), Error> {
    let tag_key = DataKey::CorridorTag(corridor.clone());
    if env.storage().persistent().has(&tag_key) {
        return Err(Error::CorridorExists);
    }

    env.storage().persistent().set(&tag_key, &true);
    crate::storage::extend_persistent(env, &tag_key);

    let mut corridors = list(env);
    corridors.push_back(corridor);
    env.storage()
        .instance()
        .set(&DataKey::Corridors, &corridors);
    Ok(())
}

/// True when `corridor` is in the registry. One persistent `CorridorTag` read.
pub fn is_registered(env: &Env, corridor: &String) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::CorridorTag(corridor.clone()))
}
