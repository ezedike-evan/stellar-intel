//! Per-anchor probe signals (#1398).

use reputation::{Error, ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

struct Fixture<'a> {
    client: ReputationContractClient<'a>,
    admin: Address,
    publisher: Address,
    anchor: String,
}

fn setup(env: &Env) -> Fixture<'_> {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let contract_id = env.register(ReputationContract, (admin.clone(), admin.clone()));
    let client = ReputationContractClient::new(env, &contract_id);
    let publisher = Address::generate(env);
    let anchor = String::from_str(env, "cowrie");
    client.add_publisher(&admin, &publisher);
    client.register_anchor(&admin, &anchor);
    Fixture {
        client,
        admin,
        publisher,
        anchor,
    }
}

#[test]
fn publisher_can_publish_and_read() {
    let env = Env::default();
    let f = setup(&env);

    f.client
        .publish_probe_signals(&f.publisher, &f.anchor, &9800u32, &120u32, &450u32, &2u32);

    let stored = f.client.get_probe_signals(&f.anchor).unwrap();
    assert_eq!(stored.uptime_bps, 9800);
    assert_eq!(stored.p50_latency_ms, 120);
    assert_eq!(stored.p95_latency_ms, 450);
    assert_eq!(stored.drift_flag_count, 2);
    assert_eq!(stored.publisher, f.publisher);
    assert_eq!(stored.updated_at, env.ledger().timestamp());
}

#[test]
fn non_publisher_is_rejected() {
    let env = Env::default();
    let f = setup(&env);
    let stranger = Address::generate(&env);

    let res = f
        .client
        .try_publish_probe_signals(&stranger, &f.anchor, &9800u32, &120u32, &450u32, &0u32);

    assert_eq!(res, Err(Ok(Error::PublisherUnauthorized)));
    assert_eq!(f.client.get_probe_signals(&f.anchor), None);
}

#[test]
fn revoked_publisher_is_rejected() {
    let env = Env::default();
    let f = setup(&env);
    f.client.revoke_publisher(&f.admin, &f.publisher);

    let res = f.client.try_publish_probe_signals(
        &f.publisher,
        &f.anchor,
        &9800u32,
        &120u32,
        &450u32,
        &0u32,
    );

    assert_eq!(res, Err(Ok(Error::PublisherUnauthorized)));
}

#[test]
fn uptime_over_10000_rejected() {
    let env = Env::default();
    let f = setup(&env);

    let res = f.client.try_publish_probe_signals(
        &f.publisher,
        &f.anchor,
        &10_001u32,
        &120u32,
        &450u32,
        &0u32,
    );

    assert_eq!(res, Err(Ok(Error::OutOfRange)));
    assert_eq!(f.client.get_probe_signals(&f.anchor), None);

    // The boundary itself is fine.
    f.client
        .publish_probe_signals(&f.publisher, &f.anchor, &10_000u32, &120u32, &450u32, &0u32);
}

#[test]
fn p50_above_p95_rejected() {
    let env = Env::default();
    let f = setup(&env);

    let res = f.client.try_publish_probe_signals(
        &f.publisher,
        &f.anchor,
        &9800u32,
        &451u32,
        &450u32,
        &0u32,
    );

    assert_eq!(res, Err(Ok(Error::OutOfRange)));

    // Equal is fine.
    f.client
        .publish_probe_signals(&f.publisher, &f.anchor, &9800u32, &450u32, &450u32, &0u32);
}

#[test]
fn zero_latency_sentinel_accepted() {
    let env = Env::default();
    let f = setup(&env);

    // Probed, never reachable: no latency to report.
    f.client
        .publish_probe_signals(&f.publisher, &f.anchor, &0u32, &0u32, &0u32, &3u32);

    let stored = f.client.get_probe_signals(&f.anchor).unwrap();
    assert_eq!(
        (
            stored.uptime_bps,
            stored.p50_latency_ms,
            stored.p95_latency_ms
        ),
        (0, 0, 0)
    );
}

#[test]
fn unknown_anchor_reads_none() {
    let env = Env::default();
    let f = setup(&env);
    let unknown = String::from_str(&env, "never-probed");

    assert_eq!(f.client.get_probe_signals(&unknown), None);
}

#[test]
fn publish_overwrites_previous() {
    let env = Env::default();
    let f = setup(&env);

    f.client
        .publish_probe_signals(&f.publisher, &f.anchor, &9000u32, &100u32, &200u32, &1u32);
    f.client
        .publish_probe_signals(&f.publisher, &f.anchor, &9900u32, &80u32, &160u32, &0u32);

    let stored = f.client.get_probe_signals(&f.anchor).unwrap();
    assert_eq!(stored.uptime_bps, 9900);
    assert_eq!(stored.drift_flag_count, 0);
}

#[test]
fn an_unregistered_anchor_is_rejected() {
    let env = Env::default();
    let f = setup(&env);
    let invented = String::from_str(&env, "invented");

    let res = f.client.try_publish_probe_signals(
        &f.publisher,
        &invented,
        &9800u32,
        &120u32,
        &450u32,
        &0u32,
    );

    assert_eq!(res, Err(Ok(Error::AnchorNotRegistered)));
    assert_eq!(f.client.get_probe_signals(&invented), None);
}
