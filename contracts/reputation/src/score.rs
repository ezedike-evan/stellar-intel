use soroban_sdk::{Env, String};

use crate::storage::DataKey;

const MAX_BPS: i128 = 10000;
const NORM_SETTLE_SECONDS: i128 = 300;
const MIN_SETTLE_SECONDS: u64 = 1;

fn clamp_bps(value: i128) -> i128 {
    if value < 0 {
        0
    } else if value > MAX_BPS {
        MAX_BPS
    } else {
        value
    }
}

fn normalize_settle_seconds(settle_seconds_p50: u64) -> i128 {
    let settle_seconds = if settle_seconds_p50 < MIN_SETTLE_SECONDS {
        MIN_SETTLE_SECONDS
    } else {
        settle_seconds_p50
    };
    settle_seconds as i128
}

fn compute_composite_bps(fill_rate_bps: i128, slippage_bps: i128, settle_seconds_p50: u64) -> i128 {
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

pub fn set_corridor_metrics(
    env: &Env,
    anchor_id: String,
    corridor: String,
    fill_rate_bps: i128,
    slippage_bps: i128,
    settle_seconds_p50: u64,
    n: u32,
) {
    let metrics = (fill_rate_bps, slippage_bps, settle_seconds_p50, n);
    env.storage()
        .persistent()
        .set(&DataKey::Corridor(anchor_id, corridor), &metrics);
}

pub fn get_score_for_corridor(env: &Env, anchor_id: String, corridor: String) -> (i128, i128, u64, u32) {
    let default_metrics = (0i128, 0i128, 0u64, 0u32);
    let (fill_rate_bps, slippage_bps, settle_seconds_p50, n): (i128, i128, u64, u32) = env
        .storage()
        .persistent()
        .get(&DataKey::Corridor(anchor_id, corridor))
        .unwrap_or(default_metrics);

    let composite_bps = compute_composite_bps(fill_rate_bps, slippage_bps, settle_seconds_p50);
    (composite_bps, fill_rate_bps, settle_seconds_p50, n)
}
