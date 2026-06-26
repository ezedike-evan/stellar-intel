//! Storage / compute gas bounds for the reputation contract (issue #354).
//!
//! `submit_outcome` rewrites the whole per-anchor outcome list on every call, so
//! an unbounded history is the natural place for a storage blowup to creep in.
//! These tests pin the CPU-instruction and memory cost of a submit under fixed
//! ceilings and fail if a change pushes past them, turning a silent fee
//! regression into a red build.
//!
//! Each measured cost is also printed in a machine-readable form
//! (`GAS_REPORT ...`) so `scripts/gas-report.ts` can record a committed baseline
//! and fail CI on regression beyond an allowed tolerance.

use reputation::{ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

/// Ceilings for a single `submit_outcome` into a fresh anchor. Set generously
/// above the observed baseline so ordinary metering noise passes, but tight
/// enough to catch an order-of-magnitude storage blowup. Tighten alongside the
/// recorded baseline in `scripts/gas-report.ts`.
const MAX_CPU_INSTRUCTIONS: u64 = 20_000_000;
const MAX_MEMORY_BYTES: u64 = 5_000_000;

/// Number of prior submits used to prove cost does not run away with history.
const HISTORY_DEPTH: u32 = 25;

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address, String) {
    let contract_id = env.register(ReputationContract, ());
    let client = ReputationContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let anchor = String::from_str(env, "moneygram");
    (client, admin, anchor)
}

/// Measure the cost of one `submit_outcome` into an empty anchor.
#[test]
fn submit_outcome_stays_within_gas_budget() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, anchor) = setup(&env);
    let hash = String::from_str(&env, "0xoutcomehash");

    let budget = env.cost_estimate().budget();
    budget.reset_default();

    client.submit_outcome(&admin, &anchor, &hash, &42u64, &true);

    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();

    // Consumed by scripts/gas-report.ts.
    println!("GAS_REPORT entrypoint=submit_outcome scenario=cold cpu={cpu} mem={mem}");

    assert!(
        cpu <= MAX_CPU_INSTRUCTIONS,
        "submit_outcome CPU {cpu} exceeded bound {MAX_CPU_INSTRUCTIONS}"
    );
    assert!(
        mem <= MAX_MEMORY_BYTES,
        "submit_outcome memory {mem} exceeded bound {MAX_MEMORY_BYTES}"
    );
}

/// A submit after `HISTORY_DEPTH` prior submits must also respect the ceiling,
/// guarding against per-entry cost that scales unacceptably with history.
#[test]
fn submit_outcome_cost_is_bounded_under_history() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, anchor) = setup(&env);

    for i in 0..HISTORY_DEPTH {
        let hash = String::from_str(&env, "0xprior");
        client.submit_outcome(&admin, &anchor, &hash, &(i as u64), &true);
    }

    let hash = String::from_str(&env, "0xmeasured");
    let budget = env.cost_estimate().budget();
    budget.reset_default();

    client.submit_outcome(&admin, &anchor, &hash, &99u64, &true);

    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();

    println!(
        "GAS_REPORT entrypoint=submit_outcome scenario=depth{HISTORY_DEPTH} cpu={cpu} mem={mem}"
    );

    assert!(
        cpu <= MAX_CPU_INSTRUCTIONS,
        "submit_outcome (after {HISTORY_DEPTH} submits) CPU {cpu} exceeded bound {MAX_CPU_INSTRUCTIONS}"
    );
    assert!(
        mem <= MAX_MEMORY_BYTES,
        "submit_outcome (after {HISTORY_DEPTH} submits) memory {mem} exceeded bound {MAX_MEMORY_BYTES}"
    );
}
