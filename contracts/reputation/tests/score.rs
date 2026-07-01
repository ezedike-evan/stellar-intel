//! Integration tests for corridor score reads.

use reputation::{ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

const MAX_BPS: i128 = 10000;

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address) {
    let contract_id = env.register(ReputationContract, ());
    let client = ReputationContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    (client, admin)
}

fn expected_composite_bps(fill_rate_bps: i128, slippage_bps: i128, settle_seconds_p50: u64) -> i128 {
    let fill_rate_bps = fill_rate_bps.clamp(0, MAX_BPS);
    let slippage_bps = slippage_bps.clamp(0, MAX_BPS);
    let settle_seconds = settle_seconds_p50.max(1) as i128;

    if fill_rate_bps == 0 {
        return 0;
    }

    let effective_fill_bps = fill_rate_bps * (MAX_BPS - slippage_bps);
    let numerator = effective_fill_bps * 300;
    let denominator = MAX_BPS * settle_seconds;
    (numerator + denominator / 2) / denominator
}

#[test]
fn test_get_score_for_corridor_returns_default_for_missing_metrics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    client.init(&admin);

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
    client.init(&admin);

    let anchor = String::from_str(&env, "anchor-bitso");
    let corridor = String::from_str(&env, "usdc-ngn");

    client.set_corridor_metrics(&anchor, &corridor, &9700i128, &110i128, &42u64, &1240u32);

    let (composite_bps, fill_rate_bps, settle_seconds_p50, n) =
        client.get_score_for_corridor(&anchor, &corridor);

    assert_eq!(fill_rate_bps, 9700);
    assert_eq!(settle_seconds_p50, 42);
    assert_eq!(n, 1240);
    assert_eq!(composite_bps, expected_composite_bps(9700, 110, 42));
}

#[test]
fn test_get_score_for_corridor_clamps_metrics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    client.init(&admin);

    let anchor = String::from_str(&env, "anchor-anclax");
    let corridor = String::from_str(&env, "usdc-kes");

    client.set_corridor_metrics(&anchor, &corridor, &11000i128, &-100i128, &0u64, &33u32);

    let (composite_bps, fill_rate_bps, settle_seconds_p50, n) =
        client.get_score_for_corridor(&anchor, &corridor);

    assert_eq!(fill_rate_bps, 11000);
    assert_eq!(settle_seconds_p50, 0);
    assert_eq!(n, 33);
    assert_eq!(composite_bps, expected_composite_bps(11000, -100, 0));
}
