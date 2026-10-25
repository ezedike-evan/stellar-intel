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

use crate::storage::{self, DataKey};
use crate::Error;

/// Most anchors the registry holds. The list lives in instance storage, which
/// every call loads, so an unbounded list would make every call dearer and past
/// the entry-size limit would brick the whole contract (audit L-14).
pub const MAX_ANCHORS: u32 = 200;

/// Longest accepted anchor id, in characters.
pub const MAX_ANCHOR_ID_LEN: u32 = 64;

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
    if anchor_id.is_empty() || anchor_id.len() > MAX_ANCHOR_ID_LEN {
        return Err(Error::OutOfRange);
    }

    let tag_key = DataKey::AnchorTag(anchor_id.clone());
    if env.storage().persistent().has(&tag_key) {
        return Err(Error::AnchorExists);
    }

    // Checked before the tag is written. A mistaken admin script loop should
    // fail cleanly here rather than grow the list until the instance bricks.
    let mut anchors = list(env);
    if anchors.len() >= MAX_ANCHORS {
        return Err(Error::LimitReached);
    }

    env.storage().persistent().set(&tag_key, &true);
    storage::extend_persistent(env, &tag_key);

    anchors.push_back(anchor_id);
    env.storage().instance().set(&DataKey::Anchors, &anchors);
    Ok(())
}

/// True when `anchor_id` is in the registry. One persistent `AnchorTag` read;
/// the `Anchors` list is not loaded.
pub fn is_registered(env: &Env, anchor_id: &String) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::AnchorTag(anchor_id.clone()))
}

/// The write-path gate: succeeds when `anchor_id` is registered, and extends the
/// tag's TTL so an anchor that is still being written for does not archive out
/// from under the publisher (audit P2, contract TTL). [`is_registered`] stays
/// for read-only use.
pub fn require_registered(env: &Env, anchor_id: &String) -> Result<(), Error> {
    let tag_key = DataKey::AnchorTag(anchor_id.clone());
    if !env.storage().persistent().has(&tag_key) {
        return Err(Error::AnchorNotRegistered);
    }
    storage::extend_persistent(env, &tag_key);
    Ok(())
}
