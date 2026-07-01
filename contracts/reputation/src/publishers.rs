//! Publisher whitelist storage helpers.
//!
//! Publishers are held in instance storage and only authorized publishers can
//! submit outcomes once the purge endpoint is enabled.

use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::{admin::DataKey, Error};

/// Load the current publisher whitelist (empty if none registered yet).
pub fn list(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Publishers)
        .unwrap_or_else(|| Vec::new(env))
}

/// Append a publisher to the whitelist. Returns `PublisherExists` if the
/// address is already present.
pub fn add(env: &Env, publisher: Address) -> Result<(), Error> {
    let mut publishers = list(env);

    for existing in publishers.iter() {
        if existing == publisher {
            return Err(Error::PublisherExists);
        }
    }

    publishers.push_back(publisher);
    env.storage().instance().set(&DataKey::Publishers, &publishers);
    Ok(())
}

/// Remove a publisher from the whitelist. Returns `PublisherNotFound` if it
/// does not exist.
pub fn revoke(env: &Env, publisher: Address) -> Result<(), Error> {
    let publishers = list(env);
    let mut remaining = Vec::new(env);
    let mut found = false;

    for existing in publishers.iter() {
        if existing == publisher {
            found = true;
            continue;
        }
        remaining.push_back(existing);
    }

    if !found {
        return Err(Error::PublisherNotFound);
    }

    env.storage().instance().set(&DataKey::Publishers, &remaining);
    Ok(())
}

/// Checks whether the caller is currently authorized to submit outcomes.
pub fn is_authorized(env: &Env, publisher: &Address) -> bool {
    for existing in list(env).iter() {
        if existing == *publisher {
            return true;
        }
    }
    false
}
