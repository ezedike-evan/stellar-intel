//! Contract events.
//!
//! Indexers, the web app and auditors can follow what publishers wrote without
//! diffing storage (audit P3, event emission). Each helper is called at the end
//! of its write path, only after every storage write has succeeded, so a
//! rejected or rolled-back call emits nothing.
//!
//! ## Publisher writes
//!
//! | Topics                                   | Data                                    |
//! |------------------------------------------|-----------------------------------------|
//! | `("outcome", anchor_id, corridor)`       | `(publisher, settle_seconds, success)`  |
//! | `("metrics", anchor_id, corridor)`       | `(publisher, composite_bps, n)`         |
//! | `("rate", corridor)`                     | `(publisher, rate, decimals)`           |
//! | `("volume", corridor)`                   | `(publisher, volume_delta, savings_delta)` |
//!
//! `anchor_id` and `corridor` are `String`s, `publisher` is an `Address`,
//! `settle_seconds` is `u64`, `success` is `bool`, `composite_bps`, `rate` and
//! the deltas are `i128`, and `n` and `decimals` are `u32`.

use soroban_sdk::{symbol_short, Address, Env, String};

/// An outcome was recorded for `anchor_id` on `corridor`.
pub fn outcome(
    env: &Env,
    publisher: &Address,
    anchor_id: &String,
    corridor: &String,
    settle_seconds: u64,
    success: bool,
) {
    env.events().publish(
        (
            symbol_short!("outcome"),
            anchor_id.clone(),
            corridor.clone(),
        ),
        (publisher.clone(), settle_seconds, success),
    );
}

/// Corridor metrics were published for `anchor_id` on `corridor`.
pub fn metrics(
    env: &Env,
    publisher: &Address,
    anchor_id: &String,
    corridor: &String,
    composite_bps: i128,
    n: u32,
) {
    env.events().publish(
        (
            symbol_short!("metrics"),
            anchor_id.clone(),
            corridor.clone(),
        ),
        (publisher.clone(), composite_bps, n),
    );
}

/// A corridor rate was published.
pub fn rate(env: &Env, publisher: &Address, corridor: &String, rate: i128, decimals: u32) {
    env.events().publish(
        (symbol_short!("rate"), corridor.clone()),
        (publisher.clone(), rate, decimals),
    );
}

/// Volume and savings were added to a corridor's totals.
pub fn volume(
    env: &Env,
    publisher: &Address,
    corridor: &String,
    volume_delta: i128,
    savings_delta: i128,
) {
    env.events().publish(
        (symbol_short!("volume"), corridor.clone()),
        (publisher.clone(), volume_delta, savings_delta),
    );
}
