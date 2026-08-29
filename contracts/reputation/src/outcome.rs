use soroban_sdk::{Address, Env, String, Vec};

use crate::storage::{self, DataKey, PAGE_SIZE};
use crate::{aggregate, publishers, Error};

/// Upper bound on a single outcome's settle time (~11.6 days). Rejects absurd
/// values that would otherwise inflate the settle-seconds accumulator toward
/// overflow; any real settlement is far below this.
pub const MAX_SETTLE_SECONDS: u64 = 1_000_000;

pub fn submit_outcome(
    env: &Env,
    publisher: &Address,
    anchor_id: String,
    corridor: String,
    outcome_hash: String,
    settle_seconds: u64,
    success: bool,
) -> Result<(), Error> {
    publisher.require_auth();

    if !publishers::is_authorized(env, publisher) {
        return Err(Error::PublisherUnauthorized);
    }

    if settle_seconds > MAX_SETTLE_SECONDS {
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
    Ok(())
}
