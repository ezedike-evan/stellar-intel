use serde::{Deserialize, Serialize};

/// One anchor's quote for a corridor.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnchorRate {
    pub anchor_id: String,
    pub anchor_name: String,
    pub corridor_id: String,
    pub fee: String,
    pub fee_type: String,
    pub exchange_rate: String,
    pub total_received: String,
    pub updated_at: String,
    pub source: String,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub quote_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RateError {
    pub anchor_id: String,
    pub anchor_name: String,
    pub reason: String,
}

/// Every anchor's rate for one corridor, plus which one won.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RateComparison {
    pub corridor_id: String,
    pub rates: Vec<AnchorRate>,
    /// True while at least one anchor is still being polled.
    pub pending: bool,
    /// `anchor_id` of the best rate, or `None` when none resolved.
    pub best_rate_id: Option<String>,
    #[serde(default)]
    pub errors: Vec<RateError>,
}

/// Input to [`crate::Client::submit_offramp_intent`].
///
/// `type` is set by the client, so a caller cannot get it wrong.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfframpIntent {
    pub source_asset: String,
    pub destination_asset: String,
    pub amount: String,
    /// Stellar public key of the sender.
    pub sender: String,
    /// Destination address for the payout.
    pub recipient: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OfframpIntentRequest<'a> {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub source_asset: &'a str,
    pub destination_asset: &'a str,
    pub amount: &'a str,
    pub sender: &'a str,
    pub recipient: &'a str,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OfframpRoute {
    pub anchor_id: String,
    pub anchor_domain: String,
    pub corridor_id: String,
    pub estimated_fee: String,
    pub estimated_received: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OfframpIntentResponse {
    pub route: OfframpRoute,
    /// XDR-encoded **unsigned** Stellar transaction. Nothing moves until the
    /// caller signs and submits it.
    pub unsigned_tx: String,
    /// Hex-encoded SHA-256 quote identifier.
    pub quote_id: String,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AnchorStatus {
    Ok,
    Fail,
    /// Never checked.
    Unknown,
    /// Last check is older than 24 hours.
    Stale,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnchorHealth {
    pub anchor_id: String,
    pub status: AnchorStatus,
    pub consecutive_failures: u32,
    pub degraded: bool,
    pub last_checked_at: Option<String>,
    pub last_error: Option<String>,
    pub stale: bool,
}
