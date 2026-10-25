//! Contract events.
//!
//! Indexers, the web app and auditors can follow what publishers wrote without
//! diffing storage (audit P3, event emission). Each helper is called at the end
//! of its write path, only after every storage write has succeeded, so a
//! rejected or rolled-back call emits nothing.
//!
//! ## Publisher writes
//!
//! | Topics                                   | Data                                    |
//! |------------------------------------------|-----------------------------------------|
//! | `("outcome", anchor_id, corridor)`       | `(publisher, settle_seconds, success)`  |
//! | `("metrics", anchor_id, corridor)`       | `(publisher, composite_bps, n)`         |
//! | `("rate", corridor)`                     | `(publisher, rate, decimals)`           |
//! | `("volume", corridor)`                   | `(publisher, volume_delta, savings_delta)` |
//!
//! ## Registry, custody and upgrade changes
//!
//! The actions an auditor most needs to watch. Each carries the id it acted on
//! in the topics and the acting address in the data, and is emitted only after
//! the state change succeeded.
//!
//! | Topics                                 | Data                              |
//! |----------------------------------------|-----------------------------------|
//! | `("anchor_reg", anchor_id)`            | `caller`                          |
//! | `("pub_add", publisher)`               | `caller`                          |
//! | `("pub_rev", publisher)`               | `caller`                          |
//! | `("adm_prop", candidate)`              | `caller` (current admin)          |
//! | `("adm_acc", candidate)`               | `candidate` (the new admin)       |
//! | `("adm_cncl", candidate)`              | `caller` (the withdrawn candidate is in the topics) |
//! | `("upg_prop", candidate)`              | `caller` (current upgrade admin)  |
//! | `("upg_acc", candidate)`               | `candidate` (the new upgrade admin) |
//! | `("upg_cncl", candidate)`              | `caller`                          |
//! | `("agg_rst", anchor_id, corridor)`     | `caller`                          |
//! | `("vol_rst", corridor)`                | `caller`                          |
//! | `("upgrade", upgrade_admin)`           | `(new_wasm_hash, new_version)`    |
//!
//! `adm_cncl` and `upg_cncl` are emitted only when a proposal was actually
//! pending; cancelling nothing changes nothing and says nothing.
//!
//! `anchor_id` and `corridor` are `String`s, `publisher` is an `Address`,
//! `settle_seconds` is `u64`, `success` is `bool`, `composite_bps`, `rate` and
//! the deltas are `i128`, and `n` and `decimals` are `u32`.

use soroban_sdk::{symbol_short, Address, BytesN, Env, String, Symbol};

/// An outcome was recorded for `anchor_id` on `corridor`.
pub fn outcome(
    env: &Env,
    publisher: &Address,
    anchor_id: &String,
    corridor: &String,
    settle_seconds: u64,
    success: bool,
) {
    env.events().publish(
        (
            symbol_short!("outcome"),
            anchor_id.clone(),
            corridor.clone(),
        ),
        (publisher.clone(), settle_seconds, success),
    );
}

/// Corridor metrics were published for `anchor_id` on `corridor`.
pub fn metrics(
    env: &Env,
    publisher: &Address,
    anchor_id: &String,
    corridor: &String,
    composite_bps: i128,
    n: u32,
) {
    env.events().publish(
        (
            symbol_short!("metrics"),
            anchor_id.clone(),
            corridor.clone(),
        ),
        (publisher.clone(), composite_bps, n),
    );
}

/// A corridor rate was published.
pub fn rate(env: &Env, publisher: &Address, corridor: &String, rate: i128, decimals: u32) {
    env.events().publish(
        (symbol_short!("rate"), corridor.clone()),
        (publisher.clone(), rate, decimals),
    );
}

/// Volume and savings were added to a corridor's totals.
pub fn volume(
    env: &Env,
    publisher: &Address,
    corridor: &String,
    volume_delta: i128,
    savings_delta: i128,
) {
    env.events().publish(
        (symbol_short!("volume"), corridor.clone()),
        (publisher.clone(), volume_delta, savings_delta),
    );
}

// ── Registry, custody and upgrade changes ────────────────────────────────────

/// An anchor was added to the registry.
///
/// `anchor_reg` is ten characters, one over what `symbol_short!` allows, so this
/// topic is built with `Symbol::new`.
pub fn anchor_registered(env: &Env, caller: &Address, anchor_id: &String) {
    env.events().publish(
        (Symbol::new(env, "anchor_reg"), anchor_id.clone()),
        caller.clone(),
    );
}

/// A publisher was whitelisted.
pub fn publisher_added(env: &Env, caller: &Address, publisher: &Address) {
    env.events().publish(
        (symbol_short!("pub_add"), publisher.clone()),
        caller.clone(),
    );
}

/// A publisher was revoked.
pub fn publisher_revoked(env: &Env, caller: &Address, publisher: &Address) {
    env.events().publish(
        (symbol_short!("pub_rev"), publisher.clone()),
        caller.clone(),
    );
}

/// The admin nominated `candidate` as the next admin.
pub fn admin_proposed(env: &Env, caller: &Address, candidate: &Address) {
    env.events().publish(
        (symbol_short!("adm_prop"), candidate.clone()),
        caller.clone(),
    );
}

/// `candidate` accepted and is now the admin.
pub fn admin_accepted(env: &Env, candidate: &Address) {
    env.events().publish(
        (symbol_short!("adm_acc"), candidate.clone()),
        candidate.clone(),
    );
}

/// The admin withdrew a pending nomination of `candidate`.
pub fn admin_proposal_cancelled(env: &Env, caller: &Address, candidate: &Address) {
    env.events().publish(
        (symbol_short!("adm_cncl"), candidate.clone()),
        caller.clone(),
    );
}

/// The upgrade admin nominated `candidate` as the next upgrade admin.
pub fn upgrade_admin_proposed(env: &Env, caller: &Address, candidate: &Address) {
    env.events().publish(
        (symbol_short!("upg_prop"), candidate.clone()),
        caller.clone(),
    );
}

/// `candidate` accepted and is now the upgrade admin.
pub fn upgrade_admin_accepted(env: &Env, candidate: &Address) {
    env.events().publish(
        (symbol_short!("upg_acc"), candidate.clone()),
        candidate.clone(),
    );
}

/// The upgrade admin withdrew a pending nomination of `candidate`.
pub fn upgrade_proposal_cancelled(env: &Env, caller: &Address, candidate: &Address) {
    env.events().publish(
        (symbol_short!("upg_cncl"), candidate.clone()),
        caller.clone(),
    );
}

/// A corridor's outcome aggregate was reset.
pub fn aggregate_reset(env: &Env, caller: &Address, anchor_id: &String, corridor: &String) {
    env.events().publish(
        (
            symbol_short!("agg_rst"),
            anchor_id.clone(),
            corridor.clone(),
        ),
        caller.clone(),
    );
}

/// A corridor's volume and savings totals were reset.
pub fn volume_reset(env: &Env, caller: &Address, corridor: &String) {
    env.events()
        .publish((symbol_short!("vol_rst"), corridor.clone()), caller.clone());
}

/// The contract is about to be upgraded to `new_wasm_hash`, at `new_version`.
/// Emitted before the swap: after it, this invocation runs on the new code.
pub fn upgraded(env: &Env, upgrade_admin: &Address, new_wasm_hash: &BytesN<32>, new_version: u32) {
    env.events().publish(
        (symbol_short!("upgrade"), upgrade_admin.clone()),
        (new_wasm_hash.clone(), new_version),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ReputationContract;
    use soroban_sdk::{
        testutils::{Address as _, Events},
        vec, IntoVal,
    };

    /// The `upgrade` event cannot be observed through `try_upgrade`: the host
    /// rejects the unknown WASM hash and rolls the whole invocation back, events
    /// included. So the helper is exercised directly, inside the contract.
    #[test]
    fn upgraded_emits_hash_and_version() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let contract_id = env.register(ReputationContract, (admin.clone(), admin.clone()));
        let hash = BytesN::from_array(&env, &[7u8; 32]);

        env.as_contract(&contract_id, || upgraded(&env, &admin, &hash, 2));

        assert_eq!(
            env.events().all(),
            vec![
                &env,
                (
                    contract_id.clone(),
                    (symbol_short!("upgrade"), admin.clone()).into_val(&env),
                    (hash.clone(), 2u32).into_val(&env),
                )
            ]
        );
    }
}
