use soroban_sdk::{Env, String};

use crate::storage::DataKey;

/// Record one outcome into the (anchor, corridor) aggregate.
///
/// Existing data from the old anchor-only storage schema is not migrated;
/// aggregates start at zero for each (anchor, corridor) pair.
pub fn record(
    env: &Env,
    anchor_id: &String,
    corridor: &String,
    settle_seconds: u64,
    success: bool,
) {
    let key = DataKey::CorridorAggregate(anchor_id.clone(), corridor.clone());
    let (total, successes, settle_sum): (u32, u32, u64) =
        env.storage().persistent().get(&key).unwrap_or((0, 0, 0));

    env.storage().persistent().set(
        &key,
        &(
            total + 1,
            if success { successes + 1 } else { successes },
            settle_sum + settle_seconds,
        ),
    );
}

/// Return the rolling aggregate for (anchor, corridor): `(total, successes, settle_seconds_sum)`.
/// Returns `(0, 0, 0)` when no outcomes have been submitted for that pair.
pub fn get(env: &Env, anchor_id: &String, corridor: &String) -> (u32, u32, u64) {
    let key = DataKey::CorridorAggregate(anchor_id.clone(), corridor.clone());
    env.storage().persistent().get(&key).unwrap_or((0, 0, 0))
}
