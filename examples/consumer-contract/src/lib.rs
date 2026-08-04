#![no_std]

use soroban_sdk::{contract, contractimpl, Address, Env, String};

use stellar_intel_reputation::ReputationReader;

#[contract]
pub struct ConsumerContract;

#[contractimpl]
impl ConsumerContract {
    pub fn read_reputation_score(env: Env, oracle: Address, anchor_id: String) -> u32 {
        ReputationReader::new(&env, oracle).score_bps(anchor_id, 10)
    }

    /// Composite on-chain score for a specific (anchor, corridor) pair, as
    /// published via the oracle's publisher-gated `set_corridor_metrics` entrypoint.
    pub fn read_corridor_score_bps(
        env: Env,
        oracle: Address,
        anchor_id: String,
        corridor: String,
    ) -> i128 {
        ReputationReader::new(&env, oracle)
            .corridor_score(anchor_id, corridor)
            .composite_bps
    }
}
