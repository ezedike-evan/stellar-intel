use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, Env, String, Vec};
use stellar_intel_reputation::ReputationReader;

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
