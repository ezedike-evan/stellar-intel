# Intent API Specification

This document describes the intent schema, signing process, and API endpoints for the Stellar Intel intent system.

## Overview

An **intent** is a user's signed, canonicalized statement of purpose. It is the atomic unit that the router operates on, representing a desire to exchange one asset for another with specific constraints.

## Intent Schema

### Intent

```typescript
interface Intent {
  version: 1
  nonce: string                 // 128-bit random, replay protection
  account: string               // user's Stellar public key
  corridor: `${string}-${string}` // e.g. 'usdc-ngn'
  sellAsset: { code: string; issuer: string }
  sellAmount: string            // decimal string
  buyAsset: { code: string }    // fiat, e.g. 'NGN'
  minReceive: string            // floor on delivered amount
  deliveryHint: DeliveryHint    // 'bank_account' | 'mobile_money' | 'cash_pickup'
  deadline: string              // RFC3339
  preferences?: IntentPreferences
}
```

### SignedIntent

```typescript
interface SignedIntent {
  intent: Intent
  intentHash: string            // sha-256 over canonical JSON
  signature: string             // ed25519 over intentHash, by account
}
```

### Plan (Output Envelope)

```typescript
interface Plan {
  intentHash: string            // hash of the original intent
  legs: PlanLeg[]               // one or more legs (single anchor or split)
  totalExpectedReceive: string  // sum of all legs' expected delivery
  totalFee: string              // sum of all fees
  isSplit: boolean              // true if legs.length > 1
  createdAt: string             // RFC3339
  expiresAt: string             // RFC3339 - when quotes expire
}

interface PlanLeg {
  anchor: {
    id: string
    name: string
    homeDomain: string
  }
  quote: AnchorQuote
  unsignedTransaction: UnsignedTransaction
  expectedDelivery: {
    amount: string              // in buy asset
    currency: string            // e.g. 'NGN'
    estimatedSeconds: number   // time to settlement
  }
}
```

### UnsignedTransaction

```typescript
interface UnsignedTransaction {
  xdr: string                   // Stellar transaction XDR, unsigned
  networkPassphrase: string     // e.g. 'Public Global Stellar Network ; September 2015'
  description: string           // human-readable description
}
```

## Signing Process

### 1. Canonicalization

The intent is canonicalized according to the rules in `docs/CANONICAL_JSON.md`:

```typescript
import { canonicalizeIntent } from '@/lib/intent/canonical'
const canonical = canonicalizeIntent(intent)
```

### 2. Hashing

Compute the SHA-256 hash of the canonical JSON:

```typescript
import { hashIntent } from '@/lib/intent/hash'
const intentHash = await hashIntent(intent)
```

### 3. Signing

Sign the hash using the user's wallet via Freighter:

```typescript
import { signIntent } from '@/lib/intent/sign'
const signedIntent = await signIntent(intent)
```

### 4. Verification

Verify the signature (server-side):

```typescript
import { verifySignedIntent } from '@/lib/intent/sign'
const isValid = await verifySignedIntent(signedIntent)
```

## API Endpoints

### POST /api/intent/offramp

Submit a signed intent for off-ramp execution.

**Request Body:**

```json
{
  "intent": {
    "version": 1,
    "nonce": "abc123...",
    "account": "GABC...",
    "corridor": "usdc-ngn",
    "sellAsset": {
      "code": "USDC",
      "issuer": "G..."
    },
    "sellAmount": "100",
    "buyAsset": {
      "code": "NGN"
    },
    "minReceive": "150000",
    "deliveryHint": "bank_account",
    "deadline": "2024-12-31T23:59:59Z"
  },
  "intentHash": "a1b2c3d4...",
  "signature": "sig123..."
}
```

**Response (200 OK):**

```json
{
  "plan": {
    "intentHash": "a1b2c3d4...",
    "legs": [
      {
        "anchor": {
          "id": "cowrie",
          "name": "Cowrie",
          "homeDomain": "cowrie.exchange"
        },
        "quote": {
          "anchorId": "cowrie",
          "anchorName": "Cowrie",
          "anchorDomain": "cowrie.exchange",
          "quoteId": "quote_123",
          "price": 1500,
          "expiresAt": "2024-12-31T23:59:59Z",
          "fee": 5,
          "totalFee": 5.5,
          "totalReceive": 149994.5,
          "source": "sep38"
        },
        "unsignedTransaction": {
          "xdr": "AAAA...",
          "networkPassphrase": "Public Global Stellar Network ; September 2015",
          "description": "Send 100 USDC to Cowrie anchor"
        },
        "expectedDelivery": {
          "amount": "149994.5",
          "currency": "NGN",
          "estimatedSeconds": 300
        }
      }
    ],
    "totalExpectedReceive": "149994.5",
    "totalFee": "5.5",
    "isSplit": false,
    "createdAt": "2024-01-01T00:00:00Z",
    "expiresAt": "2024-12-31T23:59:59Z"
  },
  "status": "pending"
}
```

**Error Responses:**

- `400 Bad Request`: Missing required fields or invalid intent structure
- `401 Unauthorized`: Invalid signature
- `400 Bad Request`: Intent deadline has passed
- `500 Internal Server Error`: Server error

## Security Considerations

### Replay Protection

The `nonce` field provides replay protection. Each intent must have a unique 128-bit random value. The server should track used nonces within a time window to prevent replay attacks.

### Deadline Enforcement

The `deadline` field specifies when the intent expires. The server must reject intents with deadlines in the past.

### Signature Verification

The signature must be verified against the `account` field in the intent. This ensures that only the account owner can submit intents for that account.

### Network Pinning

All Stellar transactions must be pinned to the mainnet network. The `networkPassphrase` in the unsigned transaction must be `"Public Global Stellar Network ; September 2015"`.

## Example Usage

### Client-side (Web UI)

```typescript
import { signIntent } from '@/lib/intent/sign'

const intent: Intent = {
  version: 1,
  nonce: generateNonce(),
  account: userPublicKey,
  corridor: 'usdc-ngn',
  sellAsset: { code: 'USDC', issuer: 'G...' },
  sellAmount: '100',
  buyAsset: { code: 'NGN' },
  minReceive: '150000',
  deliveryHint: 'bank_account',
  deadline: getDeadline(300) // 5 minutes from now
}

const signedIntent = await signIntent(intent)

const response = await fetch('/api/intent/offramp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(signedIntent)
})

const { plan } = await response.json()
```

### Server-side (API Route)

```typescript
import { verifySignedIntent } from '@/lib/intent/sign'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const signedIntent: SignedIntent = await request.json()
  
  const isValid = await verifySignedIntent(signedIntent)
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  
  // Process intent and generate plan
  const plan = await generatePlan(signedIntent.intent)
  
  return NextResponse.json({ plan })
}
```

## References

- [Canonical JSON Specification](./CANONICAL_JSON.md)
- [Architecture Document](./ARCHITECTURE.md)
- [SEP-10 Authentication](https://stellar.org/protocol/sep-10)
- [SEP-38 Firm Quotes](https://stellar.org/protocol/sep-38)
