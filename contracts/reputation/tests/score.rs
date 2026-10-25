//! Integration tests for corridor score reads.

use reputation::{Error, ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

const MAX_BPS: i128 = 10000;

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address) {
    let admin = Address::generate(env);
    let contract_id = env.register(ReputationContract, (admin.clone(), admin.clone()));
    let client = ReputationContractClient::new(env, &contract_id);
    (client, admin)
}

fn expected_composite_bps(
    fill_rate_bps: i128,
    slippage_bps: i128,
    settle_seconds_p50: u64,
) -> i128 {
    let fill_rate_bps = fill_rate_bps.clamp(0, MAX_BPS);
    let slippage_bps = slippage_bps.clamp(0, MAX_BPS);
    let settle_seconds = settle_seconds_p50.max(1) as i128;

    if fill_rate_bps == 0 {
        return 0;
    }

    let effective_fill_bps = fill_rate_bps * (MAX_BPS - slippage_bps);
    let numerator = effective_fill_bps * 300;
    let denominator = MAX_BPS * settle_seconds;
    ((numerator + denominator / 2) / denominator).clamp(0, MAX_BPS)
}

#[test]
fn test_get_score_for_corridor_returns_default_for_missing_metrics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    let anchor = String::from_str(&env, "anchor-bitso");
    let corridor = String::from_str(&env, "usdc-ngn");

    let (composite_bps, fill_rate_bps, settle_seconds_p50, n) =
        client.get_score_for_corridor(&anchor, &corridor);

    assert_eq!(composite_bps, 0);
    assert_eq!(fill_rate_bps, 0);
    assert_eq!(settle_seconds_p50, 0);
    assert_eq!(n, 0);
}

#[test]
fn test_get_score_for_corridor_reads_stored_metrics_and_computes_composite() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let publisher = Address::generate(&env);
    client.add_publisher(&admin, &publisher);

    let anchor = String::from_str(&env, "anchor-bitso");
    let corridor = String::from_str(&env, "usdc-ngn");

    client.set_corridor_metrics(
        &publisher, &anchor, &corridor, &9700i128, &110i128, &42u64, &1240u32,
    );

    let (composite_bps, fill_rate_bps, settle_seconds_p50, n) =
        client.get_score_for_corridor(&anchor, &corridor);

    assert_eq!(fill_rate_bps, 9700);
    assert_eq!(settle_seconds_p50, 42);
    assert_eq!(n, 1240);
    assert_eq!(composite_bps, expected_composite_bps(9700, 110, 42));
}

#[test]
fn test_get_score_for_corridor_rejects_out_of_range_metrics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let publisher = Address::generate(&env);
    client.add_publisher(&admin, &publisher);

    let anchor = String::from_str(&env, "anchor-anclax");
    let corridor = String::from_str(&env, "usdc-kes");

    // Out-of-range input used to be stored raw and clamped on read; it is now
    // refused at write time (#1381).
    let res = client.try_set_corridor_metrics(
        &publisher, &anchor, &corridor, &11000i128, &-100i128, &0u64, &33u32,
    );
    assert_eq!(res, Err(Ok(Error::OutOfRange)));
    assert_eq!(
        client.get_score_for_corridor(&anchor, &corridor),
        (0, 0, 0, 0)
    );
}

fn publish_metrics(
    env: &Env,
    fill_rate_bps: i128,
    slippage_bps: i128,
    settle_seconds_p50: u64,
) -> (ReputationContractClient<'_>, String, String) {
    let (client, admin) = setup(env);
    let publisher = Address::generate(env);
    client.add_publisher(&admin, &publisher);

    let anchor = String::from_str(env, "anchor-fast");
    let corridor = String::from_str(env, "usdc-ngn");
    client.set_corridor_metrics(
        &publisher,
        &anchor,
        &corridor,
        &fill_rate_bps,
        &slippage_bps,
        &settle_seconds_p50,
        &10u32,
    );
    (client, anchor, corridor)
}

#[test]
fn composite_is_clamped_for_sub_norm_settle_time() {
    let env = Env::default();
    env.mock_all_auths();
    // Fill 100%, no slippage, settle in 1 s: the unclamped value is 3_000_000.
    let (client, anchor, corridor) = publish_metrics(&env, 10000, 0, 1);

    assert_eq!(client.get_score_for_corridor(&anchor, &corridor).0, 10000);
}

#[test]
fn composite_v2_is_clamped() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, anchor, corridor) = publish_metrics(&env, 10000, 0, 1);

    // The v2 getter returns (composite, fill, slippage, settle, n).
    assert_eq!(
        client.get_score_for_corridor_v2(&anchor, &corridor).0,
        10000
    );
}

#[test]
fn composite_is_unchanged_at_or_above_the_norm() {
    let env = Env::default();
    env.mock_all_auths();
    // Fill 90%, no slippage, settle exactly at the 300 s norm: in range already.
    let (client, anchor, corridor) = publish_metrics(&env, 9000, 0, 300);

    assert_eq!(client.get_score_for_corridor(&anchor, &corridor).0, 9000);
}
