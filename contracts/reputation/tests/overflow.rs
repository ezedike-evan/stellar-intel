//! The checked math that protects a corridor from being trapped is exercised
//! (#1395, audit P3 "missing overflow test").
//!
//! The caps make these overflows unreachable through normal calls, so each test
//! pre-seeds storage inside the contract, then makes the one call that would
//! overflow, and checks that it is refused cleanly and changes nothing.

use reputation::storage::DataKey;
use reputation::volume_savings::VolumeSavings;
use reputation::{Error, ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

struct Fixture<'a> {
    env: &'a Env,
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
        env,
        client,
        publisher,
        anchor,
        corridor,
    }
}

impl Fixture<'_> {
    fn aggregate_key(&self) -> DataKey {
        DataKey::CorridorAggregate(self.anchor.clone(), self.corridor.clone())
    }

    fn seed_aggregate(&self, value: (u32, u32, u64)) {
        let key = self.aggregate_key();
        self.env.as_contract(&self.client.address, || {
            self.env.storage().persistent().set(&key, &value);
        });
    }

    fn stored_aggregate(&self) -> (u32, u32, u64) {
        let key = self.aggregate_key();
        self.env.as_contract(&self.client.address, || {
            self.env.storage().persistent().get(&key).unwrap()
        })
    }

    fn submit(&self, settle_seconds: u64, success: bool) -> Result<(), Error> {
        let hash = String::from_str(self.env, "h");
        match self.client.try_submit_outcome(
            &self.publisher,
            &self.anchor,
            &self.corridor,
            &hash,
            &settle_seconds,
            &success,
        ) {
            Ok(_) => Ok(()),
            Err(Ok(e)) => Err(e),
            Err(Err(e)) => panic!("host error, not a contract error: {e:?}"),
        }
    }

    fn seed_volume(&self, record: VolumeSavings) {
        let key = DataKey::VolumeSavings(self.corridor.clone());
        self.env.as_contract(&self.client.address, || {
            self.env.storage().persistent().set(&key, &record);
        });
    }

    fn stored_volume(&self) -> VolumeSavings {
        let key = DataKey::VolumeSavings(self.corridor.clone());
        self.env.as_contract(&self.client.address, || {
            self.env.storage().persistent().get(&key).unwrap()
        })
    }

    fn volume_record(&self, volume: i128, savings: i128, count: u32) -> VolumeSavings {
        VolumeSavings {
            volume_usdc: volume,
            savings_usdc: savings,
            settlement_count: count,
            updated_at: 0,
            publisher: self.publisher.clone(),
        }
    }

    fn add_volume(&self, volume_delta: i128, savings_delta: i128) -> Result<(), Error> {
        match self.client.try_add_volume_savings(
            &self.publisher,
            &self.corridor,
            &volume_delta,
            &savings_delta,
        ) {
            Ok(_) => Ok(()),
            Err(Ok(e)) => Err(e),
            Err(Err(e)) => panic!("host error, not a contract error: {e:?}"),
        }
    }
}

#[test]
fn aggregate_total_overflow() {
    let env = Env::default();
    let f = setup(&env);
    f.seed_aggregate((u32::MAX, 0, 0));

    assert_eq!(f.submit(1, false), Err(Error::ArithmeticOverflow));

    assert_eq!(f.stored_aggregate(), (u32::MAX, 0, 0));
    // The refused call also left no outcome behind.
    assert_eq!(f.client.recent_outcomes(&f.anchor, &10u32).len(), 0);
}

#[test]
fn aggregate_successes_overflow() {
    let env = Env::default();
    let f = setup(&env);
    f.seed_aggregate((u32::MAX - 1, u32::MAX, 0));

    assert_eq!(f.submit(1, true), Err(Error::ArithmeticOverflow));

    assert_eq!(f.stored_aggregate(), (u32::MAX - 1, u32::MAX, 0));
}

#[test]
fn aggregate_settle_sum_overflow() {
    let env = Env::default();
    let f = setup(&env);
    f.seed_aggregate((1, 1, u64::MAX - 10));

    assert_eq!(f.submit(11, true), Err(Error::ArithmeticOverflow));

    assert_eq!(f.stored_aggregate(), (1, 1, u64::MAX - 10));
}

#[test]
fn aggregate_accepts_the_last_value_before_overflow() {
    let env = Env::default();
    let f = setup(&env);
    f.seed_aggregate((u32::MAX - 1, 0, u64::MAX - 10));

    // Exactly at the edge: one more outcome and 10 seconds fit.
    assert_eq!(f.submit(10, false), Ok(()));
    assert_eq!(f.stored_aggregate(), (u32::MAX, 0, u64::MAX));
}

#[test]
fn volume_overflow() {
    let env = Env::default();
    let f = setup(&env);
    f.seed_volume(f.volume_record(i128::MAX - 1, 0, 1));

    assert_eq!(f.add_volume(2, 0), Err(Error::ArithmeticOverflow));

    assert_eq!(f.stored_volume().volume_usdc, i128::MAX - 1);
}

#[test]
fn savings_overflow() {
    let env = Env::default();
    let f = setup(&env);
    f.seed_volume(f.volume_record(0, i128::MAX - 1, 1));

    assert_eq!(f.add_volume(0, 2), Err(Error::ArithmeticOverflow));

    assert_eq!(f.stored_volume().savings_usdc, i128::MAX - 1);
}

#[test]
fn settlement_count_overflow() {
    let env = Env::default();
    let f = setup(&env);
    f.seed_volume(f.volume_record(0, 0, u32::MAX));

    assert_eq!(f.add_volume(1, 1), Err(Error::ArithmeticOverflow));

    let stored = f.stored_volume();
    assert_eq!(stored.settlement_count, u32::MAX);
    assert_eq!(stored.volume_usdc, 0);
    assert_eq!(stored.savings_usdc, 0);
}
