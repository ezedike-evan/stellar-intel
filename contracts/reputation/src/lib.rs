#![no_std]

//! Stellar Intel — on-chain reputation seed (roadmap #138).
//!
//! A minimal, admin-managed registry of approved anchors. This is the seed for
//! the future on-chain reputation system: it establishes the admin authority
//! model and the anchor allow-list that later reputation logic will build on.
//!
//! Functions:
//!   - `init(admin)`                  — one-time initialization, stores the admin.
//!   - `register_anchor(admin, id)`   — admin-only; adds an anchor to the registry.
//!   - `list_anchors()`               — returns the registered anchor ids.

use soroban_sdk::{contract, contractimpl, contracterror, Env, String, Vec};

mod admin;
mod anchors;

pub use admin::DataKey;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// `init` was called more than once.
    AlreadyInitialized = 1,
    /// A function requiring initialization was called before `init`.
    NotInitialized = 2,
    /// The supplied admin does not match the stored admin / failed auth.
    Unauthorized = 3,
    /// The anchor id is already present in the registry.
    AnchorExists = 4,
}

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    /// Initialize the contract with an administrator address.
    /// Fails with `AlreadyInitialized` if called a second time.
    pub fn init(env: Env, admin: soroban_sdk::Address) -> Result<(), Error> {
        admin::set_admin(&env, &admin)
    }

    /// Register a new anchor. Only the stored admin may call this, and the call
    /// must be authorized by the admin (`require_auth`). Fails with
    /// `AnchorExists` if the id is already registered.
    pub fn register_anchor(
        env: Env,
        admin: soroban_sdk::Address,
        anchor_id: String,
    ) -> Result<(), Error> {
        admin::require_admin(&env, &admin)?;
        anchors::register(&env, anchor_id)
    }

    /// Return all registered anchor ids in insertion order.
    pub fn list_anchors(env: Env) -> Vec<String> {
        anchors::list(&env)
    }

    /// Return the current admin, or `None` if not yet initialized.
    pub fn admin(env: Env) -> Option<soroban_sdk::Address> {
        admin::get_admin(&env)
    }
}
