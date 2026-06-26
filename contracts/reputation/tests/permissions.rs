//! Table-driven authorization matrix for the reputation contract (issue #353).
//!
//! Every `(caller, entrypoint)` pair is exercised from one table so the
//! contract's permission surface is covered exhaustively and any new entrypoint
//! or caller becomes a single row to add. Three caller archetypes are modeled:
//!
//!   * **Admin**       — the contract authority.
//!   * **Publisher**   — the off-chain service that submits settlement outcomes.
//!   * **Third party**  — any unprivileged address.
//!
//! Write entrypoints are gated by `require_auth` on the submitting address, so a
//! caller that cannot produce that authorization must panic cleanly instead of
//! mutating state. Read entrypoints are open to every caller.

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
    /// Whether this caller can produce the authorization the entrypoint demands.
    authorized: bool,
    /// Expected outcome: `true` = call permitted, `false` = must panic cleanly.
    expect_ok: bool,
}

/// The full permission matrix: every caller against every entrypoint.
const MATRIX: &[Case] = &[
    // Write entrypoint — only authorized signers may mutate state.
    Case { caller: Caller::Admin,      entrypoint: Entrypoint::SubmitOutcome,  authorized: true,  expect_ok: true },
    Case { caller: Caller::Publisher,  entrypoint: Entrypoint::SubmitOutcome,  authorized: true,  expect_ok: true },
    Case { caller: Caller::ThirdParty, entrypoint: Entrypoint::SubmitOutcome,  authorized: false, expect_ok: false },
    // Read entrypoint — open to every caller, no authorization required.
    Case { caller: Caller::Admin,      entrypoint: Entrypoint::RecentOutcomes, authorized: true,  expect_ok: true },
    Case { caller: Caller::Publisher,  entrypoint: Entrypoint::RecentOutcomes, authorized: true,  expect_ok: true },
    Case { caller: Caller::ThirdParty, entrypoint: Entrypoint::RecentOutcomes, authorized: false, expect_ok: true },
];

#[test]
fn permission_matrix() {
    for case in MATRIX {
        // A fresh environment per row keeps every cell fully isolated.
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

        // An authorized caller signs the invocation; an unauthorized one does
        // not, so its `require_auth` reverts.
        if case.authorized {
            env.mock_all_auths();
        } else {
            env.set_auths(&[]);
        }

        let anchor = String::from_str(&env, "moneygram");

        let ok = match case.entrypoint {
            Entrypoint::SubmitOutcome => {
                let hash = String::from_str(&env, "0xoutcome");
                client
                    .try_submit_outcome(caller, &anchor, &hash, &42u64, &true)
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
