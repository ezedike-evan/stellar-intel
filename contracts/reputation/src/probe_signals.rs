//! Per-anchor probe signals, published on-chain.
//!
//! The publisher measures each anchor off-chain (uptime, latency, SEP drift)
//! and writes the result here as one typed record per anchor. It replaces the
//! publisher's "probe signals skipped - contract has no publish_probe_signals
//! entrypoint" fallback, so probe data now reaches the chain.
//!
//! Auth mirrors `corridor_rate::publish`: the caller must authorise the call and
//! be a whitelisted publisher. The anchor must be registered, as for outcomes.

use soroban_sdk::{contracttype, Address, Env, String};

use crate::storage::{self, DataKey};
use crate::{anchors, events, publishers, Error};

/// The latest probe signals for one anchor.
///
/// `p50_latency_ms == 0 && p95_latency_ms == 0` means "no reachable samples":
/// the anchor was probed and never answered, so there is no latency to report.
/// It is distinct from a missing record, which means it was never probed.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProbeSignals {
    /// Share of probes that reached the anchor, in basis points (0-10000).
    pub uptime_bps: u32,
    pub p50_latency_ms: u32,
    pub p95_latency_ms: u32,
    /// How many SEP drift flags the anchor currently has.
    pub drift_flag_count: u32,
    /// Ledger timestamp of the write.
    pub updated_at: u64,
    pub publisher: Address,
}

const MAX_BPS: u32 = 10_000;

/// Publish (or overwrite) the probe signals for `anchor_id`. Publisher-only.
///
/// `OutOfRange` when `uptime_bps` exceeds 10000 or `p50_latency_ms` exceeds
/// `p95_latency_ms`; `AnchorNotRegistered` for an unknown anchor.
pub fn publish(
    env: &Env,
    publisher: &Address,
    anchor_id: String,
    uptime_bps: u32,
    p50_latency_ms: u32,
    p95_latency_ms: u32,
    drift_flag_count: u32,
) -> Result<(), Error> {
    publishers::require_publisher(env, publisher)?;
    anchors::require_registered(env, &anchor_id)?;

    if uptime_bps > MAX_BPS || p50_latency_ms > p95_latency_ms {
        return Err(Error::OutOfRange);
    }

    let record = ProbeSignals {
        uptime_bps,
        p50_latency_ms,
        p95_latency_ms,
        drift_flag_count,
        updated_at: env.ledger().timestamp(),
        publisher: publisher.clone(),
    };
    let key = DataKey::ProbeSignals(anchor_id.clone());
    env.storage().persistent().set(&key, &record);
    storage::extend_persistent(env, &key);

    events::probe_signals(env, publisher, &anchor_id, uptime_bps);
    Ok(())
}

/// Read the latest probe signals for `anchor_id`, if any were published.
pub fn get(env: &Env, anchor_id: String) -> Option<ProbeSignals> {
    env.storage()
        .persistent()
        .get(&DataKey::ProbeSignals(anchor_id))
}
