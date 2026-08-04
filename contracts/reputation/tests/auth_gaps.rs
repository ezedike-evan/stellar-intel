//! Authorization tests for the three entrypoints that shipped unguarded (#907).
//!
//! `set_corridor_metrics`, `migrate_corridor_v2` and `migrate_all_v2` each took
//! no caller and checked nothing, so any account could forge an anchor's
//! reputation inputs or trigger a state migration. These tests pin the guards
//! so the gap cannot silently reopen.

use reputation::{Error, ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address) {
    let contract_id = env.register(ReputationContract, ());
    let client = ReputationContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.init(&admin);
    (client, admin)
}

#[test]
fn set_corridor_metrics_rejects_an_unregistered_publisher() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    let stranger = Address::generate(&env);
    let anchor = String::from_str(&env, "anchor-bitso");
    let corridor = String::from_str(&env, "usdc-ngn");

    // mock_all_auths() satisfies require_auth, so this asserts the registry
    // check specifically: holding a key is not the same as being a publisher.
    let result = client.try_set_corridor_metrics(
        &stranger, &anchor, &corridor, &9700i128, &110i128, &42u64, &1240u32,
    );

    assert_eq!(result, Err(Ok(Error::PublisherUnauthorized)));
}

#[test]
fn set_corridor_metrics_accepts_a_registered_publisher() {
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

    let (_composite, fill_rate_bps, settle_seconds_p50, n) =
        client.get_score_for_corridor(&anchor, &corridor);
    assert_eq!(fill_rate_bps, 9700);
    assert_eq!(settle_seconds_p50, 42);
    assert_eq!(n, 1240);
}

#[test]
fn set_corridor_metrics_rejects_a_revoked_publisher() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let publisher = Address::generate(&env);
    client.add_publisher(&admin, &publisher);
    client.revoke_publisher(&admin, &publisher);

    let anchor = String::from_str(&env, "anchor-bitso");
    let corridor = String::from_str(&env, "usdc-ngn");

    let result = client.try_set_corridor_metrics(
        &publisher, &anchor, &corridor, &9700i128, &110i128, &42u64, &1240u32,
    );

    assert_eq!(result, Err(Ok(Error::PublisherUnauthorized)));
}

#[test]
fn migrate_corridor_v2_rejects_a_non_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    let stranger = Address::generate(&env);
    let anchor = String::from_str(&env, "anchor-bitso");
    let corridor = String::from_str(&env, "usdc-ngn");

    let result = client.try_migrate_corridor_v2(&stranger, &anchor, &corridor);

    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn migrate_corridor_v2_accepts_the_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let anchor = String::from_str(&env, "anchor-bitso");
    let corridor = String::from_str(&env, "usdc-ngn");

    client.migrate_corridor_v2(&admin, &anchor, &corridor);
}

#[test]
fn migrate_all_v2_rejects_a_non_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    let stranger = Address::generate(&env);

    let result = client.try_migrate_all_v2(&stranger);

    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn migrate_all_v2_accepts_the_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let anchor = String::from_str(&env, "anchor-bitso");
    client.register_anchor(&admin, &anchor);

    client.migrate_all_v2(&admin);
}

#[test]
fn migrated_metrics_survive_the_guard() {
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
    client.migrate_corridor_v2(&admin, &anchor, &corridor);

    // Adding authorization must not change what the migration actually moves.
    let (_composite, fill_rate_bps, _slippage, settle_seconds_p50, n) =
        client.get_score_for_corridor_v2(&anchor, &corridor);
    assert_eq!(fill_rate_bps, 9700);
    assert_eq!(settle_seconds_p50, 42);
    assert_eq!(n, 1240);
}
