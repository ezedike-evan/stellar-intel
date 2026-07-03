# Maintainer Notes

## 11. Anchor Fleet Status

- [x] Monthly recheck complete for the latest survey snapshot.

Latest documented snapshot: 92 directory-tagged domains -> 32 reachable
`stellar.toml` files -> 9 transfer-capable / 23 issuer-only; 60 unreachable or
unconfirmed.

The 23 issuer-only domains (advertise an asset/issuer but no SEP-6/SEP-24
transfer rails, so they back no corridor) are enumerated with reasons in
[`docs/anchors/exclusions.md`](docs/anchors/exclusions.md).

Source: `scripts/anchor-survey.snapshot.json`, generated
2026-06-25T23:08:26.806Z from
`https://api.stellar.expert/explorer/public/directory?tag[]=anchor&limit=200`.

Refresh cadence: re-run `node scripts/anchor-survey.mjs --json` monthly, update
these counts, and keep the recheck checkbox aligned with the current snapshot.
