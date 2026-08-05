# stellar-intel-client

REST client for the [Stellar Intel](https://github.com/ezedike-evan/stellar-intel)
API. Async, `std`, built on `reqwest`. Retries and idempotency keys are **on by
default**, not opt-in.

> **Not yet published to crates.io.** Publishing needs `CARGO_REGISTRY_TOKEN`
> configured for this repository — a human step, not a code one.

## Which crate do I want?

| Crate                                                     | Use it when                                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **`stellar-intel-client`** (this one)                     | You are writing an ordinary Rust program that calls the HTTP API.                               |
| [`stellar-intel-reputation`](../stellar-intel-reputation) | You are writing a **Soroban contract** that reads the oracle directly, with no HTTP round trip. |

They are deliberately separate crates rather than one crate with features.
`stellar-intel-reputation` is `#![no_std]` and is linked into wasm32 contracts;
`reqwest` and `tokio` cannot compile there. Feature-gating an `std` half would
mean every contract author has to remember to disable a default — so the
dependency graph stays clean by construction instead.

## Usage

```rust,no_run
use stellar_intel_client::{Client, OfframpIntent};

# async fn run() -> Result<(), stellar_intel_client::Error> {
let client = Client::new();

// Compare rates across every registered anchor.
let comparison = client.get_rates("usdc-ngn").await?;
if let Some(best) = comparison.best_rate_id.as_deref() {
    println!("best anchor: {best}");
}

// Submit an intent. The response carries an *unsigned* transaction —
// nothing moves until you sign and submit it. This crate never holds a key.
let response = client
    .submit_offramp_intent(&OfframpIntent {
        source_asset: "USDC".into(),
        destination_asset: "NGN".into(),
        amount: "100".into(),
        sender: "GABC…".into(),
        recipient: "GDEF…".into(),
    })
    .await?;

println!("sign and submit: {}", response.unsigned_tx);
# Ok(())
# }
```

## Retries and idempotency

- **Retried:** `429`, `500`, `502`, `503`, `504`, and transport failures.
  By **status code alone** — a 502 from an intermediary carries no error
  envelope but is exactly as transient as a 429 that does.
- **Not retried:** anything else. A `400` means the request was wrong.
- **Backoff:** `Retry-After` when the server sends it, otherwise
  `min(2^attempt × 500ms, 8s)`.
- **Idempotency:** a fresh UUID per logical call, reused across that call's own
  retries, so a retry replays the original response rather than creating a
  second intent. Use `submit_offramp_intent_with_key` to choose your own.

```rust
use std::time::Duration;
use stellar_intel_client::{Client, ClientConfig};

let client = Client::with_config(ClientConfig {
    base_url: "https://stellar-intel.vercel.app".into(),
    max_retries: 3,
    timeout: Duration::from_secs(10),
});
```

## Errors

| Variant            | Meaning                                                                               |
| ------------------ | ------------------------------------------------------------------------------------- |
| `Error::Api`       | The API returned its envelope. Carries `code`, `message`, `request_id`, `status`.     |
| `Error::Response`  | Non-2xx with no envelope — usually an intermediary. Carries a truncated `body`.       |
| `Error::Transport` | No response at all: connection failure, timeout, TLS.                                 |
| `Error::Decode`    | A 2xx whose body did not match. Almost always means this crate is older than the API. |

```rust,no_run
# use stellar_intel_client::{Client, Error, OfframpIntent};
# async fn run(client: Client, intent: OfframpIntent) {
match client.submit_offramp_intent(&intent).await {
    Ok(response) => println!("{}", response.quote_id),
    Err(err) if err.code() == Some("NO_ROUTE") => {
        // No anchor can serve this corridor right now.
    }
    Err(err) => eprintln!("{err}"),
}
# }
```

## API version pinning

Every request carries `API-Version`, pinned to `API_VERSION`. The server's
supported-version list holds one entry, so an unpinned client silently follows
whatever ships; a pinned one gets a `400` it can act on.

## A note on `get_rates`

It calls the **unversioned** `/api/rates/{corridor}` — the only comparison
endpoint that exists. `/api/v1` does not mirror it yet. Stated here rather than
implied, because every other method is under `/api/v1`.

## License

MIT
