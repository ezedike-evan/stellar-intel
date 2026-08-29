"""
High-level client wrapping the generated low-level API
(stellarintel.api.intent.post_api_intent_offramp).

This module is hand-written, not generated -- it is the retry +
idempotency-key layer issue #821 asked for on top of the generated client.
Everything under stellarintel.api / stellarintel.models / stellarintel.client
is regenerated from public/openapi.json via `openapi-python-client generate`
(see README.md) and should not be edited by hand.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass

import httpx

from .api.intent.post_api_intent_offramp import sync_detailed as _submit_offramp_sync
from .client import Client
from .models.api_error import ApiError
from .models.intent_request import IntentRequest
from .models.intent_request_type import IntentRequestType
from .models.offramp_intent_response import OfframpIntentResponse
from .types import Response, Unset

DEFAULT_BASE_URL = "https://stellar-intel.vercel.app"
DEFAULT_MAX_RETRIES = 3
DEFAULT_TIMEOUT_SECONDS = 10.0

# 429 and 5xx are transient by construction: a rate limit clears once its
# window resets, and a 500 on this endpoint is a transaction-build failure
# that may succeed on a fresh attempt (see the server's own comment on why
# 500s are never cached under an idempotency key).
RETRYABLE_STATUS_CODES = frozenset({429, 500, 502, 503, 504})

# Exponential backoff ceiling when the server doesn't send Retry-After.
_MAX_BACKOFF_SECONDS = 8.0


class StellarIntelApiError(Exception):
    """Raised when the API returns a structured ApiError body that was not retried away."""

    def __init__(self, error: ApiError, status_code: int):
        self.code = error.code
        self.message = error.message
        self.retry_after = None if isinstance(error.retry_after, Unset) else error.retry_after
        self.status_code = status_code
        super().__init__(f"{self.code}: {self.message} (HTTP {status_code})")


class StellarIntelRequestError(Exception):
    """Raised when the server returns a status code this SDK doesn't recognize."""

    def __init__(self, status_code: int):
        self.status_code = status_code
        super().__init__(f"Unexpected status code {status_code} with no ApiError body")


@dataclass
class OfframpIntent:
    """Input to submit_offramp_intent -- mirrors the API's IntentRequest schema."""

    source_asset: str
    destination_asset: str
    amount: str
    sender: str
    recipient: str


def _sleep_before_retry(response: Response, attempt: int) -> None:
    retry_after = response.headers.get('retry-after') if response.headers else None
    if retry_after:
        try:
            time.sleep(float(retry_after))
            return
        except ValueError:
            pass
    time.sleep(min(2**attempt * 0.5, _MAX_BACKOFF_SECONDS))


class StellarIntelClient:
    """
    High-level Stellar Intel API client.

    Every offramp submission carries an Idempotency-Key by default: a fresh
    UUID4 per logical call (pass your own via idempotency_key to control it
    yourself), reused across that one call's own retries so a retried
    request can never be executed twice server-side. Transient failures
    (429, 5xx) are retried with backoff -- honoring the server's
    Retry-After header when present -- up to max_retries times.
    """

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        max_retries: int = DEFAULT_MAX_RETRIES,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._client = Client(base_url=base_url, timeout=httpx.Timeout(timeout))
        self.max_retries = max_retries

    def submit_offramp_intent(
        self,
        intent: OfframpIntent,
        *,
        idempotency_key: str | None = None,
    ) -> OfframpIntentResponse:
        """Submits an off-ramp intent, retrying transient failures under one idempotency key."""
        key = idempotency_key or str(uuid.uuid4())
        body = IntentRequest(
            type_=IntentRequestType.OFFRAMP,
            source_asset=intent.source_asset,
            destination_asset=intent.destination_asset,
            amount=intent.amount,
            sender=intent.sender,
            recipient=intent.recipient,
        )

        for attempt in range(self.max_retries + 1):
            response = _submit_offramp_sync(client=self._client, body=body, idempotency_key=key)

            if response.status_code == 200 and isinstance(response.parsed, OfframpIntentResponse):
                return response.parsed

            status = int(response.status_code)

            # Retry by status code alone, not by whether the body parsed as
            # an ApiError: a 502/503/504 from an intermediary proxy (not
            # this app) won't have one, but is just as transient as a 429
            # or 500 that does.
            if status in RETRYABLE_STATUS_CODES and attempt < self.max_retries:
                _sleep_before_retry(response, attempt)
                continue

            if isinstance(response.parsed, ApiError):
                raise StellarIntelApiError(response.parsed, status)

            raise StellarIntelRequestError(status)

        # Unreachable: the loop above always returns or raises on its last
        # iteration (attempt == max_retries fails the retry condition).
        raise RuntimeError('submit_offramp_intent: exhausted retries without a terminal response')

    def close(self) -> None:
        self._client.get_httpx_client().close()

    def __enter__(self) -> 'StellarIntelClient':
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()
