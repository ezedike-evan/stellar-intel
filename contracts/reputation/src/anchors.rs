//! Anchor registry storage helpers.
//!
//! The registry is an ordered list of anchor ids held in instance storage.
//! Insertion order is preserved so `list_anchors` is deterministic.
//!
//! ## Footprint optimisation
//! Duplicate detection uses `DataKey::AnchorTag` (one persistent read) instead
//! of scanning the `Anchors` Vec.  The Vec is only written/read for the admin
//! list-view; it is never touched by the hot write paths.

use soroban_sdk::{Env, String, Vec};

use crate::storage::DataKey;
use crate::Error;

/// Load the current anchor list (empty if none registered yet).
pub fn list(env: &Env) -> Vec<String> {
    env.storage()
        .instance()
        .get(&DataKey::Anchors)
        .unwrap_or_else(|| Vec::new(env))
}

/// Append an anchor id to the registry. Returns `AnchorExists` if the id is
/// already present.
///
/// Existence is checked via a single persistent `AnchorTag` read; the full
/// `Anchors` list is only loaded to append the new entry for `list_anchors`.
pub fn register(env: &Env, anchor_id: String) -> Result<(), Error> {
    let tag_key = DataKey::AnchorTag(anchor_id.clone());
    if env.storage().persistent().has(&tag_key) {
        return Err(Error::AnchorExists);
    }

    env.storage().persistent().set(&tag_key, &true);

    let mut anchors = list(env);
    anchors.push_back(anchor_id);
    env.storage().instance().set(&DataKey::Anchors, &anchors);
    Ok(())
}
