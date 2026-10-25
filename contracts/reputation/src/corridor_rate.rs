//! Corridor rate oracle (issue #810).
//!
//! Publisher-authored, block-level rates for the target USDC corridors
//! (USDC-NGN/KES/MXN/PHP), stored on-chain and read by consumers. The rate is
//! fed off-chain from live execution + probe data (see `lib/oracle/`); this
//! module is the publish/read surface. Auth mirrors `outcome::submit_outcome`:
//! the caller must both authorize the call and be a registered publisher.

use soroban_sdk::{contracttype, Address, Env, String};

use crate::storage::{self, DataKey};
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
    let key = DataKey::CorridorRate(corridor);
    env.storage().persistent().set(&key, &record);
    storage::extend_persistent(env, &key);
    Ok(())
}

/// Read the latest published rate for `corridor`, if any.
pub fn get(env: &Env, corridor: String) -> Option<CorridorRate> {
    env.storage()
        .persistent()
        .get(&DataKey::CorridorRate(corridor))
}

/// Read the rate for `corridor` only if it was published within the last
/// `max_age_seconds`. A consumer that settles against the rate cannot otherwise
/// tell one from five minutes ago from one five weeks old without doing its own
/// timestamp arithmetic (audit P3, rate staleness). A rate stamped in the
/// future (clock skew between ledgers) counts as age zero rather than failing.
pub fn get_fresh(env: &Env, corridor: String, max_age_seconds: u64) -> Option<CorridorRate> {
    let rate = get(env, corridor)?;
    let age = env.ledger().timestamp().saturating_sub(rate.updated_at);
    if age <= max_age_seconds {
        Some(rate)
    } else {
        None
    }
}
