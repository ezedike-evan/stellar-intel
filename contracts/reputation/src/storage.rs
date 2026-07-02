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

use soroban_sdk::{contracttype, Address, String};

/// Maximum entries per outcome page.  Tune this to balance page-read overhead
/// against the number of pages `recent_outcomes` must fetch.
pub const PAGE_SIZE: u32 = 25;

/// All storage keys for the reputation contract.
///
/// Variants are grouped by intended storage tier (see module-level docs).
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // ── Instance tier ──────────────────────────────────────────────────────
    /// The contract administrator.
    Admin,
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
}
