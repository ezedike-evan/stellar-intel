use soroban_sdk::{Address, Env, String};

use crate::storage::DataKey;
use crate::{admin, score, Error};

/// Migrate a single (anchor_id, corridor) pair from the v1 Corridor data key
/// to the v2 CorridorV2 data key, preserving all computed metrics.
///
/// v1 stored: `(fill_rate_bps, slippage_bps, settle_seconds_p50, n)`
/// v2 stores: `(fill_rate_bps, slippage_bps, composite_bps, settle_seconds_p50, n)`
///
/// The migration reads the existing v1 metrics, recomputes `composite_bps`
/// from them, and writes the expanded tuple under the new key. V1 readers
/// continue to read the old key; v2 readers read the new key. If no v1 data
/// exists for the pair, the migration is a no-op.
pub fn migrate_corridor(
    env: &Env,
    caller: &Address,
    anchor_id: String,
    corridor: String,
) -> Result<(), Error> {
    admin::require_admin(env, caller)?;
    migrate_corridor_unchecked(env, anchor_id, corridor);
    Ok(())
}

/// The migration itself, with no authorization check.
///
/// Split out so `migrate_all` can loop over pairs after checking admin once,
/// rather than re-running `require_admin` (and its `require_auth`) per pair.
/// Private on purpose: every path that reaches it has already been gated.
fn migrate_corridor_unchecked(env: &Env, anchor_id: String, corridor: String) {
    let v2_key = DataKey::CorridorV2(anchor_id.clone(), corridor.clone());

    if env.storage().persistent().has(&v2_key) {
        return;
    }

    let old_key = DataKey::Corridor(anchor_id, corridor);
    let default_metrics = (0i128, 0i128, 0u64, 0u32);
    let (fill_rate_bps, slippage_bps, settle_seconds_p50, n): (i128, i128, u64, u32) = env
        .storage()
        .persistent()
        .get(&old_key)
        .unwrap_or(default_metrics);

    let composite_bps =
        score::compute_composite_bps(fill_rate_bps, slippage_bps, settle_seconds_p50);

    let v2_metrics = (
        fill_rate_bps,
        slippage_bps,
        composite_bps,
        settle_seconds_p50,
        n,
    );
    env.storage().persistent().set(&v2_key, &v2_metrics);
}

/// Default corridor list for v2 migration. Expand this list as new corridors
/// are added (issue #825).
const V2_CORRIDORS: &[&str] = &[
    "usdc-ngn", "usdc-kes", "usdc-mxn", "usdc-php", "usdc-brl", "usdc-ars",
];

/// Migrate all known (anchor, corridor) pairs that have v1 metrics stored.
/// Walks the registered anchors and the default corridor list.
pub fn migrate_all(env: &Env, caller: &Address) -> Result<(), Error> {
    admin::require_admin(env, caller)?;

    let anchors = crate::anchors::list(env);
    for i in 0..anchors.len() {
        let anchor_id = anchors.get(i).unwrap();
        for corridor_str in V2_CORRIDORS {
            let corridor = String::from_str(env, corridor_str);
            migrate_corridor_unchecked(env, anchor_id.clone(), corridor);
        }
    }
    Ok(())
}
