import json

import httpx
from fastapi.testclient import TestClient

from server import limits, main


def client() -> TestClient:
    return TestClient(main.app)


def test_signup_logs_you_in_and_me_remembers_you():
    c = client()
    res = c.post("/api/signup", json={"name": " Ada ", "email": "Ada@Example.com", "password": "correct horse"})
    assert res.status_code == 200
    user = res.json()["user"]
    assert (user["name"], user["email"]) == ("Ada", "ada@example.com")
    assert c.get("/api/me").json()["user"] == user


def test_same_email_cannot_sign_up_twice():
    body = {"name": "Bo", "email": "bo@example.com", "password": "12345678"}
    assert client().post("/api/signup", json=body).status_code == 200
    again = client().post("/api/signup", json={**body, "email": "BO@example.com"})
    assert again.status_code == 409
    assert "already an account" in again.json()["detail"]


def test_login_checks_the_password_and_logout_forgets_you():
    client().post("/api/signup", json={"name": "Cy", "email": "cy@example.com", "password": "right password"})
    c = client()
    wrong = c.post("/api/login", json={"email": "cy@example.com", "password": "wrong password"})
    assert wrong.status_code == 401
    assert c.get("/api/me").json() == {"user": None}
    assert c.post("/api/login", json={"email": " CY@example.com", "password": "right password"}).status_code == 200
    assert c.get("/api/me").json()["user"]["name"] == "Cy"
    c.post("/api/logout")
    assert c.get("/api/me").json() == {"user": None}


def test_short_password_and_bad_email_are_refused():
    c = client()
    assert c.post("/api/signup", json={"name": "Di", "email": "di@example.com", "password": "short"}).status_code == 422
    assert c.post("/api/signup", json={"name": "Di", "email": "not-an-email", "password": "12345678"}).status_code == 422


def test_passwords_are_not_stored_as_typed():
    from server.auth import check_password, hash_password

    stored = hash_password("hunter22")
    assert "hunter22" not in stored
    assert check_password("hunter22", stored)
    assert not check_password("hunter23", stored)


def test_login_is_rate_limited():
    c = client()
    for _ in range(limits.MAX_CALLS):
        c.post("/api/login", json={"email": "x@example.com", "password": "guess"})
    assert c.post("/api/login", json={"email": "x@example.com", "password": "guess"}).status_code == 429


def test_llm_needs_the_server_key():
    res = client().post("/api/llm", json={"system": "s", "content": "c"})
    assert res.status_code == 503


def test_llm_refuses_huge_prompts():
    assert client().post("/api/llm", json={"system": "s", "content": "x" * 20_001}).status_code == 422


def test_llm_uses_the_server_model_and_key_and_streams_back(monkeypatch):
    seen = {}

    def backboard(request: httpx.Request) -> httpx.Response:
        seen["key"] = request.headers["x-api-key"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, text='data: {"type":"content_streaming","content":"hi"}\n\n')

    monkeypatch.setenv("BACKBOARD_API_KEY", "test-key")
    monkeypatch.delenv("BACKBOARD_MODEL", raising=False)
    monkeypatch.setattr(main, "backboard_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(backboard)))
    res = client().post("/api/llm", json={"system": "be a tutor", "content": "explain xgboost"})
    assert res.status_code == 200
    assert '"content":"hi"' in res.text
    assert seen["key"] == "test-key"
    assert seen["body"]["model_name"] == "google/gemma-4-26b-a4b-it"
    assert (seen["body"]["system_prompt"], seen["body"]["content"]) == ("be a tutor", "explain xgboost")


def test_backboard_errors_come_back_as_a_short_message(monkeypatch):
    monkeypatch.setenv("BACKBOARD_API_KEY", "test-key")
    monkeypatch.setattr(
        main,
        "backboard_client",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(401, text="bad key"))),
    )
    res = client().post("/api/llm", json={"system": "s", "content": "c"})
    assert res.status_code == 502
    assert res.json()["detail"] == "Backboard 401: bad key"


def test_pages_are_cross_origin_isolated_so_the_voice_gets_threads():
    headers = client().get("/api/health").headers
    assert headers["Cross-Origin-Opener-Policy"] == "same-origin"
    assert headers["Cross-Origin-Embedder-Policy"] == "credentialless"
