//! Phase 2 hardening: checked-math bounds, admin reset, v2 dual-key freshness,
//! volume/savings coverage, and the public bump().

use reputation::{Error, ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address, Address) {
    let admin = Address::generate(env);
    let contract_id = env.register(ReputationContract, (admin.clone(), admin.clone()));
    let client = ReputationContractClient::new(env, &contract_id);
    let publisher = Address::generate(env);
    client.add_publisher(&admin, &publisher);
    (client, admin, publisher)
}

// ── Bounds ─────────────────────────────────────────────────────────────────────

#[test]
fn submit_outcome_rejects_settle_seconds_over_the_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);

    let anchor = String::from_str(&env, "cowrie");
    let corridor = String::from_str(&env, "usdc-ngn");
    let hash = String::from_str(&env, "h");

    // 1_000_000 is the cap; one past it is rejected rather than trapped.
    let res =
        client.try_submit_outcome(&publisher, &anchor, &corridor, &hash, &1_000_001u64, &true);
    assert_eq!(res, Err(Ok(Error::OutOfRange)));
}

#[test]
fn add_volume_savings_rejects_delta_over_the_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);

    let corridor = String::from_str(&env, "usdc-ngn");
    let over = 1_000_000_000_000_000_001i128; // MAX_DELTA + 1
    let res = client.try_add_volume_savings(&publisher, &corridor, &over, &0i128);
    assert_eq!(res, Err(Ok(Error::OutOfRange)));
}

// ── Admin reset ────────────────────────────────────────────────────────────────

#[test]
fn admin_can_reset_a_polluted_corridor_aggregate() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, publisher) = setup(&env);

    let anchor = String::from_str(&env, "cowrie");
    let corridor = String::from_str(&env, "usdc-ngn");
    let hash = String::from_str(&env, "h");

    client.submit_outcome(&publisher, &anchor, &corridor, &hash, &10u64, &true);
    client.submit_outcome(&publisher, &anchor, &corridor, &hash, &20u64, &false);
    assert_eq!(
        client.get_corridor_aggregate(&anchor, &corridor),
        (2, 1, 30)
    );

    client.reset_corridor_aggregate(&admin, &anchor, &corridor);
    assert_eq!(client.get_corridor_aggregate(&anchor, &corridor), (0, 0, 0));
}

#[test]
fn a_non_admin_cannot_reset_an_aggregate() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);
    let stranger = Address::generate(&env);

    let anchor = String::from_str(&env, "cowrie");
    let corridor = String::from_str(&env, "usdc-ngn");
    let hash = String::from_str(&env, "h");
    client.submit_outcome(&publisher, &anchor, &corridor, &hash, &10u64, &true);

    let res = client.try_reset_corridor_aggregate(&stranger, &anchor, &corridor);
    assert_eq!(res, Err(Ok(Error::Unauthorized)));
    // Untouched.
    assert_eq!(
        client.get_corridor_aggregate(&anchor, &corridor),
        (1, 1, 10)
    );
}

// ── Volume / savings (previously untested) ─────────────────────────────────────

#[test]
fn volume_savings_accumulates_and_resets() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, publisher) = setup(&env);
    let corridor = String::from_str(&env, "usdc-ngn");

    client.add_volume_savings(&publisher, &corridor, &1_000i128, &50i128);
    client.add_volume_savings(&publisher, &corridor, &2_000i128, &70i128);

    let rec = client.get_volume_savings(&corridor).unwrap();
    assert_eq!(rec.volume_usdc, 3_000);
    assert_eq!(rec.savings_usdc, 120);
    assert_eq!(rec.settlement_count, 2);

    client.reset_volume_savings(&admin, &corridor);
    assert_eq!(client.get_volume_savings(&corridor), None);
}

#[test]
fn add_volume_savings_rejects_a_negative_delta() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);
    let corridor = String::from_str(&env, "usdc-ngn");

    let res = client.try_add_volume_savings(&publisher, &corridor, &-1i128, &0i128);
    assert_eq!(res, Err(Ok(Error::InvalidCorridorRate)));
}

// ── v2 dual-key freshness ──────────────────────────────────────────────────────

#[test]
fn set_corridor_metrics_keeps_v2_fresh_after_migration() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, publisher) = setup(&env);

    let anchor = String::from_str(&env, "cowrie");
    let corridor = String::from_str(&env, "usdc-ngn");

    // Seed v1, then migrate to v2 (v2 now mirrors the seed).
    client.set_corridor_metrics(
        &publisher, &anchor, &corridor, &9000i128, &100i128, &60u64, &10u32,
    );
    client.migrate_corridor_v2(&admin, &anchor, &corridor);

    // A later publisher update must reach v2, not just v1 (the freeze bug).
    client.set_corridor_metrics(
        &publisher, &anchor, &corridor, &5000i128, &200i128, &120u64, &7u32,
    );

    let (composite_bps, fill_rate_bps, slippage_bps, settle_seconds_p50, n) =
        client.get_score_for_corridor_v2(&anchor, &corridor);
    assert_eq!(fill_rate_bps, 5000);
    assert_eq!(slippage_bps, 200);
    assert_eq!(settle_seconds_p50, 120);
    assert_eq!(n, 7);
    // Composite recomputed from the new inputs, not the stale migrated snapshot.
    let expected = client.get_score_for_corridor(&anchor, &corridor).0;
    assert_eq!(composite_bps, expected);
    assert!(composite_bps > 0);
}

// ── bump() ─────────────────────────────────────────────────────────────────────

#[test]
fn bump_is_callable_by_anyone() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _publisher) = setup(&env);
    // Permissionless liveness top-up: must not panic or require auth.
    client.bump();
}
