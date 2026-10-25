//! The corridor registry gates rate and volume writes (#1385, audit M-5).

use reputation::{Error, ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, vec, Address, Env, String};

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address, Address) {
    let admin = Address::generate(env);
    let contract_id = env.register(ReputationContract, (admin.clone(), admin.clone()));
    let client = ReputationContractClient::new(env, &contract_id);
    let publisher = Address::generate(env);
    client.add_publisher(&admin, &publisher);
    (client, admin, publisher)
}

#[test]
fn admin_registers_and_lists_corridors() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _publisher) = setup(&env);
    let ngn = String::from_str(&env, "usdc-ngn");
    let kes = String::from_str(&env, "usdc-kes");

    assert_eq!(client.list_corridors().len(), 0);
    client.register_corridor(&admin, &ngn);
    client.register_corridor(&admin, &kes);

    // Insertion order is preserved.
    assert_eq!(client.list_corridors(), vec![&env, ngn, kes]);
}

#[test]
fn duplicate_corridor_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _publisher) = setup(&env);
    let ngn = String::from_str(&env, "usdc-ngn");

    client.register_corridor(&admin, &ngn);
    let res = client.try_register_corridor(&admin, &ngn);

    assert_eq!(res, Err(Ok(Error::CorridorExists)));
    assert_eq!(client.list_corridors().len(), 1);
}

#[test]
fn non_admin_cannot_register_corridor() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);
    let ngn = String::from_str(&env, "usdc-ngn");

    let res = client.try_register_corridor(&publisher, &ngn);

    assert_eq!(res, Err(Ok(Error::Unauthorized)));
    assert_eq!(client.list_corridors().len(), 0);
}

#[test]
fn publish_rate_rejects_unregistered_corridor() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);
    let invented = String::from_str(&env, "usdc-invented");

    let res = client.try_publish_corridor_rate(&publisher, &invented, &1000i128, &7u32);

    assert_eq!(res, Err(Ok(Error::CorridorNotRegistered)));
    assert_eq!(client.get_corridor_rate(&invented), None);
}

#[test]
fn add_volume_savings_rejects_unregistered_corridor() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);
    let invented = String::from_str(&env, "usdc-invented");

    let res = client.try_add_volume_savings(&publisher, &invented, &1_000i128, &10i128);

    assert_eq!(res, Err(Ok(Error::CorridorNotRegistered)));
    assert_eq!(client.get_volume_savings(&invented), None);
}

#[test]
fn registered_corridor_accepts_both_writes() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, publisher) = setup(&env);
    let ngn = String::from_str(&env, "usdc-ngn");
    client.register_corridor(&admin, &ngn);

    client.publish_corridor_rate(&publisher, &ngn, &1650_0000000i128, &7u32);
    client.add_volume_savings(&publisher, &ngn, &1_000i128, &10i128);

    assert_eq!(
        client.get_corridor_rate(&ngn).unwrap().rate,
        1650_0000000i128
    );
    assert_eq!(client.get_volume_savings(&ngn).unwrap().volume_usdc, 1_000);
}

#[test]
fn the_publisher_check_still_comes_first() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _publisher) = setup(&env);
    let stranger = Address::generate(&env);
    let invented = String::from_str(&env, "usdc-invented");

    let res = client.try_publish_corridor_rate(&stranger, &invented, &1000i128, &7u32);
    assert_eq!(res, Err(Ok(Error::PublisherUnauthorized)));
}
