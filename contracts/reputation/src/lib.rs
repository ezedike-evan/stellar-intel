#![no_std]
use soroban_sdk::{contract, contracterror, contractimpl, Address, BytesN, Env, String, Vec};

pub mod admin;
pub mod aggregate;
pub mod anchors;
pub mod corridor_rate;
pub mod history;
pub mod migration;
pub mod outcome;
pub mod publishers;
pub mod score;
pub mod storage;
pub mod upgrade;
pub mod volume_savings;

#[contracterror]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    AnchorExists = 4,
    PublisherExists = 5,
    PublisherNotFound = 6,
    PublisherUnauthorized = 7,
    InvalidCorridorRate = 8,
}

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    pub fn init(env: Env, admin: Address) -> Result<(), Error> {
        admin::set_admin(&env, &admin)
    }

    pub fn register_anchor(env: Env, caller: Address, anchor_id: String) -> Result<(), Error> {
        admin::require_admin(&env, &caller)?;
        anchors::register(&env, anchor_id)
    }

    pub fn list_anchors(env: Env) -> Vec<String> {
        anchors::list(&env)
    }

    pub fn admin(env: Env) -> Option<Address> {
        admin::get_admin(&env)
    }

    /// Step 1 of a safe admin handoff: nominate `candidate` as the next admin.
    /// The change is not live until `candidate` calls `accept_admin`.
    pub fn propose_admin(env: Env, caller: Address, candidate: Address) -> Result<(), Error> {
        admin::propose_admin(&env, &caller, &candidate)
    }

    /// Step 2 of a safe admin handoff: `candidate` accepts the pending proposal
    /// and becomes the new admin.
    pub fn accept_admin(env: Env, candidate: Address) -> Result<(), Error> {
        admin::accept_admin(&env, &candidate)
    }

    /// Cancel a pending admin proposal without transferring authority.
    /// Only the current admin may call this.
    pub fn cancel_admin_proposal(env: Env, caller: Address) -> Result<(), Error> {
        admin::cancel_admin_proposal(&env, &caller)
    }

    /// Return the pending admin candidate, if any.
    pub fn pending_admin(env: Env) -> Option<Address> {
        admin::get_pending_admin(&env)
    }

    pub fn add_publisher(env: Env, caller: Address, publisher: Address) -> Result<(), Error> {
        admin::require_admin(&env, &caller)?;
        publishers::add(&env, publisher)
    }

    pub fn revoke_publisher(env: Env, caller: Address, publisher: Address) -> Result<(), Error> {
        admin::require_admin(&env, &caller)?;
        publishers::revoke(&env, publisher)
    }

    pub fn list_publishers(env: Env) -> Vec<Address> {
        publishers::list(&env)
    }

    pub fn submit_outcome(
        env: Env,
        publisher: Address,
        anchor_id: String,
        corridor: String,
        outcome_hash: String,
        settle_seconds: u64,
        success: bool,
    ) -> Result<(), Error> {
        outcome::submit_outcome(
            &env,
            &publisher,
            anchor_id,
            corridor,
            outcome_hash,
            settle_seconds,
            success,
        )
    }

    /// Return the rolling aggregate for an (anchor, corridor) pair:
    /// `(total, successes, settle_seconds_sum)`.
    /// Returns `(0, 0, 0)` when no outcomes have been recorded for that pair.
    pub fn get_corridor_aggregate(
        env: Env,
        anchor_id: String,
        corridor: String,
    ) -> (u32, u32, u64) {
        aggregate::get(&env, &anchor_id, &corridor)
    }

    /// Return the last `n` outcome aggregates for an anchor in descending time order.
    /// `n` is capped at 100 to bound gas consumption.
    pub fn recent_outcomes(env: Env, anchor_id: String, n: u32) -> Vec<(String, u64, bool)> {
        history::recent_outcomes(&env, anchor_id, n)
    }

    /// Bind the upgrade administrator and stamp the initial contract version.
    /// One-shot; reverts if the upgrade admin is already set.
    pub fn init_upgrade(env: Env, admin: Address) {
        upgrade::init(&env, admin);
    }

    /// Admin-signed contract upgrade. Replaces the contract WASM with the code
    /// at `new_wasm_hash` while preserving all stored state, following Soroban's
    /// standard upgrade pattern.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        upgrade::apply(&env, new_wasm_hash);
    }

    /// Return the live contract version (`0` before `init_upgrade`).
    pub fn contract_version(env: Env) -> u32 {
        upgrade::current_version(&env)
    }

    pub fn get_score_for_corridor(
        env: Env,
        anchor_id: String,
        corridor: String,
    ) -> (i128, i128, u64, u32) {
        score::get_score_for_corridor(&env, anchor_id, corridor)
    }

    pub fn set_corridor_metrics(
        env: Env,
        anchor_id: String,
        corridor: String,
        fill_rate_bps: i128,
        slippage_bps: i128,
        settle_seconds_p50: u64,
        n: u32,
    ) {
        score::set_corridor_metrics(
            &env,
            anchor_id,
            corridor,
            fill_rate_bps,
            slippage_bps,
            settle_seconds_p50,
            n,
        );
    }

    /// Publish (or overwrite) the block-level rate for a corridor (issue #810).
    /// Publisher-only; `rate` is scaled by 10^`decimals` fiat units per 1 USDC.
    pub fn publish_corridor_rate(
        env: Env,
        publisher: Address,
        corridor: String,
        rate: i128,
        decimals: u32,
    ) -> Result<(), Error> {
        corridor_rate::publish(&env, &publisher, corridor, rate, decimals)
    }

    /// Read the latest published rate for `corridor`, or `None` if unset.
    pub fn get_corridor_rate(env: Env, corridor: String) -> Option<corridor_rate::CorridorRate> {
        corridor_rate::get(&env, corridor)
    }

    // ── V2 entrypoints (multi-corridor expansion, issue #825) ────────────

    /// Migrate a single (anchor_id, corridor) pair from v1 to v2 storage.
    /// Idempotent: skips if v2 data already exists.
    pub fn migrate_corridor_v2(env: Env, anchor_id: String, corridor: String) {
        migration::migrate_corridor(&env, anchor_id, corridor)
    }

    /// Migrate all registered anchors across all default corridors.
    /// Idempotent: skips pairs already migrated.
    pub fn migrate_all_v2(env: Env) {
        migration::migrate_all(&env)
    }

    /// V2 version of `get_corridor_aggregate`. The aggregate schema is
    /// unchanged between v1 and v2 (same `CorridorAggregate` key), so this is
    /// a direct alias for forward-compatibility when callers are already
    /// targeting the v2 interface.
    pub fn get_corridor_aggregate_v2(
        env: Env,
        anchor_id: String,
        corridor: String,
    ) -> (u32, u32, u64) {
        aggregate::get(&env, &anchor_id, &corridor)
    }

    /// V2 version of `get_score_for_corridor`. Returns
    /// `(composite_bps, fill_rate_bps, slippage_bps, settle_seconds_p50, n)`
    /// from the v2 storage key. Falls back to computing from v1 data if v2
    /// data is not yet present.
    pub fn get_score_for_corridor_v2(
        env: Env,
        anchor_id: String,
        corridor: String,
    ) -> (i128, i128, i128, u64, u32) {
        let v2_key = storage::DataKey::CorridorV2(anchor_id.clone(), corridor.clone());
        let default_v2 = (0i128, 0i128, 0i128, 0u64, 0u32);
        let (fill_rate_bps, slippage_bps, composite_bps, settle_seconds_p50, n): (
            i128,
            i128,
            i128,
            u64,
            u32,
        ) = env
            .storage()
            .persistent()
            .get(&v2_key)
            .unwrap_or(default_v2);

        if composite_bps != 0 || n != 0 {
            return (
                composite_bps,
                fill_rate_bps,
                slippage_bps,
                settle_seconds_p50,
                n,
            );
        }

        let (old_composite_bps, old_fill_rate_bps, old_settle_seconds_p50, old_n) =
            score::get_score_for_corridor(&env, anchor_id, corridor);
        let old_slippage_bps = 0i128;
        (
            old_composite_bps,
            old_fill_rate_bps,
            old_slippage_bps,
            old_settle_seconds_p50,
            old_n,
        )
    }

    // ── Volume + savings oracle (issue #826) ─────────────────────────────

    /// Publish a volume + savings increment for a corridor. Publisher-only.
    /// `volume_delta` and `savings_delta` are in microUSDC (1 USDC = 1_000_000).
    /// Values are cumulative and monotonically increasing.
    pub fn add_volume_savings(
        env: Env,
        publisher: Address,
        corridor: String,
        volume_delta: i128,
        savings_delta: i128,
    ) -> Result<(), Error> {
        volume_savings::add_volume_savings(&env, &publisher, corridor, volume_delta, savings_delta)
    }

    /// Read the cumulative volume + savings for `corridor`, or `None` if
    /// no data has been published yet.
    pub fn get_volume_savings(env: Env, corridor: String) -> Option<volume_savings::VolumeSavings> {
        volume_savings::get(&env, corridor)
    }
}
