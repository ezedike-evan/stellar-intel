//! Integration tests for the reputation registry (roadmap #138).
//!
//! Verifies the init + register + list round-trip and the admin authorization
//! and duplicate-protection error paths.

use reputation::{Error, ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address) {
    let admin = Address::generate(env);
    let contract_id = env.register(ReputationContract, (admin.clone(), admin.clone()));
    let client = ReputationContractClient::new(env, &contract_id);
    (client, admin)
}

#[test]
fn init_register_list_round_trip() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

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

// The former `init_is_one_shot` and `register_before_init_is_rejected` tests are
// gone by construction: `init` is no longer a callable entrypoint. The admin is
// bound in the constructor (see `constructor_binds_admin_and_upgrade_admin`), so
// there is no uninitialized window to register into and no second `init` to
// reject — the front-run the old callable `init` allowed is structurally
// impossible now.

#[test]
fn constructor_binds_admin_and_upgrade_admin() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let upgrade_admin = Address::generate(&env);
    let contract_id = env.register(ReputationContract, (admin.clone(), upgrade_admin.clone()));
    let client = ReputationContractClient::new(&env, &contract_id);

    // Both roles are bound atomically at deploy — no post-deploy init call.
    assert_eq!(client.admin(), Some(admin));
    assert_eq!(client.upgrade_admin(), Some(upgrade_admin));
    assert_eq!(client.contract_version(), 1);
}

#[test]
fn non_admin_cannot_register() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

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
    env.set_auths(&[]); // clear mocked auths

    let anchor = String::from_str(&env, "needs-auth");
    // Without the admin's authorization, the call panics on require_auth.
    let res = client.try_register_anchor(&admin, &anchor);
    assert!(res.is_err());
}
