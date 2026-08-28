from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ...client import AuthenticatedClient, Client
from ...types import Response, UNSET
from ... import errors

from ...models.api_error import ApiError
from ...models.intent_request import IntentRequest
from ...models.offramp_intent_response import OfframpIntentResponse
from ...types import UNSET, Unset
from typing import cast



def _get_kwargs(
    *,
    body: IntentRequest,
    idempotency_key: str | Unset = UNSET,

) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(idempotency_key, Unset):
        headers["Idempotency-Key"] = idempotency_key



    

    

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/intent/offramp",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs



def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> ApiError | OfframpIntentResponse | None:
    if response.status_code == 200:
        response_200 = OfframpIntentResponse.from_dict(response.json())



        return response_200

    if response.status_code == 400:
        response_400 = ApiError.from_dict(response.json())



        return response_400

    if response.status_code == 429:
        response_429 = ApiError.from_dict(response.json())



        return response_429

    if response.status_code == 500:
        response_500 = ApiError.from_dict(response.json())



        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[ApiError | OfframpIntentResponse]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: IntentRequest,
    idempotency_key: str | Unset = UNSET,

) -> Response[ApiError | OfframpIntentResponse]:
    """ Submit an off-ramp intent

     Resolves an anchor route for the given asset corridor, builds an unsigned Stellar payment
    transaction, and returns a quote ID. Every response carries an `API-Version` header and
    `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers. Send an `Idempotency-
    Key` header to safely retry: a repeated key within 24h replays the original response (flagged with
    `Idempotency-Replayed: true`) instead of re-executing the request. Only 200 and 400 responses are
    cached under a key; a 500 is never cached, so a retry with the same key will try again.

    Args:
        idempotency_key (str | Unset): Client-generated key. A repeated value within 24h replays
            the original response.
        body (IntentRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | OfframpIntentResponse]
     """


    kwargs = _get_kwargs(
        body=body,
idempotency_key=idempotency_key,

    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)

def sync(
    *,
    client: AuthenticatedClient | Client,
    body: IntentRequest,
    idempotency_key: str | Unset = UNSET,

) -> ApiError | OfframpIntentResponse | None:
    """ Submit an off-ramp intent

     Resolves an anchor route for the given asset corridor, builds an unsigned Stellar payment
    transaction, and returns a quote ID. Every response carries an `API-Version` header and
    `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers. Send an `Idempotency-
    Key` header to safely retry: a repeated key within 24h replays the original response (flagged with
    `Idempotency-Replayed: true`) instead of re-executing the request. Only 200 and 400 responses are
    cached under a key; a 500 is never cached, so a retry with the same key will try again.

    Args:
        idempotency_key (str | Unset): Client-generated key. A repeated value within 24h replays
            the original response.
        body (IntentRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | OfframpIntentResponse
     """


    return sync_detailed(
        client=client,
body=body,
idempotency_key=idempotency_key,

    ).parsed

async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: IntentRequest,
    idempotency_key: str | Unset = UNSET,

) -> Response[ApiError | OfframpIntentResponse]:
    """ Submit an off-ramp intent

     Resolves an anchor route for the given asset corridor, builds an unsigned Stellar payment
    transaction, and returns a quote ID. Every response carries an `API-Version` header and
    `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers. Send an `Idempotency-
    Key` header to safely retry: a repeated key within 24h replays the original response (flagged with
    `Idempotency-Replayed: true`) instead of re-executing the request. Only 200 and 400 responses are
    cached under a key; a 500 is never cached, so a retry with the same key will try again.

    Args:
        idempotency_key (str | Unset): Client-generated key. A repeated value within 24h replays
            the original response.
        body (IntentRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[ApiError | OfframpIntentResponse]
     """


    kwargs = _get_kwargs(
        body=body,
idempotency_key=idempotency_key,

    )

    response = await client.get_async_httpx_client().request(
        **kwargs
    )

    return _build_response(client=client, response=response)

async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: IntentRequest,
    idempotency_key: str | Unset = UNSET,

) -> ApiError | OfframpIntentResponse | None:
    """ Submit an off-ramp intent

     Resolves an anchor route for the given asset corridor, builds an unsigned Stellar payment
    transaction, and returns a quote ID. Every response carries an `API-Version` header and
    `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers. Send an `Idempotency-
    Key` header to safely retry: a repeated key within 24h replays the original response (flagged with
    `Idempotency-Replayed: true`) instead of re-executing the request. Only 200 and 400 responses are
    cached under a key; a 500 is never cached, so a retry with the same key will try again.

    Args:
        idempotency_key (str | Unset): Client-generated key. A repeated value within 24h replays
            the original response.
        body (IntentRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        ApiError | OfframpIntentResponse
     """


    return (await asyncio_detailed(
        client=client,
body=body,
idempotency_key=idempotency_key,

    )).parsed
