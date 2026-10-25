//! Tests for recent_outcomes function

use reputation::{Error, ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address) {
    let admin = Address::generate(env);
    let contract_id = env.register(ReputationContract, (admin.clone(), admin.clone()));
    let client = ReputationContractClient::new(env, &contract_id);
    (client, admin)
}

#[test]
fn test_recent_outcomes() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    client.add_publisher(&admin, &admin);

    let anchor = String::from_str(&env, "testanchor");
    client.register_anchor(&admin, &anchor);
    let corridor = String::from_str(&env, "NGN-USD");

    for i in 0..5 {
        let hash = String::from_str(&env, &format!("hash{}", i));
        let settle = 10 + i as u64;
        let success = i % 2 == 0;
        client.submit_outcome(&admin, &anchor, &corridor, &hash, &settle, &success);
    }

    let recent = client.recent_outcomes(&anchor, &3);
    assert_eq!(recent.len(), 3);
    let expected_hashes = ["hash4", "hash3", "hash2"];
    for (idx, (hash, settle, success)) in recent.iter().enumerate() {
        assert_eq!(hash, String::from_str(&env, expected_hashes[idx]));
        assert_eq!(settle, 14 - idx as u64);
        assert_eq!(success, (4 - idx) % 2 == 0);
    }
}

// ── reset_outcome_history (#1393) ────────────────────────────────────────────

/// An admin who is also a publisher, with `anchor` registered.
fn ready(env: &Env) -> (ReputationContractClient<'_>, Address, String, String) {
    env.mock_all_auths();
    let (client, admin) = setup(env);
    client.add_publisher(&admin, &admin);
    let anchor = String::from_str(env, "testanchor");
    client.register_anchor(&admin, &anchor);
    (client, admin, anchor, String::from_str(env, "NGN-USD"))
}

fn submit(
    env: &Env,
    client: &ReputationContractClient<'_>,
    who: &Address,
    anchor: &String,
    corridor: &String,
    i: u32,
) {
    let hash = String::from_str(env, &format!("hash{}", i));
    client.submit_outcome(who, anchor, corridor, &hash, &(i as u64), &true);
}

#[test]
fn reset_hides_old_outcomes() {
    let env = Env::default();
    let (client, admin, anchor, corridor) = ready(&env);
    // 30 crosses a page boundary (25 per page), so two pages are hidden.
    for i in 0..30 {
        submit(&env, &client, &admin, &anchor, &corridor, i);
    }
    assert_eq!(client.recent_outcomes(&anchor, &100u32).len(), 30);

    client.reset_outcome_history(&admin, &anchor);

    assert_eq!(client.recent_outcomes(&anchor, &100u32).len(), 0);
}

#[test]
fn new_outcomes_after_reset_are_visible() {
    let env = Env::default();
    let (client, admin, anchor, corridor) = ready(&env);
    for i in 0..30 {
        submit(&env, &client, &admin, &anchor, &corridor, i);
    }
    client.reset_outcome_history(&admin, &anchor);

    for i in 100..103 {
        submit(&env, &client, &admin, &anchor, &corridor, i);
    }

    let recent = client.recent_outcomes(&anchor, &100u32);
    assert_eq!(recent.len(), 3);
    let hashes: std::vec::Vec<String> = recent.iter().map(|(h, _, _)| h).collect();
    assert_eq!(
        hashes,
        [
            String::from_str(&env, "hash102"),
            String::from_str(&env, "hash101"),
            String::from_str(&env, "hash100"),
        ]
    );
}

#[test]
fn history_fills_more_pages_after_a_reset() {
    let env = Env::default();
    let (client, admin, anchor, corridor) = ready(&env);
    submit(&env, &client, &admin, &anchor, &corridor, 0);
    client.reset_outcome_history(&admin, &anchor);

    // 30 more after the reset: crosses a page boundary again, and none of the
    // hidden outcome is ever returned.
    for i in 1..=30 {
        submit(&env, &client, &admin, &anchor, &corridor, i);
    }

    let recent = client.recent_outcomes(&anchor, &100u32);
    assert_eq!(recent.len(), 30);
    assert_eq!(recent.get(0).unwrap().0, String::from_str(&env, "hash30"));
    assert_eq!(recent.get(29).unwrap().0, String::from_str(&env, "hash1"));
}

#[test]
fn a_second_reset_hides_what_the_first_left_visible() {
    let env = Env::default();
    let (client, admin, anchor, corridor) = ready(&env);
    submit(&env, &client, &admin, &anchor, &corridor, 0);
    client.reset_outcome_history(&admin, &anchor);
    submit(&env, &client, &admin, &anchor, &corridor, 1);
    assert_eq!(client.recent_outcomes(&anchor, &10u32).len(), 1);

    client.reset_outcome_history(&admin, &anchor);

    assert_eq!(client.recent_outcomes(&anchor, &10u32).len(), 0);
}

#[test]
fn non_admin_cannot_reset_history() {
    let env = Env::default();
    let (client, admin, anchor, corridor) = ready(&env);
    submit(&env, &client, &admin, &anchor, &corridor, 0);
    let stranger = Address::generate(&env);

    let res = client.try_reset_outcome_history(&stranger, &anchor);

    assert_eq!(res, Err(Ok(Error::Unauthorized)));
    assert_eq!(client.recent_outcomes(&anchor, &10u32).len(), 1);
}

#[test]
fn reset_of_unknown_anchor_is_harmless() {
    let env = Env::default();
    let (client, admin, anchor, corridor) = ready(&env);
    let unknown = String::from_str(&env, "never-seen");

    client.reset_outcome_history(&admin, &unknown);
    assert_eq!(client.recent_outcomes(&unknown, &10u32).len(), 0);

    // Other anchors are untouched, and the unknown one can still be used once registered.
    submit(&env, &client, &admin, &anchor, &corridor, 0);
    assert_eq!(client.recent_outcomes(&anchor, &10u32).len(), 1);
    client.register_anchor(&admin, &unknown);
    submit(&env, &client, &admin, &unknown, &corridor, 1);
    assert_eq!(client.recent_outcomes(&unknown, &10u32).len(), 1);
}
