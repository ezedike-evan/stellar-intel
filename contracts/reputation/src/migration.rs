use soroban_sdk::{Env, String};

use crate::{aggregate, score};

/// Backfill a single (anchor, corridor) record into the v2 storage namespace.
///
/// Existing v1 data remains intact and is still readable through the legacy
/// keys, while the v2 namespace becomes the canonical storage path for newer
/// readers.
pub fn migrate_corridor_state(env: &Env, anchor_id: String, corridor: String) {
    let (total, successes, settle_seconds_sum) = aggregate::get(env, &anchor_id, &corridor);
    aggregate::set_v2(env, &anchor_id, &corridor, total, successes, settle_seconds_sum);

    let (composite_bps, fill_rate_bps, settle_seconds_p50, n) =
        score::get_score_for_corridor(env, anchor_id.clone(), corridor.clone());
    score::set_v2_metrics(
        env,
        anchor_id,
        corridor,
        fill_rate_bps,
        0,
        settle_seconds_p50,
        n,
    );

    // Preserve the same score semantics for v2 readers; the composite score is
    // derived from the stored metrics at read time.
    let _ = composite_bps;
}
