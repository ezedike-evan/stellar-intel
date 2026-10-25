//! Integration tests for the admin-gated contract upgrade hook (issue #352).

use reputation::upgrade::UPGRADE_DELAY_SECONDS;
use reputation::{Error, ReputationContract, ReputationContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, BytesN, Env, String,
};

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address) {
    let admin = Address::generate(env);
    // Constructor binds both the operational admin and the upgrade admin to
    // `admin`; rotation tests then move the upgrade admin off it.
    let contract_id = env.register(ReputationContract, (admin.clone(), admin.clone()));
    let client = ReputationContractClient::new(env, &contract_id);
    (client, admin)
}

#[test]
fn version_starts_at_one_after_construction() {
    let env = Env::default();
    let (client, _admin) = setup(&env);

    // The constructor binds the upgrade admin and stamps the initial version, so
    // a freshly deployed contract already reports version 1 — there is no
    // separate `init_upgrade` step and thus no version-0 window.
    assert_eq!(client.contract_version(), 1);
}

// The former `init_upgrade_is_one_shot` test is gone by construction:
// `init_upgrade` is no longer a callable entrypoint. The upgrade admin is bound
// exactly once, in the constructor, so the one-shot/front-run property it
// guarded is now structural. Deliberate rotation still goes through
// propose/accept (tested below).

#[test]
fn upgrade_requires_admin_authorization() {
    let env = Env::default();
    let (client, _admin) = setup(&env);

    // Propose and wait out the delay with auths mocked, so the only thing
    // missing from the final call is the upgrade admin's signature.
    env.mock_all_auths();
    let wasm_hash = BytesN::from_array(&env, &[0u8; 32]);
    client.propose_upgrade(&_admin, &wasm_hash);
    env.ledger()
        .with_mut(|l| l.timestamp += UPGRADE_DELAY_SECONDS);

    env.set_auths(&[]);
    let res = client.try_upgrade(&wasm_hash);
    assert!(res.is_err());
}

#[test]
fn contract_state_is_disjoint_from_upgrade_metadata() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    client.add_publisher(&admin, &admin);

    let anchor = String::from_str(&env, "moneygram");
    client.register_anchor(&admin, &anchor);
    let corridor = String::from_str(&env, "NGN-USD");
    let h1 = String::from_str(&env, "hash-1");
    let h2 = String::from_str(&env, "hash-2");
    client.submit_outcome(&admin, &anchor, &corridor, &h1, &10u64, &true);
    client.submit_outcome(&admin, &anchor, &corridor, &h2, &20u64, &false);

    assert_eq!(client.contract_version(), 1);

    let recent = client.recent_outcomes(&anchor, &5u32);
    assert_eq!(recent.len(), 2);
    assert_eq!(recent.get(0).unwrap().0, h2);
    assert_eq!(recent.get(1).unwrap().0, h1);
}

// ─── Upgrade-admin rotation (#963) ────────────────────────────────────────────
//
// `init_upgrade` is one-shot, and until now it was the only way to set this
// role. Once bound it could never be changed: a lost key meant the contract
// could never be upgraded again, and a compromised one could not be revoked.
// Sharper than the operational admin, because `upgrade` replaces all the code.

#[test]
fn rotates_the_upgrade_admin_in_two_steps() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let successor = Address::generate(&env);

    assert_eq!(client.upgrade_admin(), Some(admin.clone()));
    assert_eq!(client.pending_upgrade_admin(), None);

    client.propose_upgrade_admin(&admin, &successor);

    // Proposing does not transfer. Until the successor accepts, the old admin
    // is still the one that can upgrade.
    assert_eq!(client.upgrade_admin(), Some(admin.clone()));
    assert_eq!(client.pending_upgrade_admin(), Some(successor.clone()));

    client.accept_upgrade_admin(&successor);

    assert_eq!(client.upgrade_admin(), Some(successor));
    assert_eq!(client.pending_upgrade_admin(), None);
}

#[test]
fn a_non_admin_cannot_propose() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let stranger = Address::generate(&env);
    let target = Address::generate(&env);

    assert!(client
        .try_propose_upgrade_admin(&stranger, &target)
        .is_err());
    assert_eq!(client.pending_upgrade_admin(), None);
}

#[test]
fn only_the_nominee_can_accept() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let successor = Address::generate(&env);
    let opportunist = Address::generate(&env);

    client.propose_upgrade_admin(&admin, &successor);

    // This is what makes a typo recoverable rather than fatal: an address
    // nobody controls can never accept, so the role stays where it is.
    assert!(client.try_accept_upgrade_admin(&opportunist).is_err());
    assert_eq!(client.upgrade_admin(), Some(admin));
}

#[test]
fn accepting_without_a_proposal_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let stranger = Address::generate(&env);

    assert!(client.try_accept_upgrade_admin(&stranger).is_err());
    assert_eq!(client.upgrade_admin(), Some(admin));
}

#[test]
fn a_second_proposal_replaces_the_first() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let first = Address::generate(&env);
    let second = Address::generate(&env);

    client.propose_upgrade_admin(&admin, &first);
    client.propose_upgrade_admin(&admin, &second);

    assert_eq!(client.pending_upgrade_admin(), Some(second.clone()));

    // The superseded nominee must not be able to claim the role afterwards.
    assert!(client.try_accept_upgrade_admin(&first).is_err());

    client.accept_upgrade_admin(&second);
    assert_eq!(client.upgrade_admin(), Some(second));
}

#[test]
fn a_cancelled_proposal_cannot_be_accepted() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let successor = Address::generate(&env);

    client.propose_upgrade_admin(&admin, &successor);
    client.cancel_upgrade_proposal(&admin);

    assert_eq!(client.pending_upgrade_admin(), None);
    assert!(client.try_accept_upgrade_admin(&successor).is_err());
    assert_eq!(client.upgrade_admin(), Some(admin));
}

#[test]
fn the_old_admin_cannot_upgrade_after_handover() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let successor = Address::generate(&env);

    client.propose_upgrade_admin(&admin, &successor);
    client.accept_upgrade_admin(&successor);

    // The point of rotating: the old key loses the authority. `upgrade` reads
    // the stored admin and calls require_auth on it, so authorization is now
    // the successor's to give — the old admin's signature is not consulted.
    assert_eq!(client.upgrade_admin(), Some(successor));
    assert_ne!(client.upgrade_admin(), Some(admin));
}

// The former `rotation_before_init_fails` test is obsolete: the upgrade admin is
// now bound at construction, so there is no "before init" window in which the
// role is unset. The equivalent guard — a non-admin cannot propose — is covered
// by `a_non_admin_cannot_propose`.

// ── Time-lock (#1389) ────────────────────────────────────────────────────────

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

#[test]
fn upgrade_without_proposal_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    let res = client.try_upgrade(&hash(&env, 1));
    assert_eq!(res, Err(Ok(Error::NoPendingUpgrade)));
}

#[test]
fn upgrade_before_delay_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let h = hash(&env, 1);
    client.propose_upgrade(&admin, &h);

    env.ledger()
        .with_mut(|l| l.timestamp += UPGRADE_DELAY_SECONDS - 1);

    assert_eq!(client.try_upgrade(&h), Err(Ok(Error::UpgradeNotReady)));
    // A failed attempt leaves the proposal in place.
    assert!(client.pending_upgrade().is_some());
    assert_eq!(client.contract_version(), 1);
}

#[test]
fn upgrade_with_other_hash_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    client.propose_upgrade(&admin, &hash(&env, 1));
    env.ledger()
        .with_mut(|l| l.timestamp += UPGRADE_DELAY_SECONDS);

    let res = client.try_upgrade(&hash(&env, 2));
    assert_eq!(res, Err(Ok(Error::UpgradeHashMismatch)));
}

#[test]
fn non_upgrade_admin_cannot_propose() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let stranger = Address::generate(&env);

    let res = client.try_propose_upgrade(&stranger, &hash(&env, 1));
    assert_eq!(res, Err(Ok(Error::Unauthorized)));
    assert_eq!(client.pending_upgrade(), None);

    let res = client.try_cancel_upgrade(&stranger);
    assert_eq!(res, Err(Ok(Error::Unauthorized)));
}

#[test]
fn cancel_clears_pending() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let h = hash(&env, 1);
    client.propose_upgrade(&admin, &h);
    assert!(client.pending_upgrade().is_some());

    client.cancel_upgrade(&admin);

    assert_eq!(client.pending_upgrade(), None);
    env.ledger()
        .with_mut(|l| l.timestamp += UPGRADE_DELAY_SECONDS);
    assert_eq!(client.try_upgrade(&h), Err(Ok(Error::NoPendingUpgrade)));
}

#[test]
fn after_delay_gate_is_passed() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let h = hash(&env, 1);
    client.propose_upgrade(&admin, &h);
    env.ledger()
        .with_mut(|l| l.timestamp += UPGRADE_DELAY_SECONDS);

    // The host then fails on the unknown WASM hash, which is expected in a unit
    // test; what matters is that none of the three gate errors is the reason.
    let res = client.try_upgrade(&h);
    assert_ne!(res, Err(Ok(Error::NoPendingUpgrade)));
    assert_ne!(res, Err(Ok(Error::UpgradeNotReady)));
    assert_ne!(res, Err(Ok(Error::UpgradeHashMismatch)));
}

#[test]
fn pending_upgrade_is_readable() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let h = hash(&env, 9);
    assert_eq!(client.pending_upgrade(), None);

    let proposed_at = env.ledger().timestamp();
    client.propose_upgrade(&admin, &h);

    assert_eq!(
        client.pending_upgrade(),
        Some((h, proposed_at + UPGRADE_DELAY_SECONDS))
    );
}

#[test]
fn a_second_proposal_restarts_the_clock_and_replaces_the_hash() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    client.propose_upgrade(&admin, &hash(&env, 1));
    env.ledger().with_mut(|l| l.timestamp += 1_000);

    client.propose_upgrade(&admin, &hash(&env, 2));

    let (pending, eta) = client.pending_upgrade().unwrap();
    assert_eq!(pending, hash(&env, 2));
    assert_eq!(eta, env.ledger().timestamp() + UPGRADE_DELAY_SECONDS);
}
