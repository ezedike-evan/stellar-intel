//! Publisher writes only accept registered anchors (#1384, audit M-5).

use reputation::{Error, ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address, Address) {
    let admin = Address::generate(env);
    let contract_id = env.register(ReputationContract, (admin.clone(), admin.clone()));
    let client = ReputationContractClient::new(env, &contract_id);
    let publisher = Address::generate(env);
    client.add_publisher(&admin, &publisher);
    (client, admin, publisher)
}

#[test]
fn submit_outcome_rejects_unregistered_anchor() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);
    let anchor = String::from_str(&env, "never-registered");
    let corridor = String::from_str(&env, "usdc-ngn");
    let hash = String::from_str(&env, "h1");

    let res = client.try_submit_outcome(&publisher, &anchor, &corridor, &hash, &30u64, &true);

    assert_eq!(res, Err(Ok(Error::AnchorNotRegistered)));
    assert_eq!(client.recent_outcomes(&anchor, &10u32).len(), 0);
    assert_eq!(client.get_corridor_aggregate(&anchor, &corridor), (0, 0, 0));
}

#[test]
fn set_corridor_metrics_rejects_unregistered_anchor() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);
    let anchor = String::from_str(&env, "never-registered");
    let corridor = String::from_str(&env, "usdc-ngn");

    let res = client.try_set_corridor_metrics(
        &publisher, &anchor, &corridor, &9000i128, &50i128, &60u64, &5u32,
    );

    assert_eq!(res, Err(Ok(Error::AnchorNotRegistered)));
    assert_eq!(
        client.get_score_for_corridor(&anchor, &corridor),
        (0, 0, 0, 0)
    );
    assert_eq!(
        client.get_score_for_corridor_v2(&anchor, &corridor),
        (0, 0, 0, 0, 0)
    );
}

#[test]
fn registered_anchor_is_accepted_by_both() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, publisher) = setup(&env);
    let anchor = String::from_str(&env, "cowrie");
    let corridor = String::from_str(&env, "usdc-ngn");
    let hash = String::from_str(&env, "h1");
    client.register_anchor(&admin, &anchor);

    client.submit_outcome(&publisher, &anchor, &corridor, &hash, &30u64, &true);
    client.set_corridor_metrics(
        &publisher, &anchor, &corridor, &9000i128, &50i128, &60u64, &5u32,
    );

    assert_eq!(client.recent_outcomes(&anchor, &10u32).len(), 1);
    assert_eq!(client.get_corridor_aggregate(&anchor, &corridor).0, 1);
    assert_eq!(client.get_score_for_corridor(&anchor, &corridor).1, 9000);
}

#[test]
fn the_publisher_check_still_comes_first() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _publisher) = setup(&env);
    let stranger = Address::generate(&env);
    let anchor = String::from_str(&env, "never-registered");
    let corridor = String::from_str(&env, "usdc-ngn");
    let hash = String::from_str(&env, "h1");

    let res = client.try_submit_outcome(&stranger, &anchor, &corridor, &hash, &30u64, &true);
    assert_eq!(res, Err(Ok(Error::PublisherUnauthorized)));
}
