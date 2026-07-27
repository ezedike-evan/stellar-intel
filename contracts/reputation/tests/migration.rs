//! Integration tests for the v1→v2 oracle migration path.

use reputation::{ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address) {
    let contract_id = env.register(ReputationContract, ());
    let client = ReputationContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    (client, admin)
}

#[test]
fn test_v2_readers_are_available_without_breaking_existing_v1_calls() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    client.init(&admin);

    let anchor = String::from_str(&env, "anchor-migration");
    let corridor = String::from_str(&env, "usdc-zar");
    let outcome_hash = String::from_str(&env, "migration-hash");

    client.submit_outcome(&admin, &anchor, &corridor, &outcome_hash, &88u64, &false);
    client.set_corridor_metrics(&anchor, &corridor, &9300i128, &120i128, &60u64, &240u32);

    let (total, successes, settle_seconds_sum) = client.get_corridor_aggregate(&anchor, &corridor);
    let (composite_bps, fill_rate_bps, settle_seconds_p50, n) =
        client.get_score_for_corridor(&anchor, &corridor);
    let (v2_total, v2_successes, v2_settle_seconds_sum) =
        client.get_corridor_aggregate_v2(&anchor, &corridor);
    let (v2_composite_bps, v2_fill_rate_bps, v2_settle_seconds_p50, v2_n) =
        client.get_score_for_corridor_v2(&anchor, &corridor);

    assert_eq!(total, 1);
    assert_eq!(successes, 0);
    assert_eq!(settle_seconds_sum, 88);
    assert_eq!(v2_total, 1);
    assert_eq!(v2_successes, 0);
    assert_eq!(v2_settle_seconds_sum, 88);
    assert_eq!(composite_bps, v2_composite_bps);
    assert_eq!(fill_rate_bps, v2_fill_rate_bps);
    assert_eq!(settle_seconds_p50, v2_settle_seconds_p50);
    assert_eq!(n, v2_n);
}
