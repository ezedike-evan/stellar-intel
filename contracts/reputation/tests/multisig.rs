//! Tests for two-step admin transfer and multisig governance (#829).
//!
//! The contract stores a single `Address` as admin. That address may be a
//! Stellar multisig account; `require_auth()` delegates threshold checks to
//! the host. These tests verify the propose/accept/cancel handoff flow using
//! the Soroban test environment's mock-auth helpers.

use reputation::{ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env};

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address) {
    let admin = Address::generate(env);
    // Bind both the operational admin and the upgrade admin to `admin` at
    // construction; tests that need a distinct upgrade admin register directly.
    let contract_id = env.register(ReputationContract, (admin.clone(), admin.clone()));
    let client = ReputationContractClient::new(env, &contract_id);
    env.mock_all_auths();
    (client, admin)
}

// ─── propose_admin ────────────────────────────────────────────────────────────

#[test]
fn propose_admin_stores_pending_candidate() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let candidate = Address::generate(&env);

    env.mock_all_auths();
    client.propose_admin(&admin, &candidate);

    assert_eq!(client.pending_admin(), Some(candidate));
}

#[test]
fn propose_admin_requires_current_admin() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let interloper = Address::generate(&env);
    let candidate = Address::generate(&env);

    env.mock_all_auths();
    let res = client.try_propose_admin(&interloper, &candidate);
    assert!(res.is_err());
}

#[test]
fn second_proposal_replaces_first_candidate() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let first = Address::generate(&env);
    let second = Address::generate(&env);

    env.mock_all_auths();
    client.propose_admin(&admin, &first);
    client.propose_admin(&admin, &second);

    assert_eq!(client.pending_admin(), Some(second));
}

// ─── accept_admin ─────────────────────────────────────────────────────────────

#[test]
fn accept_admin_transfers_authority() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let candidate = Address::generate(&env);

    env.mock_all_auths();
    client.propose_admin(&admin, &candidate);
    client.accept_admin(&candidate);

    assert_eq!(client.admin(), Some(candidate.clone()));
    assert_eq!(client.pending_admin(), None);

    // Old admin can no longer perform admin actions
    let anchor = soroban_sdk::String::from_str(&env, "test-anchor");
    let res = client.try_register_anchor(&admin, &anchor);
    assert!(res.is_err());

    // New admin can
    let res2 = client.try_register_anchor(&candidate, &anchor);
    assert!(res2.is_ok());
}

#[test]
fn accept_admin_requires_matching_candidate() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let candidate = Address::generate(&env);
    let wrong = Address::generate(&env);

    env.mock_all_auths();
    client.propose_admin(&admin, &candidate);

    let res = client.try_accept_admin(&wrong);
    assert!(res.is_err());
    // Admin unchanged
    assert_eq!(client.admin(), Some(admin));
}

#[test]
fn accept_admin_fails_with_no_proposal() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    let anyone = Address::generate(&env);

    env.mock_all_auths();
    let res = client.try_accept_admin(&anyone);
    assert!(res.is_err());
}

// ─── cancel_admin_proposal ────────────────────────────────────────────────────

#[test]
fn cancel_clears_pending_admin() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let candidate = Address::generate(&env);

    env.mock_all_auths();
    client.propose_admin(&admin, &candidate);
    assert!(client.pending_admin().is_some());

    client.cancel_admin_proposal(&admin);
    assert_eq!(client.pending_admin(), None);
}

#[test]
fn cancel_requires_current_admin() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let candidate = Address::generate(&env);
    let interloper = Address::generate(&env);

    env.mock_all_auths();
    client.propose_admin(&admin, &candidate);

    let res = client.try_cancel_admin_proposal(&interloper);
    assert!(res.is_err());
    // Proposal still live
    assert!(client.pending_admin().is_some());
}

#[test]
fn cancel_is_noop_with_no_pending_proposal() {
    let env = Env::default();
    let (client, admin) = setup(&env);

    env.mock_all_auths();
    // No proposal exists — should succeed without error
    let res = client.try_cancel_admin_proposal(&admin);
    assert!(res.is_ok());
    assert_eq!(client.pending_admin(), None);
}

// ─── Custody auditability (#913) ──────────────────────────────────────────────
//
// Multisig governance needs no contract change: the admin is an `Address`, so
// it may be a Stellar account with several signers and a threshold, and
// `require_auth()` delegates the threshold check to the host. What was missing
// is any way to *confirm* how a deployed contract is configured.

#[test]
fn upgrade_admin_is_readable() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let upgrade_admin = Address::generate(&env);
    // Bind a distinct upgrade admin at construction.
    let contract_id = env.register(ReputationContract, (admin.clone(), upgrade_admin.clone()));
    let client = ReputationContractClient::new(&env, &contract_id);

    assert_eq!(client.upgrade_admin(), Some(upgrade_admin.clone()));
    // The point of the accessor: an auditor can see that the upgrade authority
    // is a different account from the operational admin, rather than trusting
    // an assertion that it is.
    assert_ne!(client.upgrade_admin(), Some(admin));
}

#[test]
fn upgrade_admin_and_admin_can_be_the_same_account_and_it_shows() {
    let env = Env::default();
    // setup binds both roles to the same account.
    let (client, _admin) = setup(&env);

    // The contract permits it; the accessor makes it visible rather than
    // silent, which is the whole point for a mainnet pre-flight check.
    assert_eq!(client.upgrade_admin(), client.admin());
}
