use soroban_sdk::{Address, Env, String};

use crate::storage::{self, DataKey};
use crate::{publishers, Error};

const MAX_BPS: i128 = 10000;
const NORM_SETTLE_SECONDS: i128 = 300;
const MIN_SETTLE_SECONDS: u64 = 1;

fn clamp_bps(value: i128) -> i128 {
    // MAX_BPS is a positive constant, so the panic-if-max-lt-min case cannot arise.
    value.clamp(0, MAX_BPS)
}

fn normalize_settle_seconds(settle_seconds_p50: u64) -> i128 {
    let settle_seconds = if settle_seconds_p50 < MIN_SETTLE_SECONDS {
        MIN_SETTLE_SECONDS
    } else {
        settle_seconds_p50
    };
    settle_seconds as i128
}

pub fn compute_composite_bps(
    fill_rate_bps: i128,
    slippage_bps: i128,
    settle_seconds_p50: u64,
) -> i128 {
    let fill_rate_bps = clamp_bps(fill_rate_bps);
    let slippage_bps = clamp_bps(slippage_bps);
    let settle_seconds = normalize_settle_seconds(settle_seconds_p50);

    if fill_rate_bps == 0 {
        return 0;
    }

    let effective_fill_bps = fill_rate_bps * (MAX_BPS - slippage_bps);
    let numerator = effective_fill_bps * NORM_SETTLE_SECONDS;
    let denominator = MAX_BPS * settle_seconds;

    if denominator == 0 {
        return 0;
    }

    (numerator + denominator / 2) / denominator
}

/// Publisher-only. These metrics feed the published composite score, so an
/// open write here lets anyone forge any anchor's reputation. Gated the same
/// way as `submit_outcome` rather than admin-gated, because the publisher
/// pipeline is what writes them.
// The parameter list is the contract ABI. Grouping the metrics into a struct to
// satisfy the 7-argument lint would be a second breaking ABI change on top of
// the auth fix, for no callers' benefit.
#[allow(clippy::too_many_arguments)]
pub fn set_corridor_metrics(
    env: &Env,
    publisher: &Address,
    anchor_id: String,
    corridor: String,
    fill_rate_bps: i128,
    slippage_bps: i128,
    settle_seconds_p50: u64,
    n: u32,
) -> Result<(), Error> {
    publisher.require_auth();

    if !publishers::is_authorized(env, publisher) {
        return Err(Error::PublisherUnauthorized);
    }

    // Write BOTH the v1 and v2 keys. Previously only the v1 `Corridor` key was
    // written, so once a corridor had been migrated to v2, every subsequent
    // publisher update landed in v1 while v2 readers (get_score_for_corridor_v2)
    // kept serving the stale migrated snapshot. Writing both keeps the two views
    // in lock-step. The v2 tuple is (fill, slippage, composite, settle, n).
    let composite_bps = compute_composite_bps(fill_rate_bps, slippage_bps, settle_seconds_p50);

    let v1_key = DataKey::Corridor(anchor_id.clone(), corridor.clone());
    let metrics = (fill_rate_bps, slippage_bps, settle_seconds_p50, n);
    env.storage().persistent().set(&v1_key, &metrics);
    storage::extend_persistent(env, &v1_key);

    let v2_key = DataKey::CorridorV2(anchor_id, corridor);
    let metrics_v2 = (
        fill_rate_bps,
        slippage_bps,
        composite_bps,
        settle_seconds_p50,
        n,
    );
    env.storage().persistent().set(&v2_key, &metrics_v2);
    storage::extend_persistent(env, &v2_key);

    Ok(())
}

pub fn get_score_for_corridor(
    env: &Env,
    anchor_id: String,
    corridor: String,
) -> (i128, i128, u64, u32) {
    let default_metrics = (0i128, 0i128, 0u64, 0u32);
    let (fill_rate_bps, slippage_bps, settle_seconds_p50, n): (i128, i128, u64, u32) = env
        .storage()
        .persistent()
        .get(&DataKey::Corridor(anchor_id, corridor))
        .unwrap_or(default_metrics);

    let composite_bps = compute_composite_bps(fill_rate_bps, slippage_bps, settle_seconds_p50);
    (composite_bps, fill_rate_bps, settle_seconds_p50, n)
}
