#![no_std]
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, String, Vec};

pub mod outcome;
pub mod history;
pub mod upgrade;

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

    /// Bind the upgrade administrator and stamp the initial contract version.
    /// One-shot; reverts if the upgrade admin is already set.
    pub fn init_upgrade(env: Env, admin: Address) {
        upgrade::init(&env, admin);
    }

    /// Admin-signed contract upgrade. Replaces the contract WASM with the code
    /// at `new_wasm_hash` while preserving all stored state, following Soroban's
    /// standard upgrade pattern.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        upgrade::apply(&env, new_wasm_hash);
    }

    /// Return the live contract version (`0` before `init_upgrade`).
    pub fn contract_version(env: Env) -> u32 {
        upgrade::current_version(&env)
    }
}