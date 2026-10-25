use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger},
    Address, Env, String, Vec,
};
use stellar_intel_reputation::{
    CorridorAggregate, CorridorRate, ProbeSignals, ReputationReader, VolumeSavings,
};

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
    ScoreV2(String, String),
    Probe(String),
    Rate(String),
    Volume(String),
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

    pub fn get_corridor_aggregate(
        env: Env,
        anchor_id: String,
        corridor: String,
    ) -> (u32, u32, u64) {
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

    /// `(composite_bps, fill_rate_bps, slippage_bps, settle_seconds_p50, n)`,
    /// as one tuple: separate arguments would be more than clippy allows.
    pub fn set_corridor_score_v2(
        env: Env,
        anchor_id: String,
        corridor: String,
        score: (i128, i128, i128, u64, u32),
    ) {
        let key = MockKey::ScoreV2(anchor_id, corridor);
        env.storage().persistent().set(&key, &score);
    }

    pub fn get_score_for_corridor_v2(
        env: Env,
        anchor_id: String,
        corridor: String,
    ) -> (i128, i128, i128, u64, u32) {
        let key = MockKey::ScoreV2(anchor_id, corridor);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or((0i128, 0i128, 0i128, 0u64, 0u32))
    }

    pub fn publish_probe_signals(
        env: Env,
        publisher: Address,
        anchor_id: String,
        uptime_bps: u32,
        p50_latency_ms: u32,
        p95_latency_ms: u32,
        drift_flag_count: u32,
    ) {
        let value = ProbeSignals {
            uptime_bps,
            p50_latency_ms,
            p95_latency_ms,
            drift_flag_count,
            updated_at: env.ledger().timestamp(),
            publisher,
        };
        env.storage()
            .persistent()
            .set(&MockKey::Probe(anchor_id), &value);
    }

    pub fn get_probe_signals(env: Env, anchor_id: String) -> Option<ProbeSignals> {
        env.storage().persistent().get(&MockKey::Probe(anchor_id))
    }

    pub fn publish_corridor_rate(
        env: Env,
        publisher: Address,
        corridor: String,
        rate: i128,
        decimals: u32,
    ) {
        let value = CorridorRate {
            rate,
            decimals,
            updated_at: env.ledger().timestamp(),
            publisher,
        };
        env.storage()
            .persistent()
            .set(&MockKey::Rate(corridor), &value);
    }

    pub fn get_corridor_rate(env: Env, corridor: String) -> Option<CorridorRate> {
        env.storage().persistent().get(&MockKey::Rate(corridor))
    }

    pub fn get_corridor_rate_fresh(
        env: Env,
        corridor: String,
        max_age_seconds: u64,
    ) -> Option<CorridorRate> {
        let rate: CorridorRate = env.storage().persistent().get(&MockKey::Rate(corridor))?;
        let age = env.ledger().timestamp().saturating_sub(rate.updated_at);
        if age <= max_age_seconds {
            Some(rate)
        } else {
            None
        }
    }

    pub fn add_volume_savings(
        env: Env,
        publisher: Address,
        corridor: String,
        volume_delta: i128,
        savings_delta: i128,
    ) {
        let key = MockKey::Volume(corridor);
        let current: Option<VolumeSavings> = env.storage().persistent().get(&key);
        let value = match current {
            Some(v) => VolumeSavings {
                volume_usdc: v.volume_usdc + volume_delta,
                savings_usdc: v.savings_usdc + savings_delta,
                settlement_count: v.settlement_count + 1,
                updated_at: env.ledger().timestamp(),
                publisher,
            },
            None => VolumeSavings {
                volume_usdc: volume_delta,
                savings_usdc: savings_delta,
                settlement_count: 1,
                updated_at: env.ledger().timestamp(),
                publisher,
            },
        };
        env.storage().persistent().set(&key, &value);
    }

    pub fn get_volume_savings(env: Env, corridor: String) -> Option<VolumeSavings> {
        env.storage().persistent().get(&MockKey::Volume(corridor))
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
    assert_eq!(anchors.get(1).unwrap(), String::from_str(&env, "moneygram"));
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

// ─── Corridor rate + volume/savings reads (#965) ──────────────────────────────
//
// ReputationReader exposed four of the contract's read entrypoints. A consumer
// could not read the corridor rate oracle or the volume/savings aggregate at
// all — which is most of what makes those oracles useful to a third party.

#[test]
fn reads_a_published_corridor_rate() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, publisher) = setup(&env);
    let client = MockReputationContractClient::new(&env, &contract_id);
    let reader = ReputationReader::new(&env, contract_id.clone());

    let corridor = String::from_str(&env, "usdc-ngn");
    client.publish_corridor_rate(&publisher, &corridor, &15_800_000_000i128, &7u32);

    let rate = reader.corridor_rate(corridor).expect("rate should be set");

    assert_eq!(rate.rate, 15_800_000_000i128);
    assert_eq!(rate.decimals, 7);
    assert_eq!(rate.publisher, publisher);
}

#[test]
fn unpublished_corridor_rate_is_none_not_zero() {
    let env = Env::default();
    let (contract_id, _) = setup(&env);
    let reader = ReputationReader::new(&env, contract_id);

    // The distinction a consumer contract depends on: "never published" is not
    // "the rate is zero". A zeroed struct would price an off-ramp at nothing.
    assert!(reader
        .corridor_rate(String::from_str(&env, "usdc-kes"))
        .is_none());
}

#[test]
fn reads_cumulative_volume_savings() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, publisher) = setup(&env);
    let client = MockReputationContractClient::new(&env, &contract_id);
    let reader = ReputationReader::new(&env, contract_id.clone());

    let corridor = String::from_str(&env, "usdc-ngn");
    client.add_volume_savings(&publisher, &corridor, &100_000_000i128, &2_500_000i128);
    client.add_volume_savings(&publisher, &corridor, &50_000_000i128, &1_000_000i128);

    let totals = reader
        .volume_savings(corridor)
        .expect("totals should be set");

    // Cumulative, so the second call adds rather than replaces.
    assert_eq!(totals.volume_usdc, 150_000_000i128);
    assert_eq!(totals.savings_usdc, 3_500_000i128);
    assert_eq!(totals.settlement_count, 2);
}

#[test]
fn unrecorded_volume_savings_is_none() {
    let env = Env::default();
    let (contract_id, _) = setup(&env);
    let reader = ReputationReader::new(&env, contract_id);

    assert!(reader
        .volume_savings(String::from_str(&env, "usdc-brl"))
        .is_none());
}

// ─── v2 score, probe signals and the exact success rate (#1402) ───────────────

#[test]
fn success_rate_is_exact_above_saturation() {
    // successes * 10_000 is 5_000_000_000 here, past u32::MAX: the old
    // saturating multiply clamped it to 4_294_967_295 and reported 4294.
    let aggregate = CorridorAggregate {
        total: 1_000_000,
        successes: 500_000,
        settle_seconds_sum: 0,
    };
    assert_eq!(aggregate.success_rate_bps(), 5_000);

    let all = CorridorAggregate {
        total: u32::MAX,
        successes: u32::MAX,
        settle_seconds_sum: 0,
    };
    assert_eq!(all.success_rate_bps(), 10_000);

    let none = CorridorAggregate {
        total: 0,
        successes: 0,
        settle_seconds_sum: 0,
    };
    assert_eq!(none.success_rate_bps(), 0);
}

#[test]
fn reads_corridor_score_v2() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, _) = setup(&env);
    let reader = ReputationReader::new(&env, contract_id.clone());
    let anchor = String::from_str(&env, "cowrie");
    let corridor = String::from_str(&env, "usdc-ngn");

    let client = MockReputationContractClient::new(&env, &contract_id);
    client.set_corridor_score_v2(&anchor, &corridor, &(9_000, 9_700, 110, 42, 1_240));

    let score = reader.corridor_score_v2(anchor, corridor);
    assert_eq!(score.composite_bps, 9_000);
    assert_eq!(score.fill_rate_bps, 9_700);
    assert_eq!(score.slippage_bps, 110);
    assert_eq!(score.settle_seconds_p50, 42);
    assert_eq!(score.sample_size, 1_240);
}

#[test]
fn unpublished_corridor_score_v2_is_all_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, _) = setup(&env);
    let reader = ReputationReader::new(&env, contract_id);

    let score = reader.corridor_score_v2(
        String::from_str(&env, "nobody"),
        String::from_str(&env, "usdc-ngn"),
    );
    assert_eq!(score.sample_size, 0);
    assert_eq!(score.composite_bps, 0);
}

#[test]
fn reads_probe_signals() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, publisher) = setup(&env);
    let reader = ReputationReader::new(&env, contract_id.clone());
    let anchor = String::from_str(&env, "cowrie");

    let client = MockReputationContractClient::new(&env, &contract_id);
    client.publish_probe_signals(&publisher, &anchor, &9_800, &120, &450, &2);

    let signals = reader.probe_signals(anchor).unwrap();
    assert_eq!(signals.uptime_bps, 9_800);
    assert_eq!(signals.p50_latency_ms, 120);
    assert_eq!(signals.p95_latency_ms, 450);
    assert_eq!(signals.drift_flag_count, 2);
    assert_eq!(signals.publisher, publisher);
    assert_eq!(signals.updated_at, env.ledger().timestamp());
}

#[test]
fn unpublished_probe_signals_is_none() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, _) = setup(&env);
    let reader = ReputationReader::new(&env, contract_id);

    assert_eq!(
        reader.probe_signals(String::from_str(&env, "never-probed")),
        None
    );
}

#[test]
fn a_probed_but_unreachable_anchor_is_some_with_zero_latency() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, publisher) = setup(&env);
    let reader = ReputationReader::new(&env, contract_id.clone());
    let anchor = String::from_str(&env, "dark");

    let client = MockReputationContractClient::new(&env, &contract_id);
    client.publish_probe_signals(&publisher, &anchor, &0, &0, &0, &3);

    let signals = reader.probe_signals(anchor).unwrap();
    assert_eq!(signals.uptime_bps, 0);
    assert_eq!((signals.p50_latency_ms, signals.p95_latency_ms), (0, 0));
}

// ─── Freshness-checked rate read (#1403) ──────────────────────────────────────

fn publish_rate(env: &Env, contract_id: &Address, publisher: &Address, corridor: &String) {
    let client = MockReputationContractClient::new(env, contract_id);
    client.publish_corridor_rate(publisher, corridor, &16_500_000_000, &7);
}

#[test]
fn fresh_rate_within_window() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, publisher) = setup(&env);
    let reader = ReputationReader::new(&env, contract_id.clone());
    let corridor = String::from_str(&env, "usdc-ngn");
    publish_rate(&env, &contract_id, &publisher, &corridor);

    env.ledger().with_mut(|l| l.timestamp += 60);

    let rate = reader.corridor_rate_fresh(corridor, 120).unwrap();
    assert_eq!(rate.rate, 16_500_000_000);
    assert_eq!(rate.decimals, 7);
}

#[test]
fn stale_rate_is_none() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, publisher) = setup(&env);
    let reader = ReputationReader::new(&env, contract_id.clone());
    let corridor = String::from_str(&env, "usdc-ngn");
    publish_rate(&env, &contract_id, &publisher, &corridor);

    env.ledger().with_mut(|l| l.timestamp += 121);

    assert_eq!(reader.corridor_rate_fresh(corridor.clone(), 120), None);
    // The plain read still returns it, which is the whole reason to prefer the fresh one.
    assert!(reader.corridor_rate(corridor).is_some());
}

#[test]
fn fresh_rate_unknown_corridor_is_none() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, _) = setup(&env);
    let reader = ReputationReader::new(&env, contract_id);

    assert_eq!(
        reader.corridor_rate_fresh(String::from_str(&env, "usdc-xyz"), u64::MAX),
        None
    );
}

#[test]
fn a_rate_exactly_at_the_limit_is_still_fresh() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, publisher) = setup(&env);
    let reader = ReputationReader::new(&env, contract_id.clone());
    let corridor = String::from_str(&env, "usdc-ngn");
    publish_rate(&env, &contract_id, &publisher, &corridor);

    env.ledger().with_mut(|l| l.timestamp += 120);

    assert!(reader.corridor_rate_fresh(corridor, 120).is_some());
}
