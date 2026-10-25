//! A publisher can be limited to the corridors it serves (#1386, audit M-5).

use reputation::{Error, ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, vec, Address, Env, String};

struct Fixture<'a> {
    env: &'a Env,
    client: ReputationContractClient<'a>,
    admin: Address,
    publisher: Address,
    anchor: String,
    ngn: String,
    kes: String,
}

fn setup(env: &Env) -> Fixture<'_> {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let contract_id = env.register(ReputationContract, (admin.clone(), admin.clone()));
    let client = ReputationContractClient::new(env, &contract_id);
    let publisher = Address::generate(env);
    client.add_publisher(&admin, &publisher);

    let anchor = String::from_str(env, "cowrie");
    let ngn = String::from_str(env, "usdc-ngn");
    let kes = String::from_str(env, "usdc-kes");
    client.register_anchor(&admin, &anchor);
    client.register_corridor(&admin, &ngn);
    client.register_corridor(&admin, &kes);

    Fixture {
        env,
        client,
        admin,
        publisher,
        anchor,
        ngn,
        kes,
    }
}

impl Fixture<'_> {
    fn scope_to_ngn(&self) {
        self.client.set_publisher_scope(
            &self.admin,
            &self.publisher,
            &vec![self.env, self.ngn.clone()],
        );
    }
}

#[test]
fn unscoped_publisher_writes_any_corridor() {
    let env = Env::default();
    let f = setup(&env);
    let hash = String::from_str(&env, "h");

    f.client
        .publish_corridor_rate(&f.publisher, &f.ngn, &1000i128, &7u32);
    f.client
        .publish_corridor_rate(&f.publisher, &f.kes, &100i128, &7u32);
    f.client
        .submit_outcome(&f.publisher, &f.anchor, &f.kes, &hash, &30u64, &true);

    assert_eq!(f.client.publisher_scope(&f.publisher), None);
}

#[test]
fn scoped_publisher_writes_its_corridor() {
    let env = Env::default();
    let f = setup(&env);
    let hash = String::from_str(&env, "h");
    f.scope_to_ngn();

    f.client
        .publish_corridor_rate(&f.publisher, &f.ngn, &1000i128, &7u32);
    f.client
        .add_volume_savings(&f.publisher, &f.ngn, &1_000i128, &10i128);
    f.client
        .submit_outcome(&f.publisher, &f.anchor, &f.ngn, &hash, &30u64, &true);
    f.client.set_corridor_metrics(
        &f.publisher,
        &f.anchor,
        &f.ngn,
        &9000i128,
        &50i128,
        &60u64,
        &5u32,
    );

    assert_eq!(
        f.client.publisher_scope(&f.publisher),
        Some(vec![&env, f.ngn.clone()])
    );
}

#[test]
fn scoped_publisher_rejected_elsewhere_for_each_write_entrypoint() {
    let env = Env::default();
    let f = setup(&env);
    let hash = String::from_str(&env, "h");
    f.scope_to_ngn();
    let out_of_scope = Err(Ok(Error::PublisherOutOfScope));

    assert_eq!(
        f.client
            .try_submit_outcome(&f.publisher, &f.anchor, &f.kes, &hash, &30u64, &true),
        out_of_scope
    );
    assert_eq!(
        f.client.try_set_corridor_metrics(
            &f.publisher,
            &f.anchor,
            &f.kes,
            &9000i128,
            &50i128,
            &60u64,
            &5u32,
        ),
        out_of_scope
    );
    assert_eq!(
        f.client
            .try_publish_corridor_rate(&f.publisher, &f.kes, &100i128, &7u32),
        out_of_scope
    );
    assert_eq!(
        f.client
            .try_add_volume_savings(&f.publisher, &f.kes, &1_000i128, &10i128),
        out_of_scope
    );

    // Nothing was written for the corridor it is not scoped to.
    assert_eq!(f.client.get_corridor_rate(&f.kes), None);
    assert_eq!(f.client.get_volume_savings(&f.kes), None);
    assert_eq!(
        f.client.get_corridor_aggregate(&f.anchor, &f.kes),
        (0, 0, 0)
    );
}

#[test]
fn clear_scope_restores_full_access() {
    let env = Env::default();
    let f = setup(&env);
    f.scope_to_ngn();
    assert!(f
        .client
        .try_publish_corridor_rate(&f.publisher, &f.kes, &100i128, &7u32)
        .is_err());

    f.client.clear_publisher_scope(&f.admin, &f.publisher);

    f.client
        .publish_corridor_rate(&f.publisher, &f.kes, &100i128, &7u32);
    assert_eq!(f.client.publisher_scope(&f.publisher), None);
}

#[test]
fn non_admin_cannot_set_scope() {
    let env = Env::default();
    let f = setup(&env);

    let res =
        f.client
            .try_set_publisher_scope(&f.publisher, &f.publisher, &vec![&env, f.ngn.clone()]);
    assert_eq!(res, Err(Ok(Error::Unauthorized)));
    assert_eq!(f.client.publisher_scope(&f.publisher), None);

    let res = f
        .client
        .try_clear_publisher_scope(&f.publisher, &f.publisher);
    assert_eq!(res, Err(Ok(Error::Unauthorized)));
}

#[test]
fn set_scope_for_unknown_publisher_fails() {
    let env = Env::default();
    let f = setup(&env);
    let stranger = Address::generate(&env);

    let res = f
        .client
        .try_set_publisher_scope(&f.admin, &stranger, &vec![&env, f.ngn.clone()]);

    assert_eq!(res, Err(Ok(Error::PublisherNotFound)));
    assert_eq!(f.client.publisher_scope(&stranger), None);
}

#[test]
fn revoke_clears_scope() {
    let env = Env::default();
    let f = setup(&env);
    f.scope_to_ngn();

    f.client.revoke_publisher(&f.admin, &f.publisher);
    assert_eq!(f.client.publisher_scope(&f.publisher), None);

    // A later re-add starts unscoped rather than inheriting the old scope.
    f.client.add_publisher(&f.admin, &f.publisher);
    f.client
        .publish_corridor_rate(&f.publisher, &f.kes, &100i128, &7u32);
}
