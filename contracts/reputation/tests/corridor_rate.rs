#![cfg(test)]

use reputation::{Error, ReputationContract, ReputationContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

fn setup(env: &Env) -> (ReputationContractClient<'_>, Address, Address) {
    let admin = Address::generate(env);
    let contract_id = env.register(ReputationContract, (admin.clone(), admin.clone()));
    let client = ReputationContractClient::new(env, &contract_id);
    let publisher = Address::generate(env);
    client.add_publisher(&admin, &publisher);
    // Rate writes only accept registered corridors (#1385).
    for corridor in ["usdc-ngn", "usdc-kes", "usdc-mxn", "usdc-php"] {
        client.register_corridor(&admin, &String::from_str(env, corridor));
    }
    (client, admin, publisher)
}

#[test]
fn publisher_can_publish_and_read_all_four_corridors() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);

    let corridors: [(&str, i128); 4] = [
        ("usdc-ngn", 1650_0000000),
        ("usdc-kes", 129_0000000),
        ("usdc-mxn", 17_0000000),
        ("usdc-php", 58_0000000),
    ];

    for (corridor, rate) in corridors {
        let c = String::from_str(&env, corridor);
        client.publish_corridor_rate(&publisher, &c, &rate, &7u32);

        let stored = client.get_corridor_rate(&c).unwrap();
        assert_eq!(stored.rate, rate);
        assert_eq!(stored.decimals, 7);
        assert_eq!(stored.publisher, publisher);
    }
}

#[test]
fn publish_overwrites_the_previous_rate() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);
    let c = String::from_str(&env, "usdc-ngn");

    client.publish_corridor_rate(&publisher, &c, &1600_0000000i128, &7u32);
    client.publish_corridor_rate(&publisher, &c, &1700_0000000i128, &7u32);

    assert_eq!(client.get_corridor_rate(&c).unwrap().rate, 1700_0000000i128);
}

#[test]
fn non_publisher_cannot_publish() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _publisher) = setup(&env);
    let stranger = Address::generate(&env);
    let c = String::from_str(&env, "usdc-ngn");

    let res = client.try_publish_corridor_rate(&stranger, &c, &1650_0000000i128, &7u32);
    assert_eq!(res, Err(Ok(Error::PublisherUnauthorized)));
}

#[test]
fn zero_or_negative_rate_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);
    let c = String::from_str(&env, "usdc-ngn");

    let zero: i128 = 0;
    let negative: i128 = -5;
    assert_eq!(
        client.try_publish_corridor_rate(&publisher, &c, &zero, &7u32),
        Err(Ok(Error::InvalidCorridorRate))
    );
    assert_eq!(
        client.try_publish_corridor_rate(&publisher, &c, &negative, &7u32),
        Err(Ok(Error::InvalidCorridorRate))
    );
}

#[test]
fn unknown_corridor_reads_none() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _publisher) = setup(&env);

    assert_eq!(
        client.get_corridor_rate(&String::from_str(&env, "usdc-xxx")),
        None
    );
}

// ── Freshness-checked read (#1382) ───────────────────────────────────────────

#[test]
fn fresh_read_returns_a_recent_rate() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);
    let c = String::from_str(&env, "usdc-ngn");

    client.publish_corridor_rate(&publisher, &c, &1650_0000000i128, &7u32);
    env.ledger().with_mut(|l| l.timestamp += 60);

    let fresh = client.get_corridor_rate_fresh(&c, &120u64);
    assert_eq!(fresh.unwrap().rate, 1650_0000000i128);
}

#[test]
fn fresh_read_hides_a_stale_rate() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);
    let c = String::from_str(&env, "usdc-ngn");

    client.publish_corridor_rate(&publisher, &c, &1650_0000000i128, &7u32);
    env.ledger().with_mut(|l| l.timestamp += 121);

    assert_eq!(client.get_corridor_rate_fresh(&c, &120u64), None);
    // The plain read is unchanged: it still returns the old rate.
    assert!(client.get_corridor_rate(&c).is_some());
}

#[test]
fn fresh_read_accepts_a_rate_exactly_at_the_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);
    let c = String::from_str(&env, "usdc-ngn");

    client.publish_corridor_rate(&publisher, &c, &1650_0000000i128, &7u32);
    env.ledger().with_mut(|l| l.timestamp += 120);

    assert!(client.get_corridor_rate_fresh(&c, &120u64).is_some());
}

#[test]
fn fresh_read_of_unknown_corridor_is_none() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _publisher) = setup(&env);
    let c = String::from_str(&env, "usdc-xyz");

    assert_eq!(client.get_corridor_rate_fresh(&c, &u64::MAX), None);
}

#[test]
fn max_age_zero_accepts_only_same_timestamp() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);
    let c = String::from_str(&env, "usdc-ngn");

    client.publish_corridor_rate(&publisher, &c, &1650_0000000i128, &7u32);
    assert!(client.get_corridor_rate_fresh(&c, &0u64).is_some());

    env.ledger().with_mut(|l| l.timestamp += 1);
    assert_eq!(client.get_corridor_rate_fresh(&c, &0u64), None);
}

// ── Rate bounds (#1383) ──────────────────────────────────────────────────────

#[test]
fn rate_can_move_up_to_double() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);
    let c = String::from_str(&env, "usdc-ngn");

    client.publish_corridor_rate(&publisher, &c, &1000i128, &7u32);
    client.publish_corridor_rate(&publisher, &c, &2000i128, &7u32);
    assert_eq!(client.get_corridor_rate(&c).unwrap().rate, 2000);
}

#[test]
fn rate_can_move_down_to_half() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);
    let c = String::from_str(&env, "usdc-ngn");

    client.publish_corridor_rate(&publisher, &c, &1000i128, &7u32);
    client.publish_corridor_rate(&publisher, &c, &500i128, &7u32);
    assert_eq!(client.get_corridor_rate(&c).unwrap().rate, 500);
}

#[test]
fn rate_jump_over_double_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);
    let c = String::from_str(&env, "usdc-ngn");

    client.publish_corridor_rate(&publisher, &c, &1000i128, &7u32);
    let res = client.try_publish_corridor_rate(&publisher, &c, &2001i128, &7u32);

    assert_eq!(res, Err(Ok(Error::RateJumpTooLarge)));
    assert_eq!(client.get_corridor_rate(&c).unwrap().rate, 1000);
}

#[test]
fn rate_drop_under_half_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);
    let c = String::from_str(&env, "usdc-ngn");

    client.publish_corridor_rate(&publisher, &c, &1000i128, &7u32);
    let res = client.try_publish_corridor_rate(&publisher, &c, &499i128, &7u32);

    assert_eq!(res, Err(Ok(Error::RateJumpTooLarge)));
    assert_eq!(client.get_corridor_rate(&c).unwrap().rate, 1000);
}

#[test]
fn decimals_over_18_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);
    let c = String::from_str(&env, "usdc-ngn");

    assert_eq!(
        client.try_publish_corridor_rate(&publisher, &c, &1000i128, &19u32),
        Err(Ok(Error::InvalidCorridorRate))
    );
    client.publish_corridor_rate(&publisher, &c, &1000i128, &18u32);
}

#[test]
fn changing_decimals_skips_jump_check() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);
    let c = String::from_str(&env, "usdc-ngn");

    client.publish_corridor_rate(&publisher, &c, &1000i128, &3u32);
    // The same price rescaled to 7 decimals is 10^4 times larger as an integer.
    client.publish_corridor_rate(&publisher, &c, &10_000_000i128, &7u32);
    assert_eq!(client.get_corridor_rate(&c).unwrap().decimals, 7);
}

#[test]
fn doubling_a_rate_near_i128_max_reports_overflow() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);
    let c = String::from_str(&env, "usdc-ngn");

    client.publish_corridor_rate(&publisher, &c, &i128::MAX, &7u32);
    let res = client.try_publish_corridor_rate(&publisher, &c, &1i128, &7u32);
    assert_eq!(res, Err(Ok(Error::ArithmeticOverflow)));
}

#[test]
fn admin_reset_allows_a_fresh_rate() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, publisher) = setup(&env);
    let c = String::from_str(&env, "usdc-ngn");

    client.publish_corridor_rate(&publisher, &c, &1000i128, &7u32);
    client.reset_corridor_rate(&admin, &c);
    assert_eq!(client.get_corridor_rate(&c), None);

    client.publish_corridor_rate(&publisher, &c, &5000i128, &7u32);
    assert_eq!(client.get_corridor_rate(&c).unwrap().rate, 5000);
}

#[test]
fn non_admin_cannot_reset_rate() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, publisher) = setup(&env);
    let c = String::from_str(&env, "usdc-ngn");

    client.publish_corridor_rate(&publisher, &c, &1000i128, &7u32);
    let res = client.try_reset_corridor_rate(&publisher, &c);

    assert_eq!(res, Err(Ok(Error::Unauthorized)));
    assert_eq!(client.get_corridor_rate(&c).unwrap().rate, 1000);
}
