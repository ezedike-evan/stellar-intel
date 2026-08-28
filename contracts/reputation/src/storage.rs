//! Centralised storage-key definitions and tiered-access strategy.
//!
//! ## Storage bucket strategy
//!
//! | Tier       | Keys stored here                              | Rationale                                           |
//! |------------|-----------------------------------------------|-----------------------------------------------------|
//! | Instance   | `Admin`, `Anchors`, `Publishers`              | Tiny hot metadata; always loaded with the instance  |
//! | Persistent | `AnchorTag`, `Publisher`, `OutcomeHead`,      | Large / per-entity blobs; pay only on access        |
//! |            | `OutcomePage`, `Corridor`                     |                                                     |
//!
//! ### Hot-keyed writes (`OutcomePage`)
//! Outcome history is split into fixed-size pages of [`PAGE_SIZE`] entries.
//! Each `submit_outcome` touches exactly one persistent key — the current page
//! — rather than rewriting an ever-growing flat list.  Write cost is O(1)
//! with respect to history depth.
//!
//! ### Bounded reads (`OutcomePage`)
//! `recent_outcomes(n)` reads at most `ceil(n / PAGE_SIZE)` pages.
//!
//! ### Membership checks (`Publisher`, `AnchorTag`)
//! Each publisher and anchor has its own persistent entry (a single bool).
//! `is_authorized` and duplicate detection each cost one persistent read
//! instead of scanning a `Vec` loaded from instance storage.
//!
//! `Anchors` and `Publishers` remain in instance storage solely to serve the
//! admin list-view functions; they are never touched by the hot write paths.

use soroban_sdk::{contracttype, Address, Env, String};

/// Maximum entries per outcome page.  Tune this to balance page-read overhead
/// against the number of pages `recent_outcomes` must fetch.
pub const PAGE_SIZE: u32 = 25;

// ── TTL management ─────────────────────────────────────────────────────────────
//
// Soroban archives instance and persistent entries whose TTL lapses. The
// contract previously never bumped anything, so its state (the anchor registry,
// publisher set, outcome pages, corridor metrics, rates) would eventually archive
// and the oracle would go dark. Every mutating path now extends the entry it
// touches, and the public `bump()` entrypoint lets anyone top up the instance
// during dormant periods. Reads deliberately do NOT self-bump — that would turn
// every read into a state write and blow the gas/footprint budgets — so liveness
// comes from write activity plus `bump()`.
//
// Ledgers close ~every 5s, so ~17_280 ledgers ≈ 1 day. Extend well past the
// bump threshold so a single write buys a long runway; both stay comfortably
// under the network's max entry TTL.
const LEDGERS_PER_DAY: u32 = 17_280;
pub const TTL_THRESHOLD_LEDGERS: u32 = LEDGERS_PER_DAY; // bump when < ~1 day remains
pub const TTL_EXTEND_LEDGERS: u32 = 31 * LEDGERS_PER_DAY; // extend to ~31 days

/// Extend the TTL of a persistent entry (call right after writing it).
pub fn extend_persistent(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, TTL_THRESHOLD_LEDGERS, TTL_EXTEND_LEDGERS);
}

/// Extend the TTL of the contract instance (Admin / Anchors / Publishers).
pub fn extend_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD_LEDGERS, TTL_EXTEND_LEDGERS);
}

/// All storage keys for the reputation contract.
///
/// Variants are grouped by intended storage tier (see module-level docs).
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // ── Instance tier ──────────────────────────────────────────────────────
    /// The contract administrator.
    Admin,
    /// Candidate address proposed by the current admin during a two-step
    /// transfer. Cleared once the candidate calls `accept_admin` or the
    /// current admin calls `cancel_admin_proposal`.
    PendingAdmin,
    /// Ordered list of registered anchor ids (admin list-view only).
    Anchors,
    /// Ordered list of publisher addresses (admin list-view only).
    Publishers,

    // ── Persistent tier ────────────────────────────────────────────────────
    /// Existence flag for a single anchor id.  Checked on every `register_anchor`
    /// to avoid a full `Anchors` Vec scan.
    AnchorTag(String),
    /// Membership flag for a single publisher address.  Checked on every
    /// `submit_outcome` to avoid a full `Publishers` Vec scan.
    Publisher(Address),
    /// Current outcome-page pointer for an anchor: `(page_num, page_len)`.
    OutcomeHead(String),
    /// One page of outcome entries for an anchor: at most [`PAGE_SIZE`] items.
    OutcomePage(String, u32),
    /// Corridor performance metrics: `(fill_rate_bps, slippage_bps, settle_seconds_p50, n)`.
    Corridor(String, String),
    /// Rolling aggregate for an (anchor, corridor) pair: `(total, successes, settle_seconds_sum)`.
    CorridorAggregate(String, String),
    /// Latest published block-level rate for a corridor (issue #810).
    CorridorRate(String),
    /// V2 corridor metrics: `(fill_rate_bps, slippage_bps, composite_bps, settle_seconds_p50, n)`.
    /// Supports multi-corridor expansion without breaking v1 readers.
    CorridorV2(String, String),
    /// Cumulative volume + savings for a corridor (issue #826).
    VolumeSavings(String),
}
