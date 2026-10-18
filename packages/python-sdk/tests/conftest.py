import pytest


@pytest.fixture
def no_sleep(monkeypatch):
    """Replace the retry backoff's time.sleep with a recorder.

    The wrapper sleeps for real between retries (0.5 s, 1 s, ... or the
    server's Retry-After). Tests that trigger a retry use this fixture so they
    run instantly, and can assert on the backoffs that were requested.
    """
    calls = []
    monkeypatch.setattr("stellarintel.wrapper.time.sleep", lambda seconds: calls.append(seconds))
    return calls
