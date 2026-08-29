"""
Quickstart: submit an off-ramp intent and inspect the routed anchor, quote
ID, and unsigned transaction.

Run: python examples/quickstart.py
"""

from stellarintel import OfframpIntent, StellarIntelApiError, StellarIntelClient


def main() -> None:
    intent = OfframpIntent(
        source_asset="USDC",
        destination_asset="NGN",
        amount="100",
        sender="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        recipient="NGN-BANK-ACCOUNT-123",
    )

    with StellarIntelClient() as client:
        try:
            result = client.submit_offramp_intent(intent)
        except StellarIntelApiError as err:
            print(f"Request failed: {err.code} -- {err.message}")
            if err.retry_after:
                print(f"Retry after {err.retry_after}s")
            return

        print(f"Routed via {result.route.anchor_id} ({result.route.corridor_id})")
        print(f"Quote ID: {result.quote_id}")
        print(f"Unsigned XDR: {result.unsigned_tx}")
        print("Sign this XDR with your own Stellar keypair and submit it to Horizon.")


if __name__ == "__main__":
    main()
