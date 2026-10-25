#![no_std]
use soroban_sdk::{contract, contracterror, contractimpl, Address, BytesN, Env, String, Vec};

pub mod admin;
pub mod aggregate;
pub mod anchors;
pub mod corridor_rate;
pub mod corridors;
pub mod events;
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
    ArithmeticOverflow = 9,
    OutOfRange = 10,
    RateJumpTooLarge = 11,
    AnchorNotRegistered = 12,
    CorridorExists = 13,
    CorridorNotRegistered = 14,
    PublisherOutOfScope = 15,
    NoPendingUpgrade = 16,
    UpgradeNotReady = 17,
    UpgradeHashMismatch = 18,
}

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    /// Contract constructor — binds the operational admin and the upgrade admin
    /// atomically at deploy.
    ///
    /// Replaces the former callable `init` / `init_upgrade` entrypoints, which
    /// were front-runnable: after deploy, the first caller could seize either
    /// role before the legitimate operator's transaction landed. A constructor
    /// runs exactly once, inside the deploy transaction, so there is no window
    /// to race. The two roles remain distinct storage keys and may be the same
    /// account or different accounts (observable via `upgrade_admin`, #913).
    pub fn __constructor(env: Env, admin: Address, upgrade_admin: Address) {
        // Instance storage is empty at construction, so `set_admin` cannot hit
        // `AlreadyInitialized` here; the expect guards against a future refactor
        // that changes that invariant rather than an expected runtime path.
        admin::set_admin(&env, &admin).expect("admin must be unset at construction");
        upgrade::init(&env, upgrade_admin);
        storage::extend_instance(&env);
    }

    /// Top up the contract instance's TTL. Callable by anyone — keeping the
    /// oracle alive is permissionless — so a dormant contract cannot silently
    /// archive between writes. Every mutating entrypoint also extends the
    /// instance on its success path, and persistent entries are bumped on every
    /// write, so this is only needed for a contract that sees no writes at all.
    pub fn bump(env: Env) {
        storage::extend_instance(&env);
    }

    pub fn register_anchor(env: Env, caller: Address, anchor_id: String) -> Result<(), Error> {
        admin::require_admin(&env, &caller)?;
        anchors::register(&env, anchor_id.clone())?;
        storage::extend_instance(&env);
        events::anchor_registered(&env, &caller, &anchor_id);
        Ok(())
    }

    /// Admin-only. Adds `corridor` to the registry that `publish_corridor_rate`
    /// and `add_volume_savings` check.
    pub fn register_corridor(env: Env, caller: Address, corridor: String) -> Result<(), Error> {
        admin::require_admin(&env, &caller)?;
        corridors::register(&env, corridor)?;
        storage::extend_instance(&env);
        Ok(())
    }

    pub fn list_corridors(env: Env) -> Vec<String> {
        corridors::list(&env)
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
        admin::propose_admin(&env, &caller, &candidate)?;
        storage::extend_instance(&env);
        Ok(())
    }

    /// Step 2 of a safe admin handoff: `candidate` accepts the pending proposal
    /// and becomes the new admin.
    pub fn accept_admin(env: Env, candidate: Address) -> Result<(), Error> {
        admin::accept_admin(&env, &candidate)?;
        storage::extend_instance(&env);
        Ok(())
    }

    /// Cancel a pending admin proposal without transferring authority.
    /// Only the current admin may call this.
    pub fn cancel_admin_proposal(env: Env, caller: Address) -> Result<(), Error> {
        admin::cancel_admin_proposal(&env, &caller)?;
        storage::extend_instance(&env);
        Ok(())
    }

    /// Return the pending admin candidate, if any.
    pub fn pending_admin(env: Env) -> Option<Address> {
        admin::get_pending_admin(&env)
    }

    pub fn add_publisher(env: Env, caller: Address, publisher: Address) -> Result<(), Error> {
        admin::require_admin(&env, &caller)?;
        publishers::add(&env, publisher.clone())?;
        storage::extend_instance(&env);
        events::publisher_added(&env, &caller, &publisher);
        Ok(())
    }

    /// Admin-only. Limits `publisher` to the listed corridors, replacing any
    /// earlier scope. A publisher with no scope may write every registered
    /// corridor. Returns `PublisherNotFound` if it is not whitelisted.
    pub fn set_publisher_scope(
        env: Env,
        caller: Address,
        publisher: Address,
        corridors: Vec<String>,
    ) -> Result<(), Error> {
        admin::require_admin(&env, &caller)?;
        if !publishers::is_authorized(&env, &publisher) {
            return Err(Error::PublisherNotFound);
        }
        publishers::set_scope(&env, publisher, corridors);
        storage::extend_instance(&env);
        Ok(())
    }

    /// Admin-only. Removes `publisher`'s scope, restoring full access.
    pub fn clear_publisher_scope(
        env: Env,
        caller: Address,
        publisher: Address,
    ) -> Result<(), Error> {
        admin::require_admin(&env, &caller)?;
        publishers::clear_scope(&env, publisher);
        storage::extend_instance(&env);
        Ok(())
    }

    /// The corridors `publisher` is limited to, or `None` if unscoped.
    pub fn publisher_scope(env: Env, publisher: Address) -> Option<Vec<String>> {
        publishers::get_scope(&env, &publisher)
    }

    pub fn revoke_publisher(env: Env, caller: Address, publisher: Address) -> Result<(), Error> {
        admin::require_admin(&env, &caller)?;
        publishers::revoke(&env, publisher.clone())?;
        storage::extend_instance(&env);
        events::publisher_revoked(&env, &caller, &publisher);
        Ok(())
    }

    /// Admin-only. Clear a corridor's rolling outcome aggregate back to zero —
    /// the recovery path for a corridor whose accumulators were polluted by a
    /// since-revoked publisher.
    pub fn reset_corridor_aggregate(
        env: Env,
        caller: Address,
        anchor_id: String,
        corridor: String,
    ) -> Result<(), Error> {
        admin::require_admin(&env, &caller)?;
        aggregate::reset(&env, &anchor_id, &corridor);
        storage::extend_instance(&env);
        events::aggregate_reset(&env, &caller, &anchor_id, &corridor);
        Ok(())
    }

    /// Admin-only. Clear a corridor's cumulative volume/savings totals.
    pub fn reset_volume_savings(env: Env, caller: Address, corridor: String) -> Result<(), Error> {
        admin::require_admin(&env, &caller)?;
        volume_savings::reset(&env, corridor.clone());
        storage::extend_instance(&env);
        events::volume_reset(&env, &caller, &corridor);
        Ok(())
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
        )?;
        storage::extend_instance(&env);
        Ok(())
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

    /// Admin-signed contract upgrade. Replaces the contract WASM with the code
    /// at `new_wasm_hash` while preserving all stored state, following Soroban's
    /// standard upgrade pattern.
    ///
    /// Time-locked: `propose_upgrade(new_wasm_hash)` must have been called at
    /// least `UPGRADE_DELAY_SECONDS` (7 days) earlier, and `new_wasm_hash` must
    /// match it. Returns `NoPendingUpgrade`, `UpgradeHashMismatch` or
    /// `UpgradeNotReady` otherwise.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        upgrade::apply(&env, new_wasm_hash)
    }

    /// Upgrade-admin only. Announce a WASM upgrade; it can be applied with
    /// `upgrade` once `UPGRADE_DELAY_SECONDS` (7 days) have passed. Replaces any
    /// earlier proposal and restarts the clock.
    pub fn propose_upgrade(
        env: Env,
        caller: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), Error> {
        upgrade::propose_upgrade(&env, &caller, new_wasm_hash)?;
        storage::extend_instance(&env);
        Ok(())
    }

    /// Upgrade-admin only. Withdraw the pending upgrade proposal, if any.
    pub fn cancel_upgrade(env: Env, caller: Address) -> Result<(), Error> {
        upgrade::cancel_upgrade(&env, &caller)?;
        storage::extend_instance(&env);
        Ok(())
    }

    /// The pending upgrade as `(wasm_hash, earliest_execution_timestamp)`, if any.
    pub fn pending_upgrade(env: Env) -> Option<(BytesN<32>, u64)> {
        upgrade::get_pending_upgrade(&env)
    }

    /// Return the live contract version (`0` before `init_upgrade`).
    pub fn contract_version(env: Env) -> u32 {
        upgrade::current_version(&env)
    }

    /// Return the address authorized to upgrade the contract.
    ///
    /// Separate from `admin()` by design — the upgrade authority is its own
    /// key. Exposed so an auditor can confirm the two are distinct accounts
    /// rather than take it on trust (#913).
    pub fn upgrade_admin(env: Env) -> Option<Address> {
        upgrade::get_upgrade_admin(&env)
    }

    /// Nominate a new upgrade administrator (step 1 of 2, issue #963).
    ///
    /// `init_upgrade` is one-shot, so before this the role could never be
    /// changed once bound — a lost key meant the contract could never be
    /// upgraded again, and a compromised one could not be revoked.
    pub fn propose_upgrade_admin(
        env: Env,
        caller: Address,
        candidate: Address,
    ) -> Result<(), Error> {
        upgrade::propose_upgrade_admin(&env, &caller, &candidate)?;
        storage::extend_instance(&env);
        Ok(())
    }

    /// Accept a pending upgrade-admin proposal (step 2 of 2).
    ///
    /// The candidate must call this itself, so a mistyped address fails to
    /// complete rather than bricking the role.
    pub fn accept_upgrade_admin(env: Env, candidate: Address) -> Result<(), Error> {
        upgrade::accept_upgrade_admin(&env, &candidate)?;
        storage::extend_instance(&env);
        Ok(())
    }

    /// Withdraw a pending upgrade-admin proposal. Current upgrade admin only.
    pub fn cancel_upgrade_proposal(env: Env, caller: Address) -> Result<(), Error> {
        upgrade::cancel_upgrade_proposal(&env, &caller)?;
        storage::extend_instance(&env);
        Ok(())
    }

    /// The address nominated to become upgrade admin, if any.
    pub fn pending_upgrade_admin(env: Env) -> Option<Address> {
        upgrade::get_pending_upgrade_admin(&env)
    }

    pub fn get_score_for_corridor(
        env: Env,
        anchor_id: String,
        corridor: String,
    ) -> (i128, i128, u64, u32) {
        score::get_score_for_corridor(&env, anchor_id, corridor)
    }

    /// Publisher-only. Writes the metrics the composite score is derived from.
    // See the note on score::set_corridor_metrics — the argument list is the ABI.
    #[allow(clippy::too_many_arguments)]
    pub fn set_corridor_metrics(
        env: Env,
        publisher: Address,
        anchor_id: String,
        corridor: String,
        fill_rate_bps: i128,
        slippage_bps: i128,
        settle_seconds_p50: u64,
        n: u32,
    ) -> Result<(), Error> {
        score::set_corridor_metrics(
            &env,
            &publisher,
            anchor_id,
            corridor,
            fill_rate_bps,
            slippage_bps,
            settle_seconds_p50,
            n,
        )?;
        storage::extend_instance(&env);
        Ok(())
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
        corridor_rate::publish(&env, &publisher, corridor, rate, decimals)?;
        storage::extend_instance(&env);
        Ok(())
    }

    /// Read the latest published rate for `corridor`, or `None` if unset.
    pub fn get_corridor_rate(env: Env, corridor: String) -> Option<corridor_rate::CorridorRate> {
        corridor_rate::get(&env, corridor)
    }

    /// Admin-only. Removes the published rate for `corridor`, so the next
    /// `publish_corridor_rate` is accepted at any value. This is the recovery
    /// path for a real move of more than 2x, which publish refuses to follow.
    pub fn reset_corridor_rate(env: Env, caller: Address, corridor: String) -> Result<(), Error> {
        admin::require_admin(&env, &caller)?;
        corridor_rate::reset(&env, corridor);
        storage::extend_instance(&env);
        Ok(())
    }

    /// Like `get_corridor_rate`, but only returns a rate published within the
    /// last `max_age_seconds`. `None` covers both "never published" and "too
    /// old": a consumer that cannot use a stale rate does not need to tell the
    /// two apart, and a consumer that does can call `get_corridor_rate`.
    pub fn get_corridor_rate_fresh(
        env: Env,
        corridor: String,
        max_age_seconds: u64,
    ) -> Option<corridor_rate::CorridorRate> {
        corridor_rate::get_fresh(&env, corridor, max_age_seconds)
    }

    // ── V2 entrypoints (multi-corridor expansion, issue #825) ────────────

    /// Migrate a single (anchor_id, corridor) pair from v1 to v2 storage.
    /// Admin-only; idempotent, so it skips pairs that already have v2 data.
    pub fn migrate_corridor_v2(
        env: Env,
        caller: Address,
        anchor_id: String,
        corridor: String,
    ) -> Result<(), Error> {
        migration::migrate_corridor(&env, &caller, anchor_id, corridor)?;
        storage::extend_instance(&env);
        Ok(())
    }

    /// Migrate all registered anchors across all default corridors.
    /// Admin-only; idempotent, so it skips pairs already migrated.
    pub fn migrate_all_v2(env: Env, caller: Address) -> Result<(), Error> {
        migration::migrate_all(&env, &caller)?;
        storage::extend_instance(&env);
        Ok(())
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
        volume_savings::add_volume_savings(
            &env,
            &publisher,
            corridor,
            volume_delta,
            savings_delta,
        )?;
        storage::extend_instance(&env);
        Ok(())
    }

    /// Read the cumulative volume + savings for `corridor`, or `None` if
    /// no data has been published yet.
    pub fn get_volume_savings(env: Env, corridor: String) -> Option<volume_savings::VolumeSavings> {
        volume_savings::get(&env, corridor)
    }
}
