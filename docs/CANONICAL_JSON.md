# Canonical JSON Specification

This document defines the canonicalization rules for JSON objects used in the Stellar Intel intent system. Canonicalization ensures that the same logical object always produces the same byte representation, regardless of how it was originally formatted.

## Purpose

Canonical JSON is used for:
- **Intent hashing**: Computing the SHA-256 hash of an intent for signing
- **Deterministic serialization**: Ensuring consistent byte representation across implementations
- **Signature verification**: All parties compute the same hash from the same intent

## Rules

### 1. Key Ordering

All object keys must be sorted alphabetically in ascending order (lexicographic order).

```json
// Before canonicalization
{
  "deadline": "2024-01-01T00:00:00Z",
  "account": "GABC...",
  "corridor": "usdc-ngn"
}

// After canonicalization
{
  "account": "GABC...",
  "corridor": "usdc-ngn",
  "deadline": "2024-01-01T00:00:00Z"
}
```

### 2. No Whitespace

No whitespace characters between tokens. This includes:
- No spaces after colons
- No spaces after commas
- No newlines
- No indentation

```json
// Before canonicalization
{
  "account": "GABC...",
  "sellAmount": "100"
}

// After canonicalization
{"account":"GABC...","sellAmount":"100"}
```

### 3. UTF-8 Encoding

All strings must be encoded as UTF-8. This is the default for JSON but must be enforced when computing hashes.

### 4. Integer Normalization

Numeric values that are whole numbers must not have decimal points or trailing zeros.

```json
// Before canonicalization
{
  "fee": 100.0,
  "amount": 50.00
}

// After canonicalization
{
  "fee": 100,
  "amount": 50
}
```

### 5. Recursive Application

These rules must be applied recursively to all nested objects and arrays.

```json
// Before canonicalization
{
  "preferences": {
    "maxAnchors": 2,
    "allowSplit": true
  },
  "sellAsset": {
    "code": "USDC",
    "issuer": "G..."
  }
}

// After canonicalization
{"preferences":{"allowSplit":true,"maxAnchors":2},"sellAsset":{"code":"USDC","issuer":"G..."}}
```

### 6. Array Ordering

Arrays must preserve their original order. Do not sort array elements.

```json
// Arrays keep their order
{
  "corridors": ["usdc-ngn", "usdc-kes", "usdc-zar"]
}
```

## Implementation

The canonicalization is implemented in `lib/intent/canonical.ts`:

```typescript
import { canonicalizeIntent } from '@/lib/intent/canonical'
import type { Intent } from '@/types'

const intent: Intent = { /* ... */ }
const canonical = canonicalizeIntent(intent)
```

## Validation

To validate that a JSON string is properly canonicalized:

```typescript
import { isValidCanonical } from '@/lib/intent/canonical'

const isValid = isValidCanonical(jsonString)
```

## Example

Given this intent object:

```json
{
  "version": 1,
  "nonce": "abc123",
  "account": "GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789",
  "corridor": "usdc-ngn",
  "sellAsset": {
    "code": "USDC",
    "issuer": "GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789"
  },
  "sellAmount": "100",
  "buyAsset": {
    "code": "NGN"
  },
  "minReceive": "150000",
  "deliveryHint": "bank_account",
  "deadline": "2024-12-31T23:59:59Z",
  "preferences": {
    "allowSplit": true,
    "maxAnchors": 2
  }
}
```

The canonical form is:

```json
{"account":"GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789","buyAsset":{"code":"NGN"},"corridor":"usdc-ngn","deadline":"2024-12-31T23:59:59Z","deliveryHint":"bank_account","minReceive":"150000","nonce":"abc123","preferences":{"allowSplit":true,"maxAnchors":2},"sellAmount":"100","sellAsset":{"code":"USDC","issuer":"GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789"},"version":1}
```

## Security Considerations

- **Deterministic**: The same input must always produce the same output
- **Collision-resistant**: Different inputs must produce different outputs
- **Platform-independent**: The rules must work identically across all platforms (browser, Node.js, etc.)
- **Version-stable**: Changes to canonicalization rules require a version bump in the intent schema

## References

- RFC 8259: The JavaScript Object Notation (JSON) Data Interchange Format
- RFC 7616: The 'HMAC' Algorithm
- Stellar SEP-10: Authentication
