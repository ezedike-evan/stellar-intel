//! Corridor rate oracle (issue #810).
//!
//! Publisher-authored, block-level rates for the target USDC corridors
//! (USDC-NGN/KES/MXN/PHP), stored on-chain and read by consumers. The rate is
//! fed off-chain from live execution + probe data (see `lib/oracle/`); this
//! module is the publish/read surface. Auth mirrors `outcome::submit_outcome`:
//! the caller must both authorize the call and be a registered publisher.

use soroban_sdk::{contracttype, Address, Env, String};

use crate::storage::DataKey;
use crate::{publishers, Error};

/// A published corridor rate. `rate` is scaled by 10^`decimals` fiat units per
/// 1 USDC, stamped with the publishing address and the ledger timestamp.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CorridorRate {
    pub rate: i128,
    pub decimals: u32,
    pub updated_at: u64,
    pub publisher: Address,
}

/// Publish (or overwrite) the current rate for `corridor`. Publisher-only.
pub fn publish(
    env: &Env,
    publisher: &Address,
    corridor: String,
    rate: i128,
    decimals: u32,
) -> Result<(), Error> {
    publisher.require_auth();
    if !publishers::is_authorized(env, publisher) {
        return Err(Error::PublisherUnauthorized);
    }
    if rate <= 0 {
        return Err(Error::InvalidCorridorRate);
    }

    let record = CorridorRate {
        rate,
        decimals,
        updated_at: env.ledger().timestamp(),
        publisher: publisher.clone(),
    };
    env.storage()
        .persistent()
        .set(&DataKey::CorridorRate(corridor), &record);
    Ok(())
}

/// Read the latest published rate for `corridor`, if any.
pub fn get(env: &Env, corridor: String) -> Option<CorridorRate> {
    env.storage()
        .persistent()
        .get(&DataKey::CorridorRate(corridor))
}
