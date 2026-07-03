use soroban_sdk::{Env, String, Vec};

use crate::storage::DataKey;

/// Return the last `n` outcome entries for an anchor in descending time order.
/// `n` is capped at 100 to bound gas consumption.
///
/// Reads at most `ceil(n / PAGE_SIZE)` persistent page keys — bounded regardless
/// of total history depth.
pub fn recent_outcomes(env: &Env, anchor_id: String, n: u32) -> Vec<(String, u64, bool)> {
    if n > 100 {
        panic!("n exceeds maximum of 100");
    }
    if n == 0 {
        return Vec::new(env);
    }

    let head_key = DataKey::OutcomeHead(anchor_id.clone());
    let (current_page, current_len): (u32, u32) = env
        .storage()
        .persistent()
        .get(&head_key)
        .unwrap_or((0, 0));

    if current_len == 0 && current_page == 0 {
        return Vec::new(env);
    }

    let mut result: Vec<(String, u64, bool)> = Vec::new(env);
    let mut remaining = n;
    let mut page = current_page;

    loop {
        let page_key = DataKey::OutcomePage(anchor_id.clone(), page);
        let entries: Vec<(String, u64, bool)> = env
            .storage()
            .persistent()
            .get(&page_key)
            .unwrap_or_else(|| Vec::new(env));

        let len = entries.len();
        if len > 0 {
            let take = core::cmp::min(remaining, len);
            for i in (len - take..len).rev() {
                result.push_back(entries.get(i).unwrap());
            }
            remaining -= take;
        }

        if remaining == 0 || page == 0 {
            break;
        }
        page -= 1;
    }

    result
}
