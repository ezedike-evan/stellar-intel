//! Storage entries that gate writes stay alive while they are in use (#1390).
//!
//! A flag that is written once and never extended archives after ~31 days, and
//! then every write that reads it stalls until someone restores the entry
//! (audit P2, contract TTL).

use reputation::storage::{DataKey, TTL_EXTEND_LEDGERS};
use reputation::{ReputationContract, ReputationContractClient};
use soroban_sdk::{
    testutils::{storage::Persistent as _, Address as _, Ledger},
    vec, Address, Env, String,
};

struct Fixture<'a> {
    env: &'a Env,
    client: ReputationContractClient<'a>,
    admin: Address,
    publisher: Address,
    anchor: String,
    corridor: String,
}

fn setup(env: &Env) -> Fixture<'_> {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let contract_id = env.register(ReputationContract, (admin.clone(), admin.clone()));
    let client = ReputationContractClient::new(env, &contract_id);
    Fixture {
        env,
        client,
        publisher: Address::generate(env),
        anchor: String::from_str(env, "cowrie"),
        corridor: String::from_str(env, "usdc-ngn"),
        admin,
    }
}

impl Fixture<'_> {
    fn persistent_ttl(&self, key: &DataKey) -> u32 {
        self.env.as_contract(&self.client.address, || {
            self.env.storage().persistent().get_ttl(key)
        })
    }

    /// Moves the ledger so that `TTL_EXTEND_LEDGERS - 10` of an entry's life is gone.
    fn nearly_expire(&self) {
        self.env
            .ledger()
            .with_mut(|l| l.sequence_number += TTL_EXTEND_LEDGERS - 10);
    }
}

#[test]
fn register_anchor_extends_anchor_tag() {
    let env = Env::default();
    let f = setup(&env);

    f.client.register_anchor(&f.admin, &f.anchor);

    assert_eq!(
        f.persistent_ttl(&DataKey::AnchorTag(f.anchor.clone())),
        TTL_EXTEND_LEDGERS
    );
}

#[test]
fn add_publisher_extends_publisher_flag() {
    let env = Env::default();
    let f = setup(&env);

    f.client.add_publisher(&f.admin, &f.publisher);

    assert_eq!(
        f.persistent_ttl(&DataKey::Publisher(f.publisher.clone())),
        TTL_EXTEND_LEDGERS
    );
}

#[test]
fn publisher_write_re_extends_flag() {
    let env = Env::default();
    let f = setup(&env);
    let hash = String::from_str(&env, "h");
    f.client.add_publisher(&f.admin, &f.publisher);
    f.client.register_anchor(&f.admin, &f.anchor);
    let flag = DataKey::Publisher(f.publisher.clone());

    f.nearly_expire();
    assert_eq!(f.persistent_ttl(&flag), 10);

    f.client
        .submit_outcome(&f.publisher, &f.anchor, &f.corridor, &hash, &30u64, &true);

    assert_eq!(f.persistent_ttl(&flag), TTL_EXTEND_LEDGERS);
}

#[test]
fn publisher_write_re_extends_anchor_tag() {
    let env = Env::default();
    let f = setup(&env);
    let hash = String::from_str(&env, "h");
    f.client.add_publisher(&f.admin, &f.publisher);
    f.client.register_anchor(&f.admin, &f.anchor);
    let tag = DataKey::AnchorTag(f.anchor.clone());

    f.nearly_expire();
    // Re-extend the flag first, so the write is not rejected for a lapsed publisher.
    f.client.bump();
    assert_eq!(f.persistent_ttl(&tag), 10);

    f.client
        .submit_outcome(&f.publisher, &f.anchor, &f.corridor, &hash, &30u64, &true);

    assert_eq!(f.persistent_ttl(&tag), TTL_EXTEND_LEDGERS);
}

#[test]
fn publisher_write_re_extends_corridor_tag_and_scope() {
    let env = Env::default();
    let f = setup(&env);
    f.client.add_publisher(&f.admin, &f.publisher);
    f.client.register_corridor(&f.admin, &f.corridor);
    f.client
        .set_publisher_scope(&f.admin, &f.publisher, &vec![&env, f.corridor.clone()]);
    let tag = DataKey::CorridorTag(f.corridor.clone());
    let scope = DataKey::PublisherScope(f.publisher.clone());

    f.nearly_expire();
    assert_eq!(f.persistent_ttl(&tag), 10);
    assert_eq!(f.persistent_ttl(&scope), 10);

    f.client
        .publish_corridor_rate(&f.publisher, &f.corridor, &1000i128, &7u32);

    assert_eq!(f.persistent_ttl(&tag), TTL_EXTEND_LEDGERS);
    assert_eq!(f.persistent_ttl(&scope), TTL_EXTEND_LEDGERS);
}

#[test]
fn a_rejected_write_changes_nothing_including_ttls() {
    let env = Env::default();
    let f = setup(&env);
    let hash = String::from_str(&env, "h");
    f.client.add_publisher(&f.admin, &f.publisher);
    // The anchor is deliberately not registered, so the write is refused.
    let flag = DataKey::Publisher(f.publisher.clone());

    f.nearly_expire();
    let res =
        f.client
            .try_submit_outcome(&f.publisher, &f.anchor, &f.corridor, &hash, &30u64, &true);

    // A refused call is rolled back whole: nothing is written, and the
    // extension the publisher gate made on the way in is rolled back with it.
    assert!(res.is_err());
    assert_eq!(f.client.recent_outcomes(&f.anchor, &10u32).len(), 0);
    assert_eq!(f.persistent_ttl(&flag), 10);
}
