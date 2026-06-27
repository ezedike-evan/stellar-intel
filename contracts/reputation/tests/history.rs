//! Tests for recent_outcomes function

use reputation::{Error, ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address) {
    let contract_id = env.register(ReputationContract, ());
    let client = ReputationContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    (client, admin)
}

#[test]
fn test_recent_outcomes() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    client.init(&admin);
    let anchor = String::from_str(&env, "testanchor");

    // Submit 5 outcomes
    for i in 0..5 {
        let hash = String::from_str(&env, &format!("hash{}", i));
        let settle = 10 + i as u64;
        let success = i % 2 == 0;
        client.submit_outcome(&admin, &anchor, &hash, &settle, &success);
    }

    // Retrieve the last 3 outcomes
    let recent = client.recent_outcomes(&anchor, &3);
    assert_eq!(recent.len(), 3);
    // Expect outcomes with i=4,3,2 in that order
    let expected_hashes = ["hash4", "hash3", "hash2"];
    for (idx, (hash, settle, success)) in recent.iter().enumerate() {
        assert_eq!(hash, String::from_str(&env, expected_hashes[idx]));
        assert_eq!(settle, 14 - idx as u64);
        assert_eq!(success, (4 - idx) % 2 == 0);
    }
}
