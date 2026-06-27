#![cfg(test)]

use reputation::{Error, ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address) {
    let contract_id = env.register(ReputationContract, ());
    let client = ReputationContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    (client, admin)
}

#[test]
fn admin_can_add_and_revoke_publishers() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    
    client.init(&admin);
    
    let publisher = Address::generate(&env);
    
    // Initially empty
    assert_eq!(client.list_publishers().len(), 0);
    
    // Admin adds publisher
    client.add_publisher(&admin, &publisher);
    assert_eq!(client.list_publishers().len(), 1);
    assert_eq!(client.list_publishers().get(0).unwrap(), publisher.clone());
    
    // Admin revokes publisher
    client.revoke_publisher(&admin, &publisher);
    assert_eq!(client.list_publishers().len(), 0);
}

#[test]
fn non_admin_cannot_add_publisher() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    client.init(&admin);
    
    let stranger = Address::generate(&env);
    let publisher = Address::generate(&env);
    
    let res = client.try_add_publisher(&stranger, &publisher);
    assert_eq!(res, Err(Ok(Error::Unauthorized)));
}

#[test]
#[should_panic(expected = "Unauthorized: caller is not a whitelisted publisher")]
fn unauthorized_submission_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    client.init(&admin);
    
    let stranger = Address::generate(&env);
    let anchor_id = String::from_str(&env, "anchor1");
    let outcome_hash = String::from_str(&env, "hash1");
    
    // This should panic
    client.submit_outcome(&stranger, &anchor_id, &outcome_hash, &60, &true);
}

#[test]
fn authorized_publisher_can_submit() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    client.init(&admin);
    
    let publisher = Address::generate(&env);
    let anchor_id = String::from_str(&env, "anchor1");
    let outcome_hash = String::from_str(&env, "hash1");
    
    client.add_publisher(&admin, &publisher);
    
    // This should succeed
    client.submit_outcome(&publisher, &anchor_id, &outcome_hash, &60, &true);
    
    let outcomes = client.recent_outcomes(&anchor_id, &10);
    assert_eq!(outcomes.len(), 1);
}

#[test]
fn admin_can_submit_without_being_explicitly_whitelisted() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    client.init(&admin);
    
    let anchor_id = String::from_str(&env, "anchor1");
    let outcome_hash = String::from_str(&env, "hash1");
    
    // This should succeed because admin is always allowed
    client.submit_outcome(&admin, &anchor_id, &outcome_hash, &60, &true);
    
    let outcomes = client.recent_outcomes(&anchor_id, &10);
    assert_eq!(outcomes.len(), 1);
}
