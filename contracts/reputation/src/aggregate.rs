use soroban_sdk::{Env, String};

use crate::storage::DataKey;

fn v2_key(anchor_id: &String, corridor: &String) -> DataKey {
    DataKey::CorridorAggregateV2(anchor_id.clone(), corridor.clone())
}

fn migration_key(anchor_id: &String, corridor: &String) -> DataKey {
    DataKey::Migrated(anchor_id.clone(), corridor.clone())
}

fn read_v2_or_legacy(env: &Env, anchor_id: &String, corridor: &String) -> (u32, u32, u64) {
    let key = v2_key(anchor_id, corridor);
    if env.storage().persistent().has(&key) {
        return env.storage().persistent().get(&key).unwrap_or((0, 0, 0));
    }

    let legacy_key = DataKey::CorridorAggregate(anchor_id.clone(), corridor.clone());
    env.storage().persistent().get(&legacy_key).unwrap_or((0, 0, 0))
}

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

    let next = (
        total + 1,
        if success { successes + 1 } else { successes },
        settle_sum + settle_seconds,
    );

    env.storage().persistent().set(&key, &next);

    let v2_key = v2_key(anchor_id, corridor);
    let v2_value: (u32, u32, u64) = env.storage().persistent().get(&v2_key).unwrap_or((0, 0, 0));
    env.storage().persistent().set(&v2_key, &(v2_value.0 + 1, v2_value.1 + if success { 1 } else { 0 }, v2_value.2 + settle_seconds));
}

/// Return the rolling aggregate for (anchor, corridor): `(total, successes, settle_seconds_sum)`.
/// Returns `(0, 0, 0)` when no outcomes have been submitted for that pair.
pub fn get(env: &Env, anchor_id: &String, corridor: &String) -> (u32, u32, u64) {
    read_v2_or_legacy(env, anchor_id, corridor)
}

/// Return the rolling aggregate from the v2 namespace for (anchor, corridor).
pub fn get_v2(env: &Env, anchor_id: &String, corridor: &String) -> (u32, u32, u64) {
    let key = v2_key(anchor_id, corridor);
    env.storage().persistent().get(&key).unwrap_or((0, 0, 0))
}

/// Persist an aggregate value into the v2 namespace.
pub fn set_v2(env: &Env, anchor_id: &String, corridor: &String, total: u32, successes: u32, settle_seconds_sum: u64) {
    env.storage().persistent().set(&v2_key(anchor_id, corridor), &(total, successes, settle_seconds_sum));
    env.storage().persistent().set(&migration_key(anchor_id, corridor), &true);
}
