//! Wire-shape tests (#868).
//!
//! These fixtures are copied from `public/openapi.json`'s schemas. The client
//! is only useful if it can decode what the API actually sends, and a silent
//! rename is exactly the kind of break that shows up at a consumer's runtime
//! rather than in CI.

use stellar_intel_client::{
    AnchorHealth, AnchorStatus, Error, OfframpIntentResponse, RateComparison,
};

#[test]
fn decodes_a_rate_comparison() {
    let json = r#"{
        "corridorId": "usdc-ngn",
        "pending": false,
        "bestRateId": "cowrie",
        "rates": [{
            "anchorId": "cowrie",
            "anchorName": "Cowrie",
            "corridorId": "usdc-ngn",
            "fee": "2",
            "feeType": "flat",
            "exchangeRate": "1580",
            "totalReceived": "154840",
            "updatedAt": "2026-08-05T00:00:00.000Z",
            "source": "sep24-fee"
        }]
    }"#;

    let parsed: RateComparison = serde_json::from_str(json).unwrap();

    assert_eq!(parsed.corridor_id, "usdc-ngn");
    assert_eq!(parsed.best_rate_id.as_deref(), Some("cowrie"));
    assert_eq!(parsed.rates.len(), 1);
    assert_eq!(parsed.rates[0].exchange_rate, "1580");
    // Optional fields absent from the payload must not fail the decode.
    assert!(parsed.rates[0].quote_id.is_none());
    assert!(parsed.errors.is_empty());
}

#[test]
fn decodes_a_comparison_with_no_winner() {
    // Every anchor failed. `bestRateId` is null, and that is a valid state
    // rather than an error — the caller decides what to do about it.
    let json = r#"{
        "corridorId": "usdc-kes",
        "pending": false,
        "bestRateId": null,
        "rates": [],
        "errors": [{ "anchorId": "x", "anchorName": "X", "reason": "timeout" }]
    }"#;

    let parsed: RateComparison = serde_json::from_str(json).unwrap();

    assert!(parsed.best_rate_id.is_none());
    assert_eq!(parsed.errors.len(), 1);
    assert_eq!(parsed.errors[0].reason, "timeout");
}

#[test]
fn decodes_an_offramp_intent_response() {
    let json = r#"{
        "route": {
            "anchorId": "cowrie",
            "anchorDomain": "cowrie.exchange",
            "corridorId": "usdc-ngn",
            "estimatedFee": "2",
            "estimatedReceived": "154840"
        },
        "unsignedTx": "AAAAAgAAAA…",
        "quoteId": "9f2b"
    }"#;

    let parsed: OfframpIntentResponse = serde_json::from_str(json).unwrap();

    assert_eq!(parsed.route.anchor_domain, "cowrie.exchange");
    assert_eq!(parsed.quote_id, "9f2b");
    // The name is load-bearing: nothing moves until the caller signs this.
    assert!(parsed.unsigned_tx.starts_with("AAAA"));
}

#[test]
fn decodes_every_anchor_status() {
    for (raw, expected) in [
        ("ok", AnchorStatus::Ok),
        ("fail", AnchorStatus::Fail),
        ("unknown", AnchorStatus::Unknown),
        ("stale", AnchorStatus::Stale),
    ] {
        let json = format!(
            r#"{{"anchorId":"a","status":"{raw}","consecutiveFailures":0,
                 "degraded":false,"lastCheckedAt":null,"lastError":null,"stale":false}}"#
        );
        let parsed: AnchorHealth = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.status, expected, "status {raw} did not round-trip");
    }
}

#[test]
fn decodes_a_never_checked_anchor() {
    let json = r#"{
        "anchorId": "newanchor",
        "status": "unknown",
        "consecutiveFailures": 0,
        "degraded": false,
        "lastCheckedAt": null,
        "lastError": null,
        "stale": false
    }"#;

    let parsed: AnchorHealth = serde_json::from_str(json).unwrap();

    assert_eq!(parsed.status, AnchorStatus::Unknown);
    assert!(parsed.last_checked_at.is_none());
}

#[test]
fn api_error_exposes_its_code_and_status() {
    let error = Error::Api {
        code: "NO_ROUTE".into(),
        message: "no anchor serves this corridor".into(),
        request_id: "req-1".into(),
        status: 400,
    };

    // A caller branches on `code`, not on the message text.
    assert_eq!(error.code(), Some("NO_ROUTE"));
    assert_eq!(error.status(), Some(400));
}

#[test]
fn response_error_has_no_code() {
    let error = Error::Response {
        status: 502,
        body: "<html>bad gateway</html>".into(),
    };

    assert_eq!(error.code(), None);
    assert_eq!(error.status(), Some(502));
}
