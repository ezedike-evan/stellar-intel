//! Integration tests for the reputation registry (roadmap #138).
//!
//! Verifies the init + register + list round-trip and the admin authorization
//! and duplicate-protection error paths.

use reputation::{Error, ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address) {
    let contract_id = env.register(ReputationContract, ());
    let client = ReputationContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    (client, admin)
}

#[test]
fn init_register_list_round_trip() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    client.init(&admin);
    assert_eq!(client.admin(), Some(admin.clone()));

    // Initially empty.
    assert_eq!(client.list_anchors().len(), 0);

    let a1 = String::from_str(&env, "moneygram");
    let a2 = String::from_str(&env, "cowrie");
    client.register_anchor(&admin, &a1);
    client.register_anchor(&admin, &a2);

    let anchors = client.list_anchors();
    assert_eq!(anchors.len(), 2);
    // Insertion order preserved.
    assert_eq!(anchors.get(0).unwrap(), a1);
    assert_eq!(anchors.get(1).unwrap(), a2);
}

#[test]
fn init_is_one_shot() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    client.init(&admin);
    // A second init must fail with AlreadyInitialized.
    let res = client.try_init(&admin);
    assert_eq!(res, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn register_before_init_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let anchor = String::from_str(&env, "anclap");
    let res = client.try_register_anchor(&admin, &anchor);
    assert_eq!(res, Err(Ok(Error::NotInitialized)));
}

#[test]
fn non_admin_cannot_register() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    client.init(&admin);

    let stranger = Address::generate(&env);
    let anchor = String::from_str(&env, "evil-anchor");
    let res = client.try_register_anchor(&stranger, &anchor);
    assert_eq!(res, Err(Ok(Error::Unauthorized)));
}

#[test]
fn duplicate_anchor_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    client.init(&admin);

    let anchor = String::from_str(&env, "moneygram");
    client.register_anchor(&admin, &anchor);

    let res = client.try_register_anchor(&admin, &anchor);
    assert_eq!(res, Err(Ok(Error::AnchorExists)));

    // The duplicate did not grow the list.
    assert_eq!(client.list_anchors().len(), 1);
}

#[test]
fn requires_admin_auth() {
    let env = Env::default();
    // NOTE: no mock_all_auths() — require_auth must fail without authorization.
    let (client, admin) = setup(&env);
    env.mock_all_auths();
    client.init(&admin);
    env.set_auths(&[]); // clear mocked auths

    let anchor = String::from_str(&env, "needs-auth");
    // Without the admin's authorization, the call panics on require_auth.
    let res = client.try_register_anchor(&admin, &anchor);
    assert!(res.is_err());
}
