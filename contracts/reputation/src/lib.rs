#![no_std]
use soroban_sdk::{contract, contractimpl, Address, Env, String, Vec};

pub mod admin;
pub mod anchors;
pub mod error;
pub mod history;
pub mod outcome;
pub mod publishers;

pub use crate::error::Error;

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    pub fn init(env: Env, admin: Address) -> Result<(), Error> {
        admin::set_admin(&env, &admin)
    }



    pub fn register_anchor(env: Env, caller: Address, anchor_id: String) -> Result<(), Error> {
        admin::require_admin(&env, &caller)?;
        anchors::register(&env, anchor_id)
    }



    pub fn list_anchors(env: Env) -> Vec<String> {
        anchors::list(&env)
    }

    pub fn admin(env: Env) -> Option<Address> {
        admin::get_admin(&env)
    }

    pub fn add_publisher(env: Env, caller: Address, publisher: Address) -> Result<(), Error> {
        admin::require_admin(&env, &caller)?;
        publishers::add(&env, publisher);
        Ok(())
    }

    pub fn revoke_publisher(env: Env, caller: Address, publisher: Address) -> Result<(), Error> {
        admin::require_admin(&env, &caller)?;
        publishers::revoke(&env, publisher);
        Ok(())
    }

    pub fn list_publishers(env: Env) -> Vec<Address> {
        publishers::list(&env)
    }

    pub fn submit_outcome(
        env: Env,
        publisher: Address,
        anchor_id: String,
        outcome_hash: String,
        settle_seconds: u64,
        success: bool,
    ) {
        outcome::submit_outcome(&env, publisher, anchor_id, outcome_hash, settle_seconds, success);
    }

    /// Return the last `n` outcome aggregates for an anchor in descending time order.
    /// `n` is capped at 100 to bound gas consumption.
    pub fn recent_outcomes(env: Env, anchor_id: String, n: u32) -> Vec<(String, u64, bool)> {
        history::recent_outcomes(&env, anchor_id, n)
    }
}