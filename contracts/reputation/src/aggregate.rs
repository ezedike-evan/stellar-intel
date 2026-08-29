use soroban_sdk::{Env, String};

use crate::storage::{self, DataKey};
use crate::Error;

/// Record one outcome into the (anchor, corridor) aggregate.
///
/// Existing data from the old anchor-only storage schema is not migrated;
/// aggregates start at zero for each (anchor, corridor) pair.
///
/// Uses `checked_add` so a rogue publisher submitting extreme values gets a
/// clean `ArithmeticOverflow` error instead of trapping the corridor forever
/// under `overflow-checks = true`.
pub fn record(
    env: &Env,
    anchor_id: &String,
    corridor: &String,
    settle_seconds: u64,
    success: bool,
) -> Result<(), Error> {
    let key = DataKey::CorridorAggregate(anchor_id.clone(), corridor.clone());
    let (total, successes, settle_sum): (u32, u32, u64) =
        env.storage().persistent().get(&key).unwrap_or((0, 0, 0));

    let next_total = total.checked_add(1).ok_or(Error::ArithmeticOverflow)?;
    let next_successes = if success {
        successes.checked_add(1).ok_or(Error::ArithmeticOverflow)?
    } else {
        successes
    };
    let next_settle_sum = settle_sum
        .checked_add(settle_seconds)
        .ok_or(Error::ArithmeticOverflow)?;

    env.storage()
        .persistent()
        .set(&key, &(next_total, next_successes, next_settle_sum));
    storage::extend_persistent(env, &key);
    Ok(())
}

/// Return the rolling aggregate for (anchor, corridor): `(total, successes, settle_seconds_sum)`.
/// Returns `(0, 0, 0)` when no outcomes have been submitted for that pair.
pub fn get(env: &Env, anchor_id: &String, corridor: &String) -> (u32, u32, u64) {
    let key = DataKey::CorridorAggregate(anchor_id.clone(), corridor.clone());
    env.storage().persistent().get(&key).unwrap_or((0, 0, 0))
}

/// Clear the aggregate for a pair, resetting it to `(0, 0, 0)`. Admin-gated at
/// the entrypoint — the escape hatch for a corridor whose accumulator was
/// polluted by a since-revoked publisher.
pub fn reset(env: &Env, anchor_id: &String, corridor: &String) {
    let key = DataKey::CorridorAggregate(anchor_id.clone(), corridor.clone());
    env.storage().persistent().remove(&key);
}
