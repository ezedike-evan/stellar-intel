# Canonical JSON

Intents are hashed and signed over a **canonical** serialization so the same
logical intent always produces the same bytes, regardless of key order or
formatting. Without this, two semantically identical intents could hash
differently and a signature could not be verified server-side.

Source of truth: [`lib/intent/`](../lib/intent/) (`hash.ts`, `sign.ts`,
`envelope.ts`) and [`types/intent.ts`](../types/intent.ts).

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

This `hash` is included in the signed envelope and the server recomputes it from
the received `intent`. A mismatch rejects the request before signature checking.

## Signature

```
signature = base64( Ed25519_sign( canonical_bytes, userPrivateKey ) )
```

Signing happens in the user's wallet (Freighter); the private key never leaves the
wallet. The server verifies the signature against the envelope's `publicKey`, which
must equal `intent.publicKey`.

## Worked shape

```jsonc
// intent (authoring order — arbitrary)
{ "publicKey": "GAB…", "amount": "100", "anchorId": "cowrie", "corridorId": "usdc-ngn" }

// canonical (keys sorted ascending: amount, anchorId, corridorId, publicKey)
{"amount":"100","anchorId":"cowrie","corridorId":"usdc-ngn","publicKey":"GAB…"}
```

> Implementation note: treat `lib/intent` as authoritative for the exact ordering
> and serialization, and verify against its tests rather than hand-ordering keys.

## Related

- [`docs/INTENT_API.md`](INTENT_API.md) — the envelope and endpoint.
- [`docs/THREAT_MODEL.md`](THREAT_MODEL.md) — replay/tamper mitigations.
