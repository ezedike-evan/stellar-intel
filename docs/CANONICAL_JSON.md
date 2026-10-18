# Canonical JSON

**Last reviewed:** 2026-10-18

Intents are hashed and signed over a **canonical** serialization so the same
logical intent always produces the same bytes, regardless of key order or
formatting. Without this, two semantically identical intents could hash
differently and a signature could not be verified server-side.

Source of truth: [`lib/intent/`](../lib/intent/) (`hash.ts` [`canonicalJson`,
`hashIntent`], `sign.ts` [`signIntent`], and `verify.ts`
[`verifyIntentSignature`, `verifyOptionalIntentAttestation`]) and
[`types/intent.ts`](../types/intent.ts).

## Canonicalization rules

Given the `intent` object:

1. **Sort object keys recursively** — every object's keys in ascending (code-point)
   order, applied at every nesting level.
2. **Serialize with `JSON.stringify`** over the key-sorted structure — no extra
   whitespace, standard JSON escaping.
3. The resulting UTF-8 bytes are the canonical payload.

Arrays preserve their order (order is semantically meaningful); only object keys
are sorted.

## Hash

```
hash = lowercase_hex( SHA-256( canonical_bytes ) )   // 64 hex chars
```

The 64-character lowercase hex hash is computed by `hashIntent(intent)`. When an
attestation is verified, the server recomputes `hashIntent(intent)` directly from
the received intent payload and verifies the signature against that recomputed
hash.

## Signature

```
signature = base64( Ed25519_sign( Buffer.from( intentHash, "hex" ), userPrivateKey ) )
```

Signing happens in the user's wallet via Freighter's `signMessage(intentHash)`;
the private key never leaves the wallet. The server verifier
(`verifyIntentSignature`) verifies the base64 signature against the raw 32-byte
decoded intent hash (`Buffer.from(intentHash, 'hex')`) or the SEP-53 message
prefix using the provided `publicKey`. The request body carries `signature` and
`publicKey` alongside the `intent` fields.

## Worked shape

```jsonc
// intent (authoring order — arbitrary)
{
  "type": "offramp",
  "sourceAsset": "USDC",
  "destinationAsset": "NGN",
  "amount": "100",
  "sender": "GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789",
  "recipient": "NGN-BANK-ACCOUNT-123"
}

// canonical (keys sorted ascending: amount, destinationAsset, recipient, sender, sourceAsset, type)
{"amount":"100","destinationAsset":"NGN","recipient":"NGN-BANK-ACCOUNT-123","sender":"GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789","sourceAsset":"USDC","type":"offramp"}
```

> Implementation note: treat `lib/intent` as authoritative for the exact ordering
> and serialization, and verify against its tests rather than hand-ordering keys.

## Related

- [`docs/INTENT_API.md`](INTENT_API.md) — the envelope and endpoint.
- [`docs/THREAT_MODEL.md`](THREAT_MODEL.md) — replay/tamper mitigations.
