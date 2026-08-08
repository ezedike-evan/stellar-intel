//! On-chain volume + savings oracle (issue #826).
//!
//! Publishes per-corridor cumulative volume (USDC settled) and estimated
//! fees saved (relative to a baseline rate) on-chain, sourced from real
//! executed intents. The baseline is the anchor's own indicative rate at
//! intent time, or the median of all anchor rates for that corridor when
//! the anchor-specific baseline is unavailable.
//!
//! Consumers compare `volume_usdc` (cumulative settled volume) and
//! `savings_usdc` (estimated savings vs baseline) to verify that routing
//! through Stellar Intel beats the alternative. Both values are cumulative
//! and monotonically increasing.
//!
//! Auth mirrors `outcome::submit_outcome`: the caller must both authorize
//! the call and be a registered publisher.

use soroban_sdk::{contracttype, Address, Env, String};

use crate::storage::{self, DataKey};
use crate::{publishers, Error};

/// Upper bound on a single volume/savings delta (in microUSDC): 1e18 µUSDC =
/// 1e12 USDC. Any real settlement is far below this; the cap keeps the
/// cumulative i128 accumulators away from overflow even over a long lifetime.
pub const MAX_DELTA: i128 = 1_000_000_000_000_000_000;

/// Per-corridor volume + savings snapshot.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VolumeSavings {
    /// Cumulative USDC volume settled for this corridor (in microUSDC, 1 USDC = 1_000_000).
    pub volume_usdc: i128,
    /// Cumulative estimated savings vs baseline (in microUSDC).
    pub savings_usdc: i128,
    /// Number of settlements contributing to these totals.
    pub settlement_count: u32,
    /// Ledger timestamp of the last update.
    pub updated_at: u64,
    /// Publisher address that submitted the last update.
    pub publisher: Address,
}

/// Publish (or add to) the cumulative volume + savings for `corridor`.
/// Publisher-only. `volume_delta` and `savings_delta` are in microUSDC.
pub fn add_volume_savings(
    env: &Env,
    publisher: &Address,
    corridor: String,
    volume_delta: i128,
    savings_delta: i128,
) -> Result<(), Error> {
    publisher.require_auth();
    if !publishers::is_authorized(env, publisher) {
        return Err(Error::PublisherUnauthorized);
    }
    if volume_delta < 0 || savings_delta < 0 {
        return Err(Error::InvalidCorridorRate);
    }
    if volume_delta > MAX_DELTA || savings_delta > MAX_DELTA {
        return Err(Error::OutOfRange);
    }

    let key = DataKey::VolumeSavings(corridor.clone());
    let current: Option<VolumeSavings> = env.storage().persistent().get(&key);
    let mut record = current.unwrap_or(VolumeSavings {
        volume_usdc: 0,
        savings_usdc: 0,
        settlement_count: 0,
        updated_at: 0,
        publisher: publisher.clone(),
    });

    // checked_add so a rogue publisher cannot trap the corridor by driving a
    // cumulative accumulator to overflow under `overflow-checks = true`.
    record.volume_usdc = record
        .volume_usdc
        .checked_add(volume_delta)
        .ok_or(Error::ArithmeticOverflow)?;
    record.savings_usdc = record
        .savings_usdc
        .checked_add(savings_delta)
        .ok_or(Error::ArithmeticOverflow)?;
    record.settlement_count = record
        .settlement_count
        .checked_add(1)
        .ok_or(Error::ArithmeticOverflow)?;
    record.updated_at = env.ledger().timestamp();
    record.publisher = publisher.clone();

    env.storage().persistent().set(&key, &record);
    storage::extend_persistent(env, &key);
    Ok(())
}

/// Read the latest cumulative volume + savings for `corridor`, if any.
pub fn get(env: &Env, corridor: String) -> Option<VolumeSavings> {
    env.storage()
        .persistent()
        .get(&DataKey::VolumeSavings(corridor))
}

/// Clear the cumulative volume/savings for `corridor`. Admin-gated at the
/// entrypoint — the escape hatch for a corridor polluted by a since-revoked
/// publisher.
pub fn reset(env: &Env, corridor: String) {
    env.storage()
        .persistent()
        .remove(&DataKey::VolumeSavings(corridor));
}
