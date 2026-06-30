use soroban_sdk::{contracttype, Env, String};

#[contracttype]
enum AggKey {
    Corridor(String, String),
}

/// Record one outcome into the (anchor, corridor) rolling aggregate.
///
/// Existing data from the prior anchor-only storage schema is not migrated;
/// aggregates start at zero for each (anchor, corridor) pair.
pub fn record(
    env: &Env,
    anchor_id: &String,
    corridor: &String,
    settle_seconds: u64,
    success: bool,
) {
    let key = AggKey::Corridor(anchor_id.clone(), corridor.clone());
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

/// Return `(total, successes, settle_seconds_sum)` for an (anchor, corridor) pair.
/// Returns `(0, 0, 0)` when no outcomes have been submitted for that pair.
pub fn get(env: &Env, anchor_id: &String, corridor: &String) -> (u32, u32, u64) {
    let key = AggKey::Corridor(anchor_id.clone(), corridor.clone());
    env.storage().persistent().get(&key).unwrap_or((0, 0, 0))
}
