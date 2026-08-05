use serde::Deserialize;
use thiserror::Error;

/// The v1 error envelope, as defined by `lib/api/v1.ts` in the main repository.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct ApiErrorBody {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub request_id: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ApiErrorEnvelope {
    pub error: ApiErrorBody,
}

/// Why a request failed.
///
/// Three variants rather than one, because they call for different handling: an
/// `Api` error is the server telling you something specific and actionable, a
/// `Response` error is usually an intermediary the server never saw, and a
/// `Transport` error means the request may not have arrived at all.
#[derive(Debug, Error)]
pub enum Error {
    /// The API returned its structured error envelope.
    #[error("{} ({message}) [HTTP {status}]", .code)]
    Api {
        code: String,
        message: String,
        request_id: String,
        status: u16,
    },

    /// A non-2xx response with no recognisable envelope — a proxy 502, an HTML
    /// error page. `body` is truncated to 500 bytes so a log line stays a log
    /// line.
    #[error("unexpected HTTP {status} with no error envelope")]
    Response { status: u16, body: String },

    /// No response at all: connection failure, timeout, TLS error.
    #[error("transport failure: {0}")]
    Transport(#[from] reqwest::Error),

    /// A 2xx whose body did not match the expected shape. Almost always means
    /// the SDK is older than the API.
    #[error("could not decode response: {0}")]
    Decode(#[source] serde_json::Error),
}

impl Error {
    /// HTTP status, when there was a response.
    pub fn status(&self) -> Option<u16> {
        match self {
            Error::Api { status, .. } | Error::Response { status, .. } => Some(*status),
            _ => None,
        }
    }

    /// The machine-readable code, for an API error.
    pub fn code(&self) -> Option<&str> {
        match self {
            Error::Api { code, .. } => Some(code),
            _ => None,
        }
    }
}

pub type Result<T> = core::result::Result<T, Error>;
