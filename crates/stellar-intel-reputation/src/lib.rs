#![no_std]

use soroban_sdk::{contractclient, Address, Env, String, Vec};

/// Read-only helper for the Stellar Intel reputation oracle.
///
/// This crate stays intentionally thin: it exposes a typed contract client for
/// the oracle plus a small aggregate helper that consumer contracts can use
/// without re-implementing the read pattern.
#[contractclient(name = "ReputationClient")]
pub trait ReputationOracle {
    fn recent_outcomes(env: Env, anchor_id: String, n: u32) -> Vec<(String, u64, bool)>;
}

/// Summary of a reputation slice returned by the oracle.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReputationAggregate {
    pub sample_size: u32,
    pub successful: u32,
    pub failed: u32,
    pub score_bps: u32,
}

impl ReputationAggregate {
    /// Returns the score as basis points for easy rendering and comparison.
    pub fn score(&self) -> u32 {
        self.score_bps
    }
}

/// Typed wrapper around an oracle contract address.
pub struct ReputationReader<'a> {
    client: ReputationClient<'a>,
}

impl<'a> ReputationReader<'a> {
    /// Build a reader bound to a specific oracle contract address.
    pub fn new(env: &'a Env, contract_id: Address) -> Self {
        Self {
            client: ReputationClient::new(env, &contract_id),
        }
    }

    /// Read the last `n` outcome rows for an anchor.
    pub fn recent_outcomes(&self, anchor_id: String, n: u32) -> Vec<(String, u64, bool)> {
        self.client.recent_outcomes(&anchor_id, &n)
    }

    /// Read a compact aggregate over the last `window` outcomes.
    ///
    /// The aggregate is intentionally conservative and dependency-free:
    /// it derives a score from the observed success rate so consumer contracts
    /// can make deterministic read-only decisions.
    pub fn read_aggregate(&self, anchor_id: String, window: u32) -> ReputationAggregate {
        let outcomes = self.recent_outcomes(anchor_id, window);
        let sample_size = outcomes.len();
        if sample_size == 0 {
            return ReputationAggregate {
                sample_size: 0,
                successful: 0,
                failed: 0,
                score_bps: 0,
            };
        }

        let mut successful = 0u32;
        for (_, _, success) in outcomes.iter() {
            if success {
                successful += 1;
            }
        }

        let failed = sample_size - successful;
        let score_bps = successful.saturating_mul(10_000) / sample_size;

        ReputationAggregate {
            sample_size,
            successful,
            failed,
            score_bps,
        }
    }

    /// Convenience helper for consumer contracts that only need a score.
    pub fn score_bps(&self, anchor_id: String, window: u32) -> u32 {
        self.read_aggregate(anchor_id, window).score()
    }
}
