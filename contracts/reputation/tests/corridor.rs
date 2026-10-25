//! Integration tests for per-corridor score aggregates (roadmap #182).

use reputation::storage::DataKey;
use reputation::{ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address, Address) {
    let admin = Address::generate(env);
    let contract_id = env.register(ReputationContract, (admin.clone(), admin.clone()));
    let client = ReputationContractClient::new(env, &contract_id);
    let publisher = Address::generate(env);
    client.add_publisher(&admin, &publisher);
    (client, admin, publisher)
}

#[test]
fn unknown_corridor_returns_zero_aggregate() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _publisher) = setup(&env);

    let anchor = String::from_str(&env, "cowrie");
    let corridor = String::from_str(&env, "usdc-ngn");

    let (total, successes, settle_sum) = client.get_corridor_aggregate(&anchor, &corridor);
    assert_eq!(total, 0);
    assert_eq!(successes, 0);
    assert_eq!(settle_sum, 0);
}

#[test]
fn aggregate_accumulates_per_corridor() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, publisher) = setup(&env);

    let anchor = String::from_str(&env, "cowrie");
    client.register_anchor(&admin, &anchor);
    let corridor = String::from_str(&env, "usdc-ngn");
    let h1 = String::from_str(&env, "hash-1");
    let h2 = String::from_str(&env, "hash-2");
    let h3 = String::from_str(&env, "hash-3");

    client.submit_outcome(&publisher, &anchor, &corridor, &h1, &30, &true);
    client.submit_outcome(&publisher, &anchor, &corridor, &h2, &60, &false);
    client.submit_outcome(&publisher, &anchor, &corridor, &h3, &90, &true);

    let (total, successes, settle_sum) = client.get_corridor_aggregate(&anchor, &corridor);
    assert_eq!(total, 3);
    assert_eq!(successes, 2);
    assert_eq!(settle_sum, 180);
}

#[test]
fn corridors_are_isolated_within_same_anchor() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, publisher) = setup(&env);

    let anchor = String::from_str(&env, "bitso");
    client.register_anchor(&admin, &anchor);
    let ngn = String::from_str(&env, "usdc-ngn");
    let kes = String::from_str(&env, "usdc-kes");

    client.submit_outcome(
        &publisher,
        &anchor,
        &ngn,
        &String::from_str(&env, "h-ngn"),
        &20,
        &true,
    );
    client.submit_outcome(
        &publisher,
        &anchor,
        &kes,
        &String::from_str(&env, "h-kes-1"),
        &40,
        &false,
    );
    client.submit_outcome(
        &publisher,
        &anchor,
        &kes,
        &String::from_str(&env, "h-kes-2"),
        &80,
        &true,
    );

    let (ngn_total, ngn_success, ngn_sum) = client.get_corridor_aggregate(&anchor, &ngn);
    assert_eq!(ngn_total, 1);
    assert_eq!(ngn_success, 1);
    assert_eq!(ngn_sum, 20);

    let (kes_total, kes_success, kes_sum) = client.get_corridor_aggregate(&anchor, &kes);
    assert_eq!(kes_total, 2);
    assert_eq!(kes_success, 1);
    assert_eq!(kes_sum, 120);
}

#[test]
fn same_corridor_across_different_anchors_is_isolated() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, publisher) = setup(&env);

    let anchor_a = String::from_str(&env, "cowrie");
    client.register_anchor(&admin, &anchor_a);
    let anchor_b = String::from_str(&env, "bitso");
    client.register_anchor(&admin, &anchor_b);
    let corridor = String::from_str(&env, "usdc-ngn");

    client.submit_outcome(
        &publisher,
        &anchor_a,
        &corridor,
        &String::from_str(&env, "h-a"),
        &10,
        &true,
    );
    client.submit_outcome(
        &publisher,
        &anchor_b,
        &corridor,
        &String::from_str(&env, "h-b1"),
        &20,
        &false,
    );
    client.submit_outcome(
        &publisher,
        &anchor_b,
        &corridor,
        &String::from_str(&env, "h-b2"),
        &30,
        &true,
    );

    let (a_total, a_success, a_sum) = client.get_corridor_aggregate(&anchor_a, &corridor);
    assert_eq!(a_total, 1);
    assert_eq!(a_success, 1);
    assert_eq!(a_sum, 10);

    let (b_total, b_success, b_sum) = client.get_corridor_aggregate(&anchor_b, &corridor);
    assert_eq!(b_total, 2);
    assert_eq!(b_success, 1);
    assert_eq!(b_sum, 50);
}

// ── migrate_all_v2 covers the app's corridors (#1397) ────────────────────────

#[test]
fn migrate_all_covers_usdc_ghs() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, publisher) = setup(&env);
    let anchor = String::from_str(&env, "cowrie");
    let ghs = String::from_str(&env, "usdc-ghs");
    client.register_anchor(&admin, &anchor);
    client.set_corridor_metrics(
        &publisher, &anchor, &ghs, &9000i128, &50i128, &120u64, &25u32,
    );

    // set_corridor_metrics writes both keys; drop the v2 one so the migration
    // has work to do (usdc-ghs was missing from the old hardcoded list).
    let v2_key = DataKey::CorridorV2(anchor.clone(), ghs.clone());
    env.as_contract(&client.address, || {
        env.storage().persistent().remove(&v2_key);
    });
    let has_v2 = || env.as_contract(&client.address, || env.storage().persistent().has(&v2_key));
    assert!(!has_v2());

    client.migrate_all_v2(&admin);

    // The v2 getter falls back to v1 when the key is absent, so read the key
    // itself to prove the migration wrote it.
    assert!(has_v2());
    let (composite, fill, slippage, settle, n) = client.get_score_for_corridor_v2(&anchor, &ghs);
    assert_eq!((fill, slippage, settle, n), (9000, 50, 120, 25));
    assert!(composite > 0);
}
