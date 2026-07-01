//! Table-driven authorization matrix for the reputation contract (issue #353).

use reputation::{ReputationContract, ReputationContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

#[derive(Clone, Copy)]
enum Caller {
    Admin,
    Publisher,
    ThirdParty,
}

impl Caller {
    fn label(self) -> &'static str {
        match self {
            Caller::Admin => "admin",
            Caller::Publisher => "publisher",
            Caller::ThirdParty => "third-party",
        }
    }
}

#[derive(Clone, Copy)]
enum Entrypoint {
    SubmitOutcome,
    RecentOutcomes,
}

impl Entrypoint {
    fn label(self) -> &'static str {
        match self {
            Entrypoint::SubmitOutcome => "submit_outcome",
            Entrypoint::RecentOutcomes => "recent_outcomes",
        }
    }
}

struct Case {
    caller: Caller,
    entrypoint: Entrypoint,
    authorized: bool,
    expect_ok: bool,
}

const MATRIX: &[Case] = &[
    Case { caller: Caller::Admin,      entrypoint: Entrypoint::SubmitOutcome,  authorized: true,  expect_ok: true },
    Case { caller: Caller::Publisher,  entrypoint: Entrypoint::SubmitOutcome,  authorized: true,  expect_ok: true },
    Case { caller: Caller::ThirdParty, entrypoint: Entrypoint::SubmitOutcome,  authorized: false, expect_ok: false },
    Case { caller: Caller::Admin,      entrypoint: Entrypoint::RecentOutcomes, authorized: true,  expect_ok: true },
    Case { caller: Caller::Publisher,  entrypoint: Entrypoint::RecentOutcomes, authorized: true,  expect_ok: true },
    Case { caller: Caller::ThirdParty, entrypoint: Entrypoint::RecentOutcomes, authorized: false, expect_ok: true },
];

#[test]
fn permission_matrix() {
    for case in MATRIX {
        let env = Env::default();
        let contract_id = env.register(ReputationContract, ());
        let client = ReputationContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let publisher = Address::generate(&env);
        let third_party = Address::generate(&env);

        let caller = match case.caller {
            Caller::Admin => &admin,
            Caller::Publisher => &publisher,
            Caller::ThirdParty => &third_party,
        };

        env.mock_all_auths();
        client.init(&admin);
        client.add_publisher(&admin, &admin);
        client.add_publisher(&admin, &publisher);

        if !case.authorized {
            env.set_auths(&[]);
        }

        let anchor = String::from_str(&env, "moneygram");
        let corridor = String::from_str(&env, "NGN-USD");

        let ok = match case.entrypoint {
            Entrypoint::SubmitOutcome => {
                let hash = String::from_str(&env, "0xoutcome");
                client
                    .try_submit_outcome(caller, &anchor, &corridor, &hash, &42u64, &true)
                    .is_ok()
            }
            Entrypoint::RecentOutcomes => client.try_recent_outcomes(&anchor, &5u32).is_ok(),
        };

        assert_eq!(
            ok,
            case.expect_ok,
            "caller={} entrypoint={} authorized={}: expected_ok={} but got_ok={}",
            case.caller.label(),
            case.entrypoint.label(),
            case.authorized,
            case.expect_ok,
            ok,
        );
    }
}
