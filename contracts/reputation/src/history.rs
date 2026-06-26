use soroban_sdk::{Env, String, Vec};

/// Return the last `n` outcome aggregates for an anchor in descending time order.
/// `n` is capped at 100 to bound gas consumption.
pub fn recent_outcomes(env: &Env, anchor_id: String, n: u32) -> Vec<(String, u64, bool)> {
    if n > 100 {
        panic!("n exceeds maximum of 100");
    }
    let outcomes: Vec<(String, u64, bool)> = env
        .storage()
        .persistent()
        .get(&anchor_id)
        .unwrap_or_else(|| Vec::new(env));
    let len = outcomes.len();
    if len == 0 || n == 0 {
        return Vec::new(env);
    }
    let take = core::cmp::min(n, len);
    let start = len - take;
    let mut recent = Vec::new(env);
    // Iterate backwards to get most recent first.
    for i in (start..len).rev() {
        recent.push_back(outcomes.get(i).unwrap());
    }
    recent
}
