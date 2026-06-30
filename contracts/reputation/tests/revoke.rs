//! Tests for publisher revocation and outcome submission authorization.

use reputation::{Error, ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address) {
    let contract_id = env.register(ReputationContract, ());
    let client = ReputationContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    (client, admin)
}

#[test]
fn revoked_publisher_cannot_submit_outcome() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin) = setup(&env);
    client.init(&admin);

    let publisher = Address::generate(&env);
    client.add_publisher(&admin, &publisher);

    let anchor_id = String::from_str(&env, "moneygram");
    let outcome_hash = String::from_str(&env, "hash-1");

    // The publisher should be able to submit while authorized.
    client
        .submit_outcome(&publisher, &anchor_id, &outcome_hash, 1, true)
        .unwrap();

    client.revoke_publisher(&admin, &publisher).unwrap();

    let outcome_hash2 = String::from_str(&env, "hash-2");
    let result = std::panic::catch_unwind(|| {
        client.submit_outcome(&publisher, &anchor_id, &outcome_hash2, 1, true);
    });

    assert!(result.is_err());

    let res = client.try_submit_outcome(&publisher, &anchor_id, &outcome_hash2, 1, true);
    assert_eq!(res, Err(Ok(Error::PublisherUnauthorized)));
}
