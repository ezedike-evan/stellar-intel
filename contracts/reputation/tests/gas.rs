//! Storage / compute gas bounds for the reputation contract (issue #354).
//!
//! These tests pin the CPU-instruction and memory cost of a submit under fixed
//! ceilings and fail if a change pushes past them, turning a silent fee
//! regression into a red build.
//!
//! Each measured cost is also printed in a machine-readable form
//! (`GAS_REPORT ...`) so `scripts/gas-report.ts` can record a committed baseline
//! and fail CI on regression beyond an allowed tolerance.

use reputation::{ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

const MAX_CPU_INSTRUCTIONS: u64 = 20_000_000;
const MAX_MEMORY_BYTES: u64 = 5_000_000;

const HISTORY_DEPTH: u32 = 25;

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address, String, String) {
    let contract_id = env.register(ReputationContract, ());
    let client = ReputationContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let anchor = String::from_str(env, "moneygram");
    let corridor = String::from_str(env, "NGN-USD");
    (client, admin, anchor, corridor)
}

/// Measure the cost of one `submit_outcome` into an empty anchor.
#[test]
fn submit_outcome_stays_within_gas_budget() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, anchor, corridor) = setup(&env);
    client.init(&admin);
    client.add_publisher(&admin, &admin);

    let hash = String::from_str(&env, "0xoutcomehash");
    let mut budget = env.cost_estimate().budget();
    budget.reset_default();

    client.submit_outcome(&admin, &anchor, &corridor, &hash, &42u64, &true);

    let cpu = budget.cpu_instruction_cost();
    let mem = budget.memory_bytes_cost();

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

/// A submit after `HISTORY_DEPTH` prior submits must also respect the ceiling.
#[test]
fn submit_outcome_cost_is_bounded_under_history() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, anchor, corridor) = setup(&env);
    client.init(&admin);
    client.add_publisher(&admin, &admin);

    for i in 0..HISTORY_DEPTH {
        let hash = String::from_str(&env, "0xprior");
        client.submit_outcome(&admin, &anchor, &corridor, &hash, &(i as u64), &true);
    }

    let hash = String::from_str(&env, "0xmeasured");
    let mut budget = env.cost_estimate().budget();
    budget.reset_default();

    client.submit_outcome(&admin, &anchor, &corridor, &hash, &99u64, &true);

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
