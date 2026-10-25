//! Storage entries that gate writes stay alive while they are in use (#1390).
//!
//! A flag that is written once and never extended archives after ~31 days, and
//! then every write that reads it stalls until someone restores the entry
//! (audit P2, contract TTL).

use reputation::storage::{DataKey, TTL_EXTEND_LEDGERS};
use reputation::{ReputationContract, ReputationContractClient};
use soroban_sdk::{
    testutils::{
        storage::{Instance as _, Persistent as _},
        Address as _, Ledger,
    },
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

    fn instance_ttl(&self) -> u32 {
        self.env.as_contract(&self.client.address, || {
            self.env.storage().instance().get_ttl()
        })
    }

    /// Registers everything a publisher write needs, then lets the instance run
    /// down to 10 ledgers from archival.
    fn ready_to_write(&self) {
        self.client.add_publisher(&self.admin, &self.publisher);
        self.client.register_anchor(&self.admin, &self.anchor);
        self.client.register_corridor(&self.admin, &self.corridor);
        self.nearly_expire();
        assert_eq!(self.instance_ttl(), 10);
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

// ── Instance TTL (#1391) ─────────────────────────────────────────────────────
//
// A contract that only receives publisher writes must not let its instance
// (admin, anchor list, publisher list, upgrade admin) run down to archival.

#[test]
fn publisher_write_extends_instance() {
    let env = Env::default();
    let f = setup(&env);
    let hash = String::from_str(&env, "h");
    f.ready_to_write();

    f.client
        .submit_outcome(&f.publisher, &f.anchor, &f.corridor, &hash, &30u64, &true);

    assert_eq!(f.instance_ttl(), TTL_EXTEND_LEDGERS);
}

#[test]
fn set_corridor_metrics_extends_instance() {
    let env = Env::default();
    let f = setup(&env);
    f.ready_to_write();

    f.client.set_corridor_metrics(
        &f.publisher,
        &f.anchor,
        &f.corridor,
        &9000i128,
        &50i128,
        &60u64,
        &5u32,
    );

    assert_eq!(f.instance_ttl(), TTL_EXTEND_LEDGERS);
}

#[test]
fn publish_corridor_rate_extends_instance() {
    let env = Env::default();
    let f = setup(&env);
    f.ready_to_write();

    f.client
        .publish_corridor_rate(&f.publisher, &f.corridor, &1000i128, &7u32);

    assert_eq!(f.instance_ttl(), TTL_EXTEND_LEDGERS);
}

#[test]
fn add_volume_savings_extends_instance() {
    let env = Env::default();
    let f = setup(&env);
    f.ready_to_write();

    f.client
        .add_volume_savings(&f.publisher, &f.corridor, &1_000i128, &10i128);

    assert_eq!(f.instance_ttl(), TTL_EXTEND_LEDGERS);
}

#[test]
fn propose_admin_extends_instance() {
    let env = Env::default();
    let f = setup(&env);
    f.ready_to_write();

    f.client.propose_admin(&f.admin, &Address::generate(&env));

    assert_eq!(f.instance_ttl(), TTL_EXTEND_LEDGERS);
}

#[test]
fn the_other_mutating_entrypoints_extend_the_instance_too() {
    let env = Env::default();
    let f = setup(&env);
    let candidate = Address::generate(&env);
    f.ready_to_write();

    // Each step starts from a nearly-expired instance, and must end renewed.
    let renewed = |f: &Fixture<'_>| {
        assert_eq!(f.instance_ttl(), TTL_EXTEND_LEDGERS);
        f.env
            .ledger()
            .with_mut(|l| l.sequence_number += TTL_EXTEND_LEDGERS - 10);
        assert_eq!(f.instance_ttl(), 10);
    };

    f.client.propose_admin(&f.admin, &candidate);
    renewed(&f);
    f.client.cancel_admin_proposal(&f.admin);
    renewed(&f);
    f.client.propose_admin(&f.admin, &candidate);
    renewed(&f);
    f.client.accept_admin(&candidate);
    renewed(&f);
    // The upgrade admin is a separate role: it is still the original admin.
    f.client.propose_upgrade_admin(&f.admin, &candidate);
    renewed(&f);
    f.client.cancel_upgrade_proposal(&f.admin);
    renewed(&f);
    f.client
        .reset_corridor_aggregate(&candidate, &f.anchor, &f.corridor);
    renewed(&f);
    f.client.reset_volume_savings(&candidate, &f.corridor);
    renewed(&f);
    f.client
        .migrate_corridor_v2(&candidate, &f.anchor, &f.corridor);
    renewed(&f);
    f.client.migrate_all_v2(&candidate);
    assert_eq!(f.instance_ttl(), TTL_EXTEND_LEDGERS);
}
