import os
import tempfile

import pytest

# Set before the server is imported: server/__init__ loads .env, which never overrides variables already set.
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/test.db"
# Tests must never call the real LLM; a test that needs the key sets it with a mocked transport.
os.environ["BACKBOARD_API_KEY"] = ""
os.environ.pop("RENDER", None)


@pytest.fixture(autouse=True)
def fresh_rate_limit():
    from server import limits

    limits.calls.clear()
