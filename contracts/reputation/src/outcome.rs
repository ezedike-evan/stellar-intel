use soroban_sdk::{Address, Env, String, Vec};

use crate::{admin, publishers};

pub fn submit_outcome(
    env: &Env,
    publisher: Address,
    anchor_id: String,
    outcome_hash: String,
    settle_seconds: u64,
    success: bool,
) {
    publisher.require_auth();

    // Must be either the admin or a whitelisted publisher
    let is_admin = if let Some(admin_addr) = admin::get_admin(env) {
        admin_addr == publisher
    } else {
        false
    };

    if !is_admin && !publishers::is_authorized(env, &publisher) {
        panic!("Unauthorized: caller is not a whitelisted publisher");
    }

    let mut outcomes: Vec<(String, u64, bool)> = env
        .storage()
        .persistent()
        .get(&anchor_id)
        .unwrap_or_else(|| Vec::new(env));

    outcomes.push_back((outcome_hash, settle_seconds, success));
    env.storage().persistent().set(&anchor_id, &outcomes);
}