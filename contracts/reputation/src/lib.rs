#![no_std]
use soroban_sdk::{contract, contractimpl, Address, Env, String, Vec};

pub mod outcome;
pub mod history;
pub mod score;

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    pub fn submit_outcome(
        env: Env,
        admin: Address,
        anchor_id: String,
        outcome_hash: String,
        settle_seconds: u64,
        success: bool,
    ) {
        outcome::submit_outcome(&env, admin, anchor_id, outcome_hash, settle_seconds, success);
    }

    /// Return the last `n` outcome aggregates for an anchor in descending time order.
    /// `n` is capped at 100 to bound gas consumption.
    pub fn recent_outcomes(env: Env, anchor_id: String, n: u32) -> Vec<(String, u64, bool)> {
        history::recent_outcomes(&env, anchor_id, n)
    }

    pub fn get_score_for_corridor(
        env: Env,
        anchor_id: String,
        corridor: String,
    ) -> (i128, i128, u64, u32) {
        score::get_score_for_corridor(&env, anchor_id, corridor)
    }

    pub fn set_corridor_metrics(
        env: Env,
        anchor_id: String,
        corridor: String,
        fill_rate_bps: i128,
        slippage_bps: i128,
        settle_seconds_p50: u64,
        n: u32,
    ) {
        score::set_corridor_metrics(&env, anchor_id, corridor, fill_rate_bps, slippage_bps, settle_seconds_p50, n);
    }
}