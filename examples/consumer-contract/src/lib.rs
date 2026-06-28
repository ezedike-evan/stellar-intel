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
}
