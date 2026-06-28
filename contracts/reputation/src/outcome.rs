use soroban_sdk::{Address, Env, String, Vec};

use crate::{Error, publishers};

pub fn submit_outcome(
    env: &Env,
    publisher: &Address,
    anchor_id: String,
    outcome_hash: String,
    settle_seconds: u64,
    success: bool,
) -> Result<(), Error> {
    publisher.require_auth();

    if !publishers::is_authorized(env, publisher) {
        return Err(Error::PublisherUnauthorized);
    }

    let mut outcomes: Vec<(String, u64, bool)> = env
        .storage()
        .persistent()
        .get(&anchor_id)
        .unwrap_or_else(|| Vec::new(env));

    outcomes.push_back((outcome_hash, settle_seconds, success));
    env.storage().persistent().set(&anchor_id, &outcomes);
    Ok(())
}
