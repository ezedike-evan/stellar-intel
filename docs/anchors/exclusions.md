# Anchor Exclusions

This document tracks entities that have been evaluated but excluded from integration as fiat anchors, along with the reasons for their exclusion.

Issuer-only / non-fiat anchors that were identified via the directory survey
are also tracked in the fleet recheck obligation (issue **#B065**).

---

## Stellarport

- **Domain:** stellarport.io
- **Status:** Excluded
- **Reason:** Stellarport is primarily a Decentralized Exchange (DEX) and gateway for crypto assets (BTC, ETH, XRP, LTC). Verification of their `stellar.toml` reveals that all issued assets are crypto-anchored (`anchor_asset_type="crypto"`). Furthermore, their transfer server endpoint (`a3s.api.stellarport.io`) is unresponsive/non-existent. There is no evidence of fiat settlement or fiat off-ramp services. Thus, it is not suitable for fiat off-ramp integration.

---

## naobtc.com

- **Domain:** naobtc.com
- **Issue:** #467 (B034)
- **Triaged:** 2026-06-28
- **Status:** Excluded
- **Reason:** naobtc.com is a BTC anchor with no fiat off-ramp or on-ramp corridor. Verification of its SEP-38 `/info` endpoint reveals no fiat `sell_asset` or `buy_asset` pairs — all assets are crypto-only. There is no evidence of fiat settlement or fiat corridor services. It must not be added to any corridor list and requires no further SEP-24/SEP-38 integration work. Exclusion is permanent unless the operator adds a verifiable fiat corridor and re-submits via the anchor onboarding flow described in [`docs/ANCHOR_ONBOARDING.md`](../ANCHOR_ONBOARDING.md).
- **Linked tracking:** #B065 (issuer-only / non-fiat register)
