//! REST client for the [Stellar Intel](https://github.com/ezedike-evan/stellar-intel) API.
//!
//! # Which crate do I want?
//!
//! This one, if you are writing an ordinary Rust program that talks to the
//! HTTP API. It is `std`, async, and built on `reqwest`.
//!
//! [`stellar-intel-reputation`](https://crates.io/crates/stellar-intel-reputation)
//! is the other half: a `#![no_std]` crate that reads the oracle contract
//! **directly over Soroban RPC** from inside another contract's execution
//! context. The two are complementary, and deliberately separate — a `no_std`
//! crate destined for wasm32 cannot depend on `reqwest`, and feature-gating it
//! would poison the dependency graph for the contract authors that crate exists
//! for.
//!
//! # Retries and idempotency are defaults
//!
//! Not opt-in. The failure they prevent — a retried request creating a second
//! intent — is one a caller cannot observe happening, so it should not require
//! remembering to configure.
//!
//! ```no_run
//! # async fn run() -> Result<(), stellar_intel_client::Error> {
//! use stellar_intel_client::Client;
//!
//! let client = Client::new();
//! let comparison = client.get_rates("usdc-ngn").await?;
//!
//! if let Some(best) = comparison.best_rate_id.as_deref() {
//!     println!("best anchor: {best}");
//! }
//! # Ok(())
//! # }
//! ```

mod error;
mod types;

pub use error::{ApiErrorBody, Error, Result};
pub use types::{
    AnchorHealth, AnchorRate, AnchorStatus, OfframpIntent, OfframpIntentResponse, OfframpRoute,
    RateComparison, RateError,
};

use error::ApiErrorEnvelope;
use serde::de::DeserializeOwned;
use std::time::Duration;
use types::OfframpIntentRequest;

pub const DEFAULT_BASE_URL: &str = "https://stellar-intel.vercel.app";

/// The API version this crate release is built against, sent on every request.
///
/// Pinning is deliberate: the server's supported-version list holds one entry,
/// so an unpinned client silently follows whatever ships. A pinned one gets a
/// `400` it can act on.
pub const API_VERSION: &str = "1.3.0";

/// Statuses worth retrying — by status code alone, not by whether the body
/// parsed. A 502 from an intermediary carries no envelope and is exactly as
/// transient as a 429 that does.
const RETRYABLE: &[u16] = &[429, 500, 502, 503, 504];

const MAX_BACKOFF: Duration = Duration::from_secs(8);

/// Configuration for [`Client`].
#[derive(Debug, Clone)]
pub struct ClientConfig {
    pub base_url: String,
    /// Retries **after** the first attempt.
    pub max_retries: u32,
    pub timeout: Duration,
}

impl Default for ClientConfig {
    fn default() -> Self {
        Self {
            base_url: DEFAULT_BASE_URL.to_string(),
            max_retries: 3,
            timeout: Duration::from_secs(10),
        }
    }
}

/// Async REST client.
#[derive(Debug, Clone)]
pub struct Client {
    http: reqwest::Client,
    base_url: String,
    max_retries: u32,
}

impl Default for Client {
    fn default() -> Self {
        Self::new()
    }
}

impl Client {
    /// A client against the production API with default retry settings.
    ///
    /// # Panics
    ///
    /// If the underlying TLS backend cannot be initialised. Use
    /// [`Client::try_with_config`] to handle that as an error.
    pub fn new() -> Self {
        Self::with_config(ClientConfig::default())
    }

    /// # Panics
    ///
    /// See [`Client::new`].
    pub fn with_config(config: ClientConfig) -> Self {
        Self::try_with_config(config).expect("failed to build HTTP client")
    }

    pub fn try_with_config(config: ClientConfig) -> Result<Self> {
        let http = reqwest::Client::builder().timeout(config.timeout).build()?;
        Ok(Self {
            http,
            // A trailing slash yields `host//api/...`, which the server
            // normalises with a 308 — the defect that made the reputation cron
            // a silent no-op.
            base_url: config.base_url.trim_end_matches('/').to_string(),
            max_retries: config.max_retries,
        })
    }

    /// Rates for a corridor, across every registered anchor.
    ///
    /// Note this is the **unversioned** `/api/rates/{corridor}`: it is the only
    /// comparison endpoint that exists, and `/api/v1` does not mirror it yet.
    /// Every other method on this client is under `/api/v1`.
    pub async fn get_rates(&self, corridor_id: &str) -> Result<RateComparison> {
        self.request(
            reqwest::Method::GET,
            &format!("/api/rates/{}", urlencode(corridor_id)),
            None::<&()>,
            None,
        )
        .await
    }

    /// Submits an off-ramp intent and returns an **unsigned** transaction.
    ///
    /// Nothing moves until the caller signs and submits `unsigned_tx`. This
    /// crate never holds a key and never signs.
    ///
    /// An `Idempotency-Key` is generated per call and reused across that call's
    /// own retries, so a retry replays the original response rather than
    /// creating a second intent. Pass your own with
    /// [`Client::submit_offramp_intent_with_key`].
    pub async fn submit_offramp_intent(
        &self,
        intent: &OfframpIntent,
    ) -> Result<OfframpIntentResponse> {
        self.submit_offramp_intent_with_key(intent, &uuid::Uuid::new_v4().to_string())
            .await
    }

    /// As [`Client::submit_offramp_intent`], with a caller-chosen idempotency key.
    pub async fn submit_offramp_intent_with_key(
        &self,
        intent: &OfframpIntent,
        idempotency_key: &str,
    ) -> Result<OfframpIntentResponse> {
        let body = OfframpIntentRequest {
            kind: "offramp",
            source_asset: &intent.source_asset,
            destination_asset: &intent.destination_asset,
            amount: &intent.amount,
            sender: &intent.sender,
            recipient: &intent.recipient,
        };
        self.request(
            reqwest::Method::POST,
            "/api/v1/intent/offramp",
            Some(&body),
            Some(idempotency_key),
        )
        .await
    }

    /// Health of a single anchor, from the nightly validation ledger.
    pub async fn get_anchor_health(&self, anchor_id: &str) -> Result<AnchorHealth> {
        self.request(
            reqwest::Method::GET,
            &format!("/api/v1/anchors/{}/health", urlencode(anchor_id)),
            None::<&()>,
            None,
        )
        .await
    }

    /// Liveness of the API itself.
    pub async fn get_health(&self) -> Result<serde_json::Value> {
        self.request(reqwest::Method::GET, "/api/v1/health", None::<&()>, None)
            .await
    }

    async fn request<B: serde::Serialize, T: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<&B>,
        idempotency_key: Option<&str>,
    ) -> Result<T> {
        let url = format!("{}{}", self.base_url, path);
        let mut attempt = 0u32;

        loop {
            let mut req = self
                .http
                .request(method.clone(), &url)
                .header("accept", "application/json")
                .header("API-Version", API_VERSION);

            if let Some(key) = idempotency_key {
                req = req.header("Idempotency-Key", key);
            }
            if let Some(b) = body {
                req = req.json(b);
            }

            let response = match req.send().await {
                Ok(r) => r,
                Err(err) => {
                    // A transport failure is retryable for the same reason a
                    // 503 is: the request may not have reached the server.
                    if attempt < self.max_retries {
                        sleep(backoff(None, attempt)).await;
                        attempt += 1;
                        continue;
                    }
                    return Err(Error::Transport(err));
                }
            };

            let status = response.status().as_u16();
            let retry_after = response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok());
            let text = response.text().await.unwrap_or_default();

            if (200..300).contains(&status) {
                return serde_json::from_str(&text).map_err(Error::Decode);
            }

            if RETRYABLE.contains(&status) && attempt < self.max_retries {
                sleep(backoff(retry_after, attempt)).await;
                attempt += 1;
                continue;
            }

            if let Ok(envelope) = serde_json::from_str::<ApiErrorEnvelope>(&text) {
                return Err(Error::Api {
                    code: envelope.error.code,
                    message: envelope.error.message,
                    request_id: envelope.error.request_id,
                    status,
                });
            }

            return Err(Error::Response {
                status,
                body: text.chars().take(500).collect(),
            });
        }
    }
}

/// Backoff before the next attempt.
///
/// `Retry-After` wins when the server sends it: it knows when its window
/// resets, and guessing shorter just burns another request against the limit.
fn backoff(retry_after_secs: Option<u64>, attempt: u32) -> Duration {
    if let Some(secs) = retry_after_secs {
        return Duration::from_secs(secs);
    }
    let ms = 500u64.saturating_mul(1u64 << attempt.min(6));
    Duration::from_millis(ms).min(MAX_BACKOFF)
}

async fn sleep(duration: Duration) {
    tokio::time::sleep(duration).await;
}

/// Percent-encodes a path segment.
///
/// Deliberately not a dependency: the only characters that can appear in an
/// anchor or corridor id and break a path are these.
fn urlencode(segment: &str) -> String {
    segment
        .chars()
        .flat_map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => vec![c],
            other => {
                let mut buf = [0u8; 4];
                other
                    .encode_utf8(&mut buf)
                    .as_bytes()
                    .iter()
                    .flat_map(|b| format!("%{b:02X}").chars().collect::<Vec<_>>())
                    .collect()
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_prefers_retry_after() {
        assert_eq!(backoff(Some(2), 0), Duration::from_secs(2));
        assert_eq!(backoff(Some(0), 5), Duration::from_secs(0));
    }

    #[test]
    fn backoff_doubles_and_caps() {
        assert_eq!(backoff(None, 0), Duration::from_millis(500));
        assert_eq!(backoff(None, 1), Duration::from_millis(1000));
        assert_eq!(backoff(None, 2), Duration::from_millis(2000));
        assert_eq!(backoff(None, 10), MAX_BACKOFF);
    }

    #[test]
    fn urlencode_escapes_path_separators() {
        assert_eq!(urlencode("usdc-ngn"), "usdc-ngn");
        assert_eq!(urlencode("a/b"), "a%2Fb");
        assert_eq!(urlencode("a b"), "a%20b");
    }

    #[test]
    fn base_url_trailing_slash_is_stripped() {
        let client = Client::try_with_config(ClientConfig {
            base_url: "https://api.test/".into(),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(client.base_url, "https://api.test");
    }
}
