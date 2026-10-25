use soroban_sdk::{Address, Env, String, Vec};

use crate::storage::{self, DataKey, PAGE_SIZE};
use crate::{aggregate, anchors, events, publishers, Error};

/// Upper bound on a single outcome's settle time (~11.6 days). Rejects absurd
/// values that would otherwise inflate the settle-seconds accumulator toward
/// overflow; any real settlement is far below this.
pub const MAX_SETTLE_SECONDS: u64 = 1_000_000;

/// Longest accepted `outcome_hash`, in characters. The publisher always sends a
/// 64-character hex SHA-256 (`buildOutcomeHash` in packages/publisher), so this
/// leaves no slack for anything else. Without a bound a compromised publisher
/// could submit oversized hashes until a 25-entry outcome page exceeds the
/// ledger-entry size limit, after which every later `submit_outcome` for that
/// anchor would trap (audit M-4).
pub const MAX_OUTCOME_HASH_LEN: u32 = 64;

/// Record one settlement outcome for an anchor on a corridor. Publisher-only.
///
/// `outcome_hash` must be 1 to [`MAX_OUTCOME_HASH_LEN`] (64) characters, and
/// `settle_seconds` at most [`MAX_SETTLE_SECONDS`]; otherwise `OutOfRange`,
/// before anything is read from or written to the history.
pub fn submit_outcome(
    env: &Env,
    publisher: &Address,
    anchor_id: String,
    corridor: String,
    outcome_hash: String,
    settle_seconds: u64,
    success: bool,
) -> Result<(), Error> {
    publishers::require_publisher(env, publisher)?;
    publishers::require_in_scope(env, publisher, &corridor)?;

    // The registry is what list_anchors reports; without this gate a publisher
    // key could create history and scores for ids that were never registered
    // (audit M-5).
    anchors::require_registered(env, &anchor_id)?;

    if settle_seconds > MAX_SETTLE_SECONDS {
        return Err(Error::OutOfRange);
    }
    if outcome_hash.is_empty() || outcome_hash.len() > MAX_OUTCOME_HASH_LEN {
        return Err(Error::OutOfRange);
    }

    let head_key = DataKey::OutcomeHead(anchor_id.clone());
    let (page_num, page_len): (u32, u32) =
        env.storage().persistent().get(&head_key).unwrap_or((0, 0));

    let (page_num, page_len) = if page_len >= PAGE_SIZE {
        (page_num + 1, 0)
    } else {
        (page_num, page_len)
    };

    let page_key = DataKey::OutcomePage(anchor_id.clone(), page_num);
    let mut page: Vec<(String, u64, bool)> = env
        .storage()
        .persistent()
        .get(&page_key)
        .unwrap_or_else(|| Vec::new(env));

    page.push_back((outcome_hash, settle_seconds, success));
    env.storage().persistent().set(&page_key, &page);
    env.storage()
        .persistent()
        .set(&head_key, &(page_num, page_len + 1));
    storage::extend_persistent(env, &page_key);
    storage::extend_persistent(env, &head_key);

    aggregate::record(env, &anchor_id, &corridor, settle_seconds, success)?;
    events::outcome(
        env,
        publisher,
        &anchor_id,
        &corridor,
        settle_seconds,
        success,
    );
    Ok(())
}
