//! Publisher writes emit one event each; rejected writes emit none (#1387).

use reputation::{Error, ReputationContract, ReputationContractClient};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events},
    vec, Address, Env, IntoVal, String,
};

struct Fixture<'a> {
    client: ReputationContractClient<'a>,
    publisher: Address,
    anchor: String,
    corridor: String,
}

fn setup(env: &Env) -> Fixture<'_> {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let contract_id = env.register(ReputationContract, (admin.clone(), admin.clone()));
    let client = ReputationContractClient::new(env, &contract_id);
    let publisher = Address::generate(env);
    let anchor = String::from_str(env, "cowrie");
    let corridor = String::from_str(env, "usdc-ngn");
    client.add_publisher(&admin, &publisher);
    client.register_anchor(&admin, &anchor);
    client.register_corridor(&admin, &corridor);
    Fixture {
        client,
        publisher,
        anchor,
        corridor,
    }
}

#[test]
fn submit_outcome_emits_one_event() {
    let env = Env::default();
    let f = setup(&env);
    let hash = String::from_str(&env, "h1");

    f.client
        .submit_outcome(&f.publisher, &f.anchor, &f.corridor, &hash, &30u64, &true);

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                f.client.address.clone(),
                (
                    symbol_short!("outcome"),
                    f.anchor.clone(),
                    f.corridor.clone()
                )
                    .into_val(&env),
                (f.publisher.clone(), 30u64, true).into_val(&env),
            )
        ]
    );
}

#[test]
fn set_corridor_metrics_emits_one_event() {
    let env = Env::default();
    let f = setup(&env);

    f.client.set_corridor_metrics(
        &f.publisher,
        &f.anchor,
        &f.corridor,
        &9000i128,
        &0i128,
        &300u64,
        &12u32,
    );

    // Fill 90%, no slippage, settle at the 300 s norm: composite 9000.
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                f.client.address.clone(),
                (
                    symbol_short!("metrics"),
                    f.anchor.clone(),
                    f.corridor.clone()
                )
                    .into_val(&env),
                (f.publisher.clone(), 9000i128, 12u32).into_val(&env),
            )
        ]
    );
}

#[test]
fn publish_corridor_rate_emits_one_event() {
    let env = Env::default();
    let f = setup(&env);

    f.client
        .publish_corridor_rate(&f.publisher, &f.corridor, &1650_0000000i128, &7u32);

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                f.client.address.clone(),
                (symbol_short!("rate"), f.corridor.clone()).into_val(&env),
                (f.publisher.clone(), 1650_0000000i128, 7u32).into_val(&env),
            )
        ]
    );
}

#[test]
fn add_volume_savings_emits_one_event() {
    let env = Env::default();
    let f = setup(&env);

    f.client
        .add_volume_savings(&f.publisher, &f.corridor, &1_000i128, &50i128);

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                f.client.address.clone(),
                (symbol_short!("volume"), f.corridor.clone()).into_val(&env),
                (f.publisher.clone(), 1_000i128, 50i128).into_val(&env),
            )
        ]
    );
}

#[test]
fn rejected_write_emits_no_event() {
    let env = Env::default();
    let f = setup(&env);
    let stranger = Address::generate(&env);
    let hash = String::from_str(&env, "h1");

    let res = f
        .client
        .try_submit_outcome(&stranger, &f.anchor, &f.corridor, &hash, &30u64, &true);

    assert_eq!(res, Err(Ok(Error::PublisherUnauthorized)));
    assert_eq!(env.events().all(), vec![&env]);
}

#[test]
fn publish_probe_signals_emits_one_event() {
    let env = Env::default();
    let f = setup(&env);

    f.client
        .publish_probe_signals(&f.publisher, &f.anchor, &9800u32, &120u32, &450u32, &2u32);

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                f.client.address.clone(),
                (symbol_short!("probe"), f.anchor.clone()).into_val(&env),
                (f.publisher.clone(), 9800u32).into_val(&env),
            )
        ]
    );
}
