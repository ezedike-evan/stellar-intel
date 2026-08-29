# stellarintel

Python client for the [Stellar Intel](https://stellar-intel.vercel.app) public API: submit an off-ramp intent and get back a routed anchor, a quote ID, and an unsigned Stellar transaction to sign.

Mirrors the TypeScript SDK (#806) for Python consumers. Generated from the hardened OpenAPI v1 spec (`public/openapi.json`, #805) with a hand-written retry + idempotency-key layer on top.

## Install

```bash
pip install stellarintel
```

## Quickstart

```python
from stellarintel import OfframpIntent, StellarIntelApiError, StellarIntelClient

intent = OfframpIntent(
    source_asset="USDC",
    destination_asset="NGN",
    amount="100",
    sender="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    recipient="NGN-BANK-ACCOUNT-123",
)

with StellarIntelClient() as client:
    try:
        result = client.submit_offramp_intent(intent)
    except StellarIntelApiError as err:
        print(f"{err.code}: {err.message}")
    else:
        print(f"Route: {result.route.anchor_id} ({result.route.corridor_id})")
        print(f"Quote ID: {result.quote_id}")
        print(f"Unsigned XDR: {result.unsigned_tx}")
        # Sign result.unsigned_tx with your own Stellar keypair/wallet and
        # submit it to Horizon -- this SDK never holds a signing key.
```

A runnable version of this example is at [`examples/quickstart.py`](examples/quickstart.py).

## Retries and idempotency, by default

`StellarIntelClient.submit_offramp_intent` generates a fresh `Idempotency-Key` per call (a UUID4) unless you pass your own, and reuses that same key across that call's own retries -- so a network blip can never cause the server to build two different unsigned transactions for the same intent.

Transient failures (HTTP 429 and 5xx) are retried automatically, honoring the server's `Retry-After` header when present and falling back to capped exponential backoff otherwise. Validation and routing errors (400) are never retried -- retrying the exact same invalid input would just fail the same way.

```python
# Bring your own idempotency key, e.g. to safely resubmit after your own
# process restarts mid-request:
result = client.submit_offramp_intent(intent, idempotency_key="my-app-request-42")

# Tune retry behavior:
client = StellarIntelClient(max_retries=5, timeout=15.0)
```

## Errors

- `StellarIntelApiError` -- the server returned a structured error (`code`, `message`, and `retry_after` when the code is `RATE_LIMITED`) that was not retried away (a 400, or a 429/5xx that exhausted `max_retries`).
- `StellarIntelRequestError` -- the server returned a status code this SDK doesn't recognize (no `ApiError` body to parse).

## Low-level access

The retry/idempotency wrapper is built on a generated low-level client (`stellarintel.client.Client`, `stellarintel.api.*`, `stellarintel.models.*`) if you need direct access to a single request/response without the wrapper's retry behavior:

```python
from stellarintel import Client
from stellarintel.api.intent.post_api_intent_offramp import sync_detailed
from stellarintel.models.intent_request import IntentRequest
from stellarintel.models.intent_request_type import IntentRequestType

client = Client(base_url="https://stellar-intel.vercel.app")
response = sync_detailed(
    client=client,
    body=IntentRequest(
        type_=IntentRequestType.OFFRAMP,
        source_asset="USDC",
        destination_asset="NGN",
        amount="100",
        sender="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        recipient="NGN-BANK-ACCOUNT-123",
    ),
)
```

## Regenerating the low-level client

Everything under `stellarintel/api/`, `stellarintel/models/`, `stellarintel/client.py`, `stellarintel/errors.py`, and `stellarintel/types.py` is generated from `public/openapi.json` via [`openapi-python-client`](https://github.com/openapi-generators/openapi-python-client) and should never be hand-edited. `stellarintel/wrapper.py` (the retry/idempotency client) and everything under `tests/` and `examples/` are hand-written.

From the repo root, after regenerating `public/openapi.json` (`npm run emit-openapi`):

```bash
pip install openapi-python-client
openapi-python-client generate \
  --path public/openapi.json \
  --output-path /tmp/stellarintel-gen \
  --meta none \
  --config packages/python-sdk/openapi-python-client-config.yml \
  --overwrite
cp -r /tmp/stellarintel-gen/* packages/python-sdk/src/stellarintel/
```

## Development

```bash
cd packages/python-sdk
python -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/pytest
```

## Publishing

This package is not yet published to PyPI. `.github/workflows/publish-python-sdk.yml` builds and publishes on a `python-sdk-v*` tag via PyPI's [trusted publishing](https://docs.pypi.org/trusted-publishers/) (OIDC -- no API token stored in this repo), but it will not work until a maintainer:

1. Registers the `stellarintel` project name on PyPI (or reserves it)
2. Adds this repo/workflow as a trusted publisher for that project
3. Adds a `pypi` GitHub Environment (referenced by the workflow) if repo rules require one

None of that is something a contributor can or should do on the maintainer's behalf, so the first release is a manual follow-up, not part of this change.
