use soroban_sdk::{
    contract, contractimpl, contracttype, testutils::Address as _, Address, Env, String, Vec,
};
use stellar_intel_reputation::ReputationReader;

/// Storage keys for the extra mock entrypoints below (`list_anchors`,
/// `get_corridor_aggregate`, `get_score_for_corridor`). Mirrors the
/// `DataKey` pattern the real `contracts/reputation` contract uses for
/// compound keys (see `contracts/reputation/src/storage.rs`).
#[contracttype]
#[derive(Clone)]
enum MockKey {
    Anchors,
    Aggregate(String, String),
    Score(String, String),
}

#[contract]
pub struct MockReputationContract;

#[contractimpl]
impl MockReputationContract {
    pub fn submit_outcome(
        env: Env,
        _admin: Address,
        anchor_id: String,
        outcome_hash: String,
        settle_seconds: u64,
        success: bool,
    ) {
        let mut outcomes: Vec<(String, u64, bool)> = env
            .storage()
            .persistent()
            .get(&anchor_id)
            .unwrap_or_else(|| Vec::new(&env));
        outcomes.push_back((outcome_hash, settle_seconds, success));
        env.storage().persistent().set(&anchor_id, &outcomes);
    }

    pub fn recent_outcomes(env: Env, anchor_id: String, n: u32) -> Vec<(String, u64, bool)> {
        let outcomes: Vec<(String, u64, bool)> = env
            .storage()
            .persistent()
            .get(&anchor_id)
            .unwrap_or_else(|| Vec::new(&env));

        let len = outcomes.len();
        if len == 0 || n == 0 {
            return Vec::new(&env);
        }

        let take = core::cmp::min(n, len);
        let start = len - take;
        let mut recent = Vec::new(&env);
        for i in (start..len).rev() {
            recent.push_back(outcomes.get(i).unwrap());
        }

        recent
    }

    pub fn list_anchors(env: Env) -> Vec<String> {
        env.storage()
            .persistent()
            .get(&MockKey::Anchors)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn register_anchor(env: Env, anchor_id: String) {
        let mut anchors: Vec<String> = env
            .storage()
            .persistent()
            .get(&MockKey::Anchors)
            .unwrap_or_else(|| Vec::new(&env));
        anchors.push_back(anchor_id);
        env.storage().persistent().set(&MockKey::Anchors, &anchors);
    }

    pub fn set_corridor_aggregate(
        env: Env,
        anchor_id: String,
        corridor: String,
        total: u32,
        successes: u32,
        settle_seconds_sum: u64,
    ) {
        let key = MockKey::Aggregate(anchor_id, corridor);
        env.storage()
            .persistent()
            .set(&key, &(total, successes, settle_seconds_sum));
    }

    pub fn get_corridor_aggregate(env: Env, anchor_id: String, corridor: String) -> (u32, u32, u64) {
        let key = MockKey::Aggregate(anchor_id, corridor);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or((0u32, 0u32, 0u64))
    }

    pub fn set_corridor_score(
        env: Env,
        anchor_id: String,
        corridor: String,
        composite_bps: i128,
        fill_rate_bps: i128,
        settle_seconds_p50: u64,
        n: u32,
    ) {
        let key = MockKey::Score(anchor_id, corridor);
        env.storage()
            .persistent()
            .set(&key, &(composite_bps, fill_rate_bps, settle_seconds_p50, n));
    }

    pub fn get_score_for_corridor(
        env: Env,
        anchor_id: String,
        corridor: String,
    ) -> (i128, i128, u64, u32) {
        let key = MockKey::Score(anchor_id, corridor);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or((0i128, 0i128, 0u64, 0u32))
    }
}

fn setup(env: &Env) -> (Address, Address) {
    let contract_id = env.register(MockReputationContract, ());
    let admin = Address::generate(env);
    (contract_id, admin)
}

#[test]
fn reads_recent_outcomes_in_reverse_order() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, admin) = setup(&env);
    let reader = ReputationReader::new(&env, contract_id.clone());
    let anchor = String::from_str(&env, "moneygram");

    let client = MockReputationContractClient::new(&env, &contract_id);
    client.submit_outcome(
        &admin,
        &anchor,
        &String::from_str(&env, "hash-1"),
        &11,
        &true,
    );
    client.submit_outcome(
        &admin,
        &anchor,
        &String::from_str(&env, "hash-2"),
        &18,
        &false,
    );

    let recent = reader.recent_outcomes(anchor.clone(), 2);
    assert_eq!(recent.len(), 2);
    assert_eq!(recent.get(0).unwrap().0, String::from_str(&env, "hash-2"));
    assert_eq!(recent.get(1).unwrap().0, String::from_str(&env, "hash-1"));
}

#[test]
fn aggregate_score_uses_success_rate() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, admin) = setup(&env);
    let reader = ReputationReader::new(&env, contract_id.clone());
    let anchor = String::from_str(&env, "cowrie");

    let client = MockReputationContractClient::new(&env, &contract_id);
    client.submit_outcome(
        &admin,
        &anchor,
        &String::from_str(&env, "hash-1"),
        &10,
        &true,
    );
    client.submit_outcome(
        &admin,
        &anchor,
        &String::from_str(&env, "hash-2"),
        &12,
        &false,
    );
    client.submit_outcome(
        &admin,
        &anchor,
        &String::from_str(&env, "hash-3"),
        &14,
        &true,
    );

    let aggregate = reader.read_aggregate(anchor, 10);
    assert_eq!(aggregate.sample_size, 3);
    assert_eq!(aggregate.successful, 2);
    assert_eq!(aggregate.failed, 1);
    assert_eq!(aggregate.score_bps, 6_666);
}

#[test]
fn empty_window_returns_zero_score() {
    let env = Env::default();
    let (contract_id, _) = setup(&env);
    let reader = ReputationReader::new(&env, contract_id);
    let anchor = String::from_str(&env, "unused");

    let aggregate = reader.read_aggregate(anchor, 5);
    assert_eq!(aggregate.sample_size, 0);
    assert_eq!(aggregate.score_bps, 0);
}

#[test]
fn lists_registered_anchors() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, _) = setup(&env);
    let reader = ReputationReader::new(&env, contract_id.clone());

    let client = MockReputationContractClient::new(&env, &contract_id);
    client.register_anchor(&String::from_str(&env, "cowrie"));
    client.register_anchor(&String::from_str(&env, "moneygram"));

    let anchors = reader.list_anchors();
    assert_eq!(anchors.len(), 2);
    assert_eq!(anchors.get(0).unwrap(), String::from_str(&env, "cowrie"));
    assert_eq!(
        anchors.get(1).unwrap(),
        String::from_str(&env, "moneygram")
    );
}

#[test]
fn reads_corridor_aggregate() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, _) = setup(&env);
    let reader = ReputationReader::new(&env, contract_id.clone());
    let anchor = String::from_str(&env, "cowrie");
    let corridor = String::from_str(&env, "usdc-ngn");

    let client = MockReputationContractClient::new(&env, &contract_id);
    client.set_corridor_aggregate(&anchor, &corridor, &10, &8, &120);

    let aggregate = reader.corridor_aggregate(anchor, corridor);
    assert_eq!(aggregate.total, 10);
    assert_eq!(aggregate.successes, 8);
    assert_eq!(aggregate.settle_seconds_sum, 120);
    assert_eq!(aggregate.success_rate_bps(), 8_000);
}

#[test]
fn corridor_aggregate_defaults_to_zero_for_unknown_pair() {
    let env = Env::default();
    let (contract_id, _) = setup(&env);
    let reader = ReputationReader::new(&env, contract_id);

    let aggregate = reader.corridor_aggregate(
        String::from_str(&env, "unknown"),
        String::from_str(&env, "usdc-xof"),
    );
    assert_eq!(aggregate.total, 0);
    assert_eq!(aggregate.success_rate_bps(), 0);
}

#[test]
fn reads_corridor_score() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, _) = setup(&env);
    let reader = ReputationReader::new(&env, contract_id.clone());
    let anchor = String::from_str(&env, "moneygram");
    let corridor = String::from_str(&env, "usdc-kes");

    let client = MockReputationContractClient::new(&env, &contract_id);
    client.set_corridor_score(&anchor, &corridor, &9_200, &9_800, &45, &50);

    let score = reader.corridor_score(anchor, corridor);
    assert_eq!(score.composite_bps, 9_200);
    assert_eq!(score.fill_rate_bps, 9_800);
    assert_eq!(score.settle_seconds_p50, 45);
    assert_eq!(score.sample_size, 50);
}
