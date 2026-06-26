//! Admin-gated contract upgrade hook (roadmap #197, issue #352).
//!
//! Implements Soroban's standard in-place upgrade pattern: an authorized admin
//! swaps the contract's WASM bytecode via the deployer's
//! `update_current_contract_wasm`. That host operation replaces only the
//! executable code — it never touches the
//! contract's storage entries — so every persisted value (anchor outcomes, the
//! anchor registry, the version stamp) survives the upgrade untouched. A
//! monotonically increasing version is persisted so callers can observe which
//! revision is live.
//!
//! The module owns its admin and version keys outright. This keeps the upgrade
//! authority independent of the wider admin lifecycle that other sub-issues of
//! #197 are still wiring up, so the hook compiles and is testable on its own.

use soroban_sdk::{contracttype, Address, BytesN, Env};

/// Instance-storage keys owned by this module.
///
/// The variant names are intentionally distinct from keys used elsewhere in the
/// contract so the serialized keys can never collide with another module's
/// storage.
#[contracttype]
#[derive(Clone)]
enum UpgradeKey {
    /// Address authorized to upgrade the contract.
    UpgradeAdmin,
    /// Live contract version, bumped on every successful upgrade.
    Version,
}

/// Version stamped on a freshly initialized contract, before any upgrade.
const INITIAL_VERSION: u32 = 1;

/// Bind the upgrade administrator and stamp the initial version.
///
/// One-shot: panics if the upgrade admin has already been set, so the authority
/// cannot be silently rotated by a later caller.
pub fn init(env: &Env, admin: Address) {
    let storage = env.storage().instance();
    if storage.has(&UpgradeKey::UpgradeAdmin) {
        panic!("upgrade admin already initialized");
    }
    storage.set(&UpgradeKey::UpgradeAdmin, &admin);
    storage.set(&UpgradeKey::Version, &INITIAL_VERSION);
}

/// Swap the contract's WASM to `new_wasm_hash`, preserving all stored state.
///
/// Requires the stored upgrade admin's authorization. The persisted version is
/// incremented *before* the swap so the freshly installed bytecode boots on the
/// bumped version.
pub fn apply(env: &Env, new_wasm_hash: BytesN<32>) {
    let storage = env.storage().instance();
    let admin: Address = storage
        .get(&UpgradeKey::UpgradeAdmin)
        .expect("upgrade admin not initialized");

    // Admin-only: reverts unless the stored admin signed this invocation.
    admin.require_auth();

    let next = current_version(env) + 1;
    storage.set(&UpgradeKey::Version, &next);

    env.deployer().update_current_contract_wasm(new_wasm_hash);
}

/// Return the live contract version, or `0` if the upgrade hook is uninitialized.
pub fn current_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&UpgradeKey::Version)
        .unwrap_or(0)
}
