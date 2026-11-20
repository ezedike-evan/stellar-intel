//! Registry, custody and upgrade changes emit events (#1388).
//!
//! The `upgrade` event is covered by a unit test in `src/events.rs`: it cannot
//! be observed through `try_upgrade`, because the host rejects the unknown WASM
//! hash and rolls the invocation back.

use reputation::{ReputationContract, ReputationContractClient};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events},
    vec, Address, Env, IntoVal, String, Symbol, Val, Vec,
};

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let contract_id = env.register(ReputationContract, (admin.clone(), admin.clone()));
    (ReputationContractClient::new(env, &contract_id), admin)
}

/// The one event expected from the last invocation.
fn only_event(env: &Env, client: &ReputationContractClient<'_>, topics: Vec<Val>, data: Val) {
    assert_eq!(
        env.events().all(),
        vec![&env, (client.address.clone(), topics, data)]
    );
}

#[test]
fn register_anchor_emits_anchor_reg() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let anchor = String::from_str(&env, "cowrie");

    client.register_anchor(&admin, &anchor);

    only_event(
        &env,
        &client,
        (Symbol::new(&env, "anchor_reg"), anchor).into_val(&env),
        admin.into_val(&env),
    );
}

#[test]
fn add_publisher_emits_pub_add() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let publisher = Address::generate(&env);

    client.add_publisher(&admin, &publisher);

    only_event(
        &env,
        &client,
        (symbol_short!("pub_add"), publisher).into_val(&env),
        admin.into_val(&env),
    );
}

#[test]
fn revoke_publisher_emits_pub_rev() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let publisher = Address::generate(&env);
    client.add_publisher(&admin, &publisher);

    client.revoke_publisher(&admin, &publisher);

    only_event(
        &env,
        &client,
        (symbol_short!("pub_rev"), publisher).into_val(&env),
        admin.into_val(&env),
    );
}

#[test]
fn propose_admin_emits_adm_prop() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let candidate = Address::generate(&env);

    client.propose_admin(&admin, &candidate);

    only_event(
        &env,
        &client,
        (symbol_short!("adm_prop"), candidate).into_val(&env),
        admin.into_val(&env),
    );
}

#[test]
fn accept_admin_emits_adm_acc() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let candidate = Address::generate(&env);
    client.propose_admin(&admin, &candidate);

    client.accept_admin(&candidate);

    only_event(
        &env,
        &client,
        (symbol_short!("adm_acc"), candidate.clone()).into_val(&env),
        candidate.into_val(&env),
    );
}

#[test]
fn cancel_admin_proposal_emits_adm_cncl() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let candidate = Address::generate(&env);
    client.propose_admin(&admin, &candidate);

    client.cancel_admin_proposal(&admin);

    only_event(
        &env,
        &client,
        (symbol_short!("adm_cncl"), candidate).into_val(&env),
        admin.into_val(&env),
    );
}

#[test]
fn propose_upgrade_admin_emits_upg_prop() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let candidate = Address::generate(&env);

    client.propose_upgrade_admin(&admin, &candidate);

    only_event(
        &env,
        &client,
        (symbol_short!("upg_prop"), candidate).into_val(&env),
        admin.into_val(&env),
    );
}

#[test]
fn accept_upgrade_admin_emits_upg_acc() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let candidate = Address::generate(&env);
    client.propose_upgrade_admin(&admin, &candidate);

    client.accept_upgrade_admin(&candidate);

    only_event(
        &env,
        &client,
        (symbol_short!("upg_acc"), candidate.clone()).into_val(&env),
        candidate.into_val(&env),
    );
}

#[test]
fn cancel_upgrade_proposal_emits_upg_cncl() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let candidate = Address::generate(&env);
    client.propose_upgrade_admin(&admin, &candidate);

    client.cancel_upgrade_proposal(&admin);

    only_event(
        &env,
        &client,
        (symbol_short!("upg_cncl"), candidate).into_val(&env),
        admin.into_val(&env),
    );
}

#[test]
fn cancelling_nothing_emits_nothing() {
    let env = Env::default();
    let (client, admin) = setup(&env);

    client.cancel_admin_proposal(&admin);
    assert_eq!(env.events().all(), vec![&env]);

    client.cancel_upgrade_proposal(&admin);
    assert_eq!(env.events().all(), vec![&env]);
}

#[test]
fn reset_corridor_aggregate_emits_agg_rst() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let anchor = String::from_str(&env, "cowrie");
    let corridor = String::from_str(&env, "usdc-ngn");

    client.reset_corridor_aggregate(&admin, &anchor, &corridor);

    only_event(
        &env,
        &client,
        (symbol_short!("agg_rst"), anchor, corridor).into_val(&env),
        admin.into_val(&env),
    );
}

#[test]
fn reset_volume_savings_emits_vol_rst() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let corridor = String::from_str(&env, "usdc-ngn");

    client.reset_volume_savings(&admin, &corridor);

    only_event(
        &env,
        &client,
        (symbol_short!("vol_rst"), corridor).into_val(&env),
        admin.into_val(&env),
    );
}

#[test]
fn failed_add_publisher_from_a_non_admin_emits_nothing() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let stranger = Address::generate(&env);
    let publisher = Address::generate(&env);

    let res = client.try_add_publisher(&stranger, &publisher);

    assert!(res.is_err());
    assert_eq!(env.events().all(), vec![&env]);
}

#[test]
fn reset_outcome_history_emits_hist_rst() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let anchor = String::from_str(&env, "cowrie");

    client.reset_outcome_history(&admin, &anchor);

    only_event(
        &env,
        &client,
        (symbol_short!("hist_rst"), anchor).into_val(&env),
        admin.into_val(&env),
    );
}
