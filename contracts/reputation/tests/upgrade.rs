//! Integration tests for the admin-gated contract upgrade hook (issue #352).

use reputation::{ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address) {
    let contract_id = env.register(ReputationContract, ());
    let client = ReputationContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    (client, admin)
}

#[test]
fn version_starts_at_one_after_init() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    assert_eq!(client.contract_version(), 0);

    client.init_upgrade(&admin);
    assert_eq!(client.contract_version(), 1);
}

#[test]
fn init_upgrade_is_one_shot() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    client.init_upgrade(&admin);

    let res = client.try_init_upgrade(&admin);
    assert!(res.is_err());
}

#[test]
fn upgrade_requires_admin_authorization() {
    let env = Env::default();
    let (client, admin) = setup(&env);

    env.mock_all_auths();
    client.init_upgrade(&admin);
    env.set_auths(&[]);

    let wasm_hash = BytesN::from_array(&env, &[0u8; 32]);
    let res = client.try_upgrade(&wasm_hash);
    assert!(res.is_err());
}

#[test]
fn contract_state_is_disjoint_from_upgrade_metadata() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    client.init(&admin);
    client.init_upgrade(&admin);
    client.add_publisher(&admin, &admin);

    let anchor = String::from_str(&env, "moneygram");
    let corridor = String::from_str(&env, "NGN-USD");
    let h1 = String::from_str(&env, "hash-1");
    let h2 = String::from_str(&env, "hash-2");
    client.submit_outcome(&admin, &anchor, &corridor, &h1, &10u64, &true);
    client.submit_outcome(&admin, &anchor, &corridor, &h2, &20u64, &false);

    assert_eq!(client.contract_version(), 1);

    let recent = client.recent_outcomes(&anchor, &5u32);
    assert_eq!(recent.len(), 2);
    assert_eq!(recent.get(0).unwrap().0, h2);
    assert_eq!(recent.get(1).unwrap().0, h1);
}
