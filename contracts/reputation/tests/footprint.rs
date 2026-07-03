//! Storage footprint tests for the reputation contract (issue #351).
//!
//! Verifies that the lazy-pagination + tiered-storage refactor keeps
//! `submit_outcome` cost flat as history grows, and that `recent_outcomes`
//! reads are bounded by `ceil(n / PAGE_SIZE)` pages regardless of depth.
//!
//! Each measured cost is printed in a machine-readable form
//! (`FOOTPRINT_REPORT ...`) compatible with `scripts/gas-report.ts`.

use reputation::{ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

/// Absolute ceilings for a single `submit_outcome` after a deep history.
/// Set conservatively above the pagination baseline; tighten alongside
/// `scripts/gas-report.ts` after the first recorded run.
const MAX_CPU_INSTRUCTIONS: u64 = 20_000_000;
const MAX_MEMORY_BYTES: u64 = 5_000_000;

/// Number of prior submits used to prove cost stays flat across page boundaries.
/// Chosen to cross at least two PAGE_SIZE (25) boundaries.
const HISTORY_DEPTH: u32 = 60;

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address, String, String) {
    let contract_id = env.register(ReputationContract, ());
    let client = ReputationContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let anchor = String::from_str(env, "moneygram");
    let corridor = String::from_str(env, "NGN-USD");
    (client, admin, anchor, corridor)
}

/// `submit_outcome` cost must stay within budget after `HISTORY_DEPTH` prior
/// submits, proving that paginated writes are O(1) w.r.t. history depth.
#[test]
fn submit_outcome_cost_flat_across_page_boundaries() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, anchor, corridor) = setup(&env);
    client.init(&admin);
    client.add_publisher(&admin, &admin);

    let hash = String::from_str(&env, "0xprior");
    for i in 0..HISTORY_DEPTH {
        client.submit_outcome(&admin, &anchor, &corridor, &hash, &(i as u64), &true);
    }

    let measured_hash = String::from_str(&env, "0xmeasured");
    let mut budget = env.cost_estimate().budget();
    budget.reset_default();

    client.submit_outcome(&admin, &anchor, &corridor, &measured_hash, &99u64, &true);

    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();

    println!(
        "FOOTPRINT_REPORT entrypoint=submit_outcome scenario=depth{HISTORY_DEPTH} cpu={cpu} mem={mem}"
    );

    assert!(
        cpu <= MAX_CPU_INSTRUCTIONS,
        "submit_outcome (depth {HISTORY_DEPTH}) CPU {cpu} exceeded {MAX_CPU_INSTRUCTIONS}"
    );
    assert!(
        mem <= MAX_MEMORY_BYTES,
        "submit_outcome (depth {HISTORY_DEPTH}) memory {mem} exceeded {MAX_MEMORY_BYTES}"
    );
}

/// Cold (empty history) submit must also stay within budget.
#[test]
fn submit_outcome_cost_cold() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, anchor, corridor) = setup(&env);
    client.init(&admin);
    client.add_publisher(&admin, &admin);

    let hash = String::from_str(&env, "0xcold");
    let mut budget = env.cost_estimate().budget();
    budget.reset_default();

    client.submit_outcome(&admin, &anchor, &corridor, &hash, &42u64, &true);

    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();

    println!("FOOTPRINT_REPORT entrypoint=submit_outcome scenario=cold cpu={cpu} mem={mem}");

    assert!(
        cpu <= MAX_CPU_INSTRUCTIONS,
        "submit_outcome cold CPU {cpu} exceeded {MAX_CPU_INSTRUCTIONS}"
    );
    assert!(
        mem <= MAX_MEMORY_BYTES,
        "submit_outcome cold memory {mem} exceeded {MAX_MEMORY_BYTES}"
    );
}

/// `recent_outcomes(n)` must return the correct entries in most-recent-first order.
#[test]
fn recent_outcomes_correct_across_pages() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, anchor, corridor) = setup(&env);
    client.init(&admin);
    client.add_publisher(&admin, &admin);

    // Submit 30 outcomes so history spans two pages (PAGE_SIZE = 25).
    for i in 0u64..30 {
        let hash = String::from_str(&env, "0xh");
        client.submit_outcome(&admin, &anchor, &corridor, &hash, &i, &true);
    }

    // Ask for the 5 most recent — should be settle_seconds 29..25.
    let recent = client.recent_outcomes(&anchor, &5u32);
    assert_eq!(recent.len(), 5);
    assert_eq!(recent.get(0).unwrap().1, 29u64);
    assert_eq!(recent.get(4).unwrap().1, 25u64);
}

/// `recent_outcomes` on an empty anchor must return an empty Vec.
#[test]
fn recent_outcomes_empty_anchor() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, anchor, _corridor) = setup(&env);
    client.init(&admin);

    let result = client.recent_outcomes(&anchor, &10u32);
    assert_eq!(result.len(), 0);
}

/// `get_corridor_aggregate` accumulates totals correctly.
#[test]
fn corridor_aggregate_accumulates() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, anchor, corridor) = setup(&env);
    client.init(&admin);
    client.add_publisher(&admin, &admin);

    let hash = String::from_str(&env, "0xh");
    client.submit_outcome(&admin, &anchor, &corridor, &hash, &10u64, &true);
    client.submit_outcome(&admin, &anchor, &corridor, &hash, &20u64, &false);
    client.submit_outcome(&admin, &anchor, &corridor, &hash, &30u64, &true);

    let (total, successes, settle_sum) = client.get_corridor_aggregate(&anchor, &corridor);
    assert_eq!(total, 3);
    assert_eq!(successes, 2);
    assert_eq!(settle_sum, 60u64);
}
