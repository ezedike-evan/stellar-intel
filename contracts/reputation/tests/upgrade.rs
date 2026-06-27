//! Integration tests for the admin-gated contract upgrade hook (issue #352).
//!
//! These cover the deterministic, host-independent behavior of the hook: the
//! one-shot admin binding, the persisted version, the admin authorization gate,
//! and the fact that the upgrade bookkeeping lives under storage keys disjoint
//! from contract state. The live WASM swap itself is delegated to the Soroban
//! host's `update_current_contract_wasm`, which by construction leaves storage
//! intact — the disjoint-keys test below demonstrates why state is preserved.

use reputation::{ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address) {
    let contract_id = env.register(ReputationContract, ());
    let client = ReputationContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    (client, admin)
}

#[test]
fn version_starts_at_one_after_init() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    // An uninitialized contract reports version 0.
    assert_eq!(client.contract_version(), 0);

    client.init_upgrade(&admin);
    assert_eq!(client.contract_version(), 1);
}

#[test]
fn init_upgrade_is_one_shot() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    client.init_upgrade(&admin);

    // A second initialization must be rejected so the authority cannot be
    // silently rotated.
    let res = client.try_init_upgrade(&admin);
    assert!(res.is_err());
}

#[test]
fn upgrade_requires_admin_authorization() {
    let env = Env::default();
    let (client, admin) = setup(&env);

    // Initialize under mocked auth, then clear all authorizations.
    env.mock_all_auths();
    client.init_upgrade(&admin);
    env.set_auths(&[]);

    // Without the admin's signature the call reverts at `require_auth`, before
    // any WASM swap is attempted.
    let wasm_hash = BytesN::from_array(&env, &[0u8; 32]);
    let res = client.try_upgrade(&wasm_hash);
    assert!(res.is_err());
}

#[test]
fn contract_state_is_disjoint_from_upgrade_metadata() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    client.init_upgrade(&admin);

    // Record some outcome state alongside the upgrade metadata.
    let anchor = String::from_str(&env, "moneygram");
    let h1 = String::from_str(&env, "hash-1");
    let h2 = String::from_str(&env, "hash-2");
    client.submit_outcome(&admin, &anchor, &h1, &10u64, &true);
    client.submit_outcome(&admin, &anchor, &h2, &20u64, &false);

    // The version stamp lives under its own key and does not perturb the
    // outcome history: an upgrade touches only code plus this version key, so
    // contract state survives the swap.
    assert_eq!(client.contract_version(), 1);

    let recent = client.recent_outcomes(&anchor, &5u32);
    assert_eq!(recent.len(), 2);
    assert_eq!(recent.get(0).unwrap().0, h2);
    assert_eq!(recent.get(1).unwrap().0, h1);
}
