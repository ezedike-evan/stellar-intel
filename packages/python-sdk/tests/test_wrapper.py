"""
Tests for the hand-written retry/idempotency wrapper (stellarintel.wrapper).
Mocks the HTTP boundary via pytest-httpx -- no real network calls.
"""

import pytest

from stellarintel import OfframpIntent, StellarIntelApiError, StellarIntelClient

BASE_URL = "https://stellar-intel.example"

INTENT = OfframpIntent(
    source_asset="USDC",
    destination_asset="NGN",
    amount="100",
    sender="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    recipient="NGN-BANK-ACCOUNT-123",
)

SUCCESS_BODY = {
    "route": {
        "anchorId": "cowrie",
        "anchorDomain": "cowrie.exchange",
        "corridorId": "usdc-ngn",
        "estimatedFee": "2",
        "estimatedReceived": "0",
    },
    "unsignedTx": "AAAAAgAAAAA=",
    "quoteId": "a" * 64,
}


def test_submit_offramp_intent_success(httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url=f"{BASE_URL}/api/intent/offramp",
        json=SUCCESS_BODY,
        status_code=200,
    )

    with StellarIntelClient(base_url=BASE_URL) as client:
        result = client.submit_offramp_intent(INTENT)

    assert result.quote_id == SUCCESS_BODY["quoteId"]
    assert result.route.anchor_id == "cowrie"


def test_reuses_the_same_idempotency_key_across_retries(httpx_mock):
    # First attempt: a transient 503. Second attempt: success.
    httpx_mock.add_response(method="POST", url=f"{BASE_URL}/api/intent/offramp", status_code=503, json={
        "code": "UPSTREAM_UNAVAILABLE",
        "message": "temporarily unavailable",
    })
    httpx_mock.add_response(method="POST", url=f"{BASE_URL}/api/intent/offramp", status_code=200, json=SUCCESS_BODY)

    with StellarIntelClient(base_url=BASE_URL, max_retries=1) as client:
        result = client.submit_offramp_intent(INTENT, idempotency_key="fixed-key")

    assert result.quote_id == SUCCESS_BODY["quoteId"]

    requests = httpx_mock.get_requests()
    assert len(requests) == 2
    keys = [req.headers.get("idempotency-key") for req in requests]
    assert keys == ["fixed-key", "fixed-key"]


def test_generates_a_fresh_idempotency_key_by_default(httpx_mock):
    httpx_mock.add_response(method="POST", url=f"{BASE_URL}/api/intent/offramp", status_code=200, json=SUCCESS_BODY)

    with StellarIntelClient(base_url=BASE_URL) as client:
        client.submit_offramp_intent(INTENT)

    request = httpx_mock.get_requests()[0]
    key = request.headers.get("idempotency-key")
    assert key  # a UUID4 was generated
    assert len(key) == 36


def test_raises_after_exhausting_retries_on_persistent_5xx(httpx_mock):
    for _ in range(3):
        httpx_mock.add_response(method="POST", url=f"{BASE_URL}/api/intent/offramp", status_code=500, json={
            "code": "TX_BUILD_FAILED",
            "message": "failed to build transaction",
        })

    with StellarIntelClient(base_url=BASE_URL, max_retries=2) as client:
        with pytest.raises(StellarIntelApiError) as exc_info:
            client.submit_offramp_intent(INTENT)

    assert exc_info.value.code == "TX_BUILD_FAILED"
    assert exc_info.value.status_code == 500
    assert len(httpx_mock.get_requests()) == 3  # initial attempt + 2 retries


def test_does_not_retry_a_validation_error(httpx_mock):
    httpx_mock.add_response(method="POST", url=f"{BASE_URL}/api/intent/offramp", status_code=400, json={
        "code": "VALIDATION_ERROR",
        "message": "amount must be a positive decimal string",
    })

    with StellarIntelClient(base_url=BASE_URL, max_retries=3) as client:
        with pytest.raises(StellarIntelApiError) as exc_info:
            client.submit_offramp_intent(INTENT)

    assert exc_info.value.code == "VALIDATION_ERROR"
    assert len(httpx_mock.get_requests()) == 1  # 400s are not retried


def test_retries_a_429_and_honors_retry_after_header(monkeypatch, httpx_mock):
    sleep_calls = []
    monkeypatch.setattr("stellarintel.wrapper.time.sleep", lambda seconds: sleep_calls.append(seconds))

    httpx_mock.add_response(
        method="POST",
        url=f"{BASE_URL}/api/intent/offramp",
        status_code=429,
        headers={"Retry-After": "7"},
        json={"code": "RATE_LIMITED", "message": "Too many requests", "retryAfter": 7},
    )
    httpx_mock.add_response(method="POST", url=f"{BASE_URL}/api/intent/offramp", status_code=200, json=SUCCESS_BODY)

    with StellarIntelClient(base_url=BASE_URL, max_retries=1) as client:
        result = client.submit_offramp_intent(INTENT)

    assert result.quote_id == SUCCESS_BODY["quoteId"]
    assert sleep_calls == [7.0]
