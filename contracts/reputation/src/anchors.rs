//! Anchor registry storage helpers.
//!
//! The registry is an ordered list of anchor ids held in instance storage.
//! Insertion order is preserved so `list_anchors` is deterministic.

use soroban_sdk::{Env, String, Vec};

use crate::{admin::DataKey, Error};

/// Load the current anchor list (empty if none registered yet).
pub fn list(env: &Env) -> Vec<String> {
    env.storage()
        .instance()
        .get(&DataKey::Anchors)
        .unwrap_or_else(|| Vec::new(env))
}

/// Append an anchor id to the registry. Returns `AnchorExists` if the id is
/// already present.
pub fn register(env: &Env, anchor_id: String) -> Result<(), Error> {
    let mut anchors = list(env);

    for existing in anchors.iter() {
        if existing == anchor_id {
            return Err(Error::AnchorExists);
        }
    }

    anchors.push_back(anchor_id);
    env.storage().instance().set(&DataKey::Anchors, &anchors);
    Ok(())
}
