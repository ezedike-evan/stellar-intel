# Anchor Exclusions

This document tracks entities that have been evaluated but excluded from integration as fiat anchors, along with the reasons for their exclusion.

## Stellarport

- **Domain:** stellarport.io
- **Status:** Excluded
- **Reason:** Stellarport is primarily a Decentralized Exchange (DEX) and gateway for crypto assets (BTC, ETH, XRP, LTC). Verification of their `stellar.toml` reveals that all issued assets are crypto-anchored (`anchor_asset_type="crypto"`). Furthermore, their transfer server endpoint (`a3s.api.stellarport.io`) is unresponsive/non-existent. There is no evidence of fiat settlement or fiat off-ramp services. Thus, it is not suitable for fiat off-ramp integration.
