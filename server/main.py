import os
import secrets
from pathlib import Path
from typing import Annotated

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

from . import auth, db, limits

BACKBOARD_URL = "https://app.backboard.io/api"
DIST = Path(__file__).parent.parent / "dist"

db.init()
app = FastAPI(title="ChalkTalk")
limits.install(app)
app.add_middleware(
    SessionMiddleware,
    # Without a fixed secret every restart logs everyone out: fine locally, Render generates one.
    secret_key=os.environ.get("SESSION_SECRET") or secrets.token_hex(32),
    max_age=30 * 24 * 3600,
    https_only=bool(os.environ.get("RENDER")),
)
app.include_router(auth.router)


@app.middleware("http")
async def isolate(request, call_next):
    # Cross-origin isolation lets the in-browser voice model use several threads, about twice as fast.
    response = await call_next(request)
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Embedder-Policy"] = "credentialless"
    return response


class LlmRequest(BaseModel):
    system: Annotated[str, Field(max_length=8_000)]
    # A 12k-character PDF plus the lesson prompt fits with room to spare.
    content: Annotated[str, Field(max_length=20_000)]


def backboard_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(120, connect=10))


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/llm")
async def llm(body: LlmRequest):
    key = os.environ.get("BACKBOARD_API_KEY")
    if not key:
        return JSONResponse(status_code=503, content={"detail": "BACKBOARD_API_KEY is not set on the server."})
    # Model and sizes are fixed here and calls are rate limited, to cap what an anonymous caller can spend.
    payload = {
        "content": body.content,
        "system_prompt": body.system,
        "llm_provider": "openrouter",
        "model_name": os.environ.get("BACKBOARD_MODEL", "google/gemma-4-26b-a4b-it"),
        "json_output": False,
        "memory": "off",
        "stream": True,
    }
    client = backboard_client()
    request = client.build_request(
        "POST", f"{BACKBOARD_URL}/threads/messages", headers={"X-API-Key": key}, json=payload
    )
    try:
        res = await client.send(request, stream=True)
    except httpx.HTTPError:
        await client.aclose()
        return JSONResponse(status_code=502, content={"detail": "Can't reach Backboard right now."})
    if res.is_error:
        detail = (await res.aread()).decode(errors="replace")[:300]
        await client.aclose()
        return JSONResponse(status_code=502, content={"detail": f"Backboard {res.status_code}: {detail}"})

    async def relay():
        try:
            async for chunk in res.aiter_bytes():
                yield chunk
        finally:
            await res.aclose()
            await client.aclose()

    return StreamingResponse(relay(), media_type="text/event-stream")


# Locally `npm run dev` serves the page; on Render the build puts it in dist/.
if DIST.exists():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="web")
