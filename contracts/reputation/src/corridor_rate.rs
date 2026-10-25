//! Corridor rate oracle (issue #810).
//!
//! Publisher-authored, block-level rates for the target USDC corridors
//! (USDC-NGN/KES/MXN/PHP), stored on-chain and read by consumers. The rate is
//! fed off-chain from live execution + probe data (see `lib/oracle/`); this
//! module is the publish/read surface. Auth mirrors `outcome::submit_outcome`:
//! the caller must both authorize the call and be a registered publisher.
//!
//! A publish may not move a corridor's rate by more than 2x in either direction
//! from the previous record (and `decimals` is capped at 18), so a leaked
//! publisher key cannot swing every consumer's settlement rate arbitrarily in
//! one transaction (audit P3, rate bounds). A real move beyond 2x needs the
//! admin to `reset` the corridor first. The check applies only when the previous
//! record has the same `decimals`: a rescale is a different unit, not a jump.

use soroban_sdk::{contracttype, Address, Env, String};

use crate::storage::{self, DataKey};
use crate::{corridors, events, publishers, Error};

/// Most decimals a rate may be scaled by; beyond this `10^decimals` overflows
/// `i128` arithmetic in consumers.
const MAX_DECIMALS: u32 = 18;

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
    publishers::require_in_scope(env, publisher, &corridor)?;
    if !corridors::is_registered(env, &corridor) {
        return Err(Error::CorridorNotRegistered);
    }
    if rate <= 0 || decimals > MAX_DECIMALS {
        return Err(Error::InvalidCorridorRate);
    }

    let key = DataKey::CorridorRate(corridor.clone());
    if let Some(prev) = env
        .storage()
        .persistent()
        .get::<DataKey, CorridorRate>(&key)
    {
        if prev.decimals == decimals {
            let ceiling = prev.rate.checked_mul(2).ok_or(Error::ArithmeticOverflow)?;
            if rate < prev.rate / 2 || rate > ceiling {
                return Err(Error::RateJumpTooLarge);
            }
        }
    }

    let record = CorridorRate {
        rate,
        decimals,
        updated_at: env.ledger().timestamp(),
        publisher: publisher.clone(),
    };
    env.storage().persistent().set(&key, &record);
    storage::extend_persistent(env, &key);
    events::rate(env, publisher, &corridor, rate, decimals);
    Ok(())
}

/// Remove the stored rate for `corridor`. Admin-gated by the caller.
pub fn reset(env: &Env, corridor: String) {
    env.storage()
        .persistent()
        .remove(&DataKey::CorridorRate(corridor));
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
