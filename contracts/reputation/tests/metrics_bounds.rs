//! `set_corridor_metrics` refuses out-of-range input at write time (#1381).

use reputation::{Error, ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address, String, String) {
    let admin = Address::generate(env);
    let contract_id = env.register(ReputationContract, (admin.clone(), admin.clone()));
    let client = ReputationContractClient::new(env, &contract_id);
    let publisher = Address::generate(env);
    client.add_publisher(&admin, &publisher);
    let anchor = String::from_str(env, "anchor-bounds");
    client.register_anchor(&admin, &anchor);
    (client, publisher, anchor, String::from_str(env, "usdc-ngn"))
}

/// Asserts the call is refused and that it wrote neither the v1 nor the v2 key.
fn assert_rejected(fill: i128, slippage: i128, settle: u64) {
    let env = Env::default();
    env.mock_all_auths();
    let (client, publisher, anchor, corridor) = setup(&env);

    let res = client.try_set_corridor_metrics(
        &publisher, &anchor, &corridor, &fill, &slippage, &settle, &5u32,
    );

    assert_eq!(res, Err(Ok(Error::OutOfRange)));
    assert_eq!(
        client.get_score_for_corridor(&anchor, &corridor),
        (0, 0, 0, 0)
    );
    assert_eq!(
        client.get_score_for_corridor_v2(&anchor, &corridor),
        (0, 0, 0, 0, 0)
    );
}

#[test]
fn fill_rate_below_zero_is_rejected() {
    assert_rejected(-1, 0, 60);
}

#[test]
fn fill_rate_above_10000_is_rejected() {
    assert_rejected(10001, 0, 60);
}

#[test]
fn slippage_below_zero_is_rejected() {
    assert_rejected(9000, -1, 60);
}

#[test]
fn slippage_above_10000_is_rejected() {
    assert_rejected(9000, 10001, 60);
}

#[test]
fn settle_seconds_above_the_cap_is_rejected() {
    assert_rejected(9000, 0, 1_000_001);
}

#[test]
fn lower_bounds_are_accepted() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, publisher, anchor, corridor) = setup(&env);

    client.set_corridor_metrics(&publisher, &anchor, &corridor, &0i128, &0i128, &0u64, &1u32);
    assert_eq!(client.get_score_for_corridor(&anchor, &corridor).3, 1);
}

#[test]
fn upper_bounds_are_accepted() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, publisher, anchor, corridor) = setup(&env);

    client.set_corridor_metrics(
        &publisher,
        &anchor,
        &corridor,
        &10000i128,
        &10000i128,
        &1_000_000u64,
        &2u32,
    );
    let (_, fill, settle, n) = client.get_score_for_corridor(&anchor, &corridor);
    assert_eq!((fill, settle, n), (10000, 1_000_000, 2));
}

#[test]
fn a_rejected_call_leaves_earlier_metrics_untouched() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, publisher, anchor, corridor) = setup(&env);

    client.set_corridor_metrics(
        &publisher, &anchor, &corridor, &9000i128, &50i128, &60u64, &7u32,
    );
    let before = client.get_score_for_corridor_v2(&anchor, &corridor);

    let res = client.try_set_corridor_metrics(
        &publisher, &anchor, &corridor, &20000i128, &50i128, &60u64, &8u32,
    );
    assert_eq!(res, Err(Ok(Error::OutOfRange)));
    assert_eq!(client.get_score_for_corridor_v2(&anchor, &corridor), before);
}
