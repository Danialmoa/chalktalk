import hashlib
import hmac
import secrets
from typing import Annotated

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, StringConstraints
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .db import engine, users

router = APIRouter(prefix="/api")

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Email = Annotated[
    str,
    StringConstraints(strip_whitespace=True, to_lower=True, max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"),
]
Password = Annotated[str, StringConstraints(min_length=8, max_length=200)]


class Signup(BaseModel):
    name: Name
    email: Email
    password: Password


class Login(BaseModel):
    email: Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, max_length=200)]
    password: Annotated[str, StringConstraints(max_length=200)]


def _scrypt(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    return f"{salt.hex()}:{_scrypt(password, salt).hex()}"


def check_password(password: str, stored: str) -> bool:
    salt, digest = stored.split(":")
    return hmac.compare_digest(_scrypt(password, bytes.fromhex(salt)).hex(), digest)


def public(row) -> dict:
    return {"id": row.id, "name": row.name, "email": row.email}


@router.get("/me")
def me(request: Request):
    user_id = request.session.get("user")
    if user_id is None:
        return {"user": None}
    with engine.connect() as db:
        row = db.execute(select(users).where(users.c.id == user_id)).first()
    return {"user": public(row) if row else None}


@router.post("/signup")
def signup(body: Signup, request: Request):
    try:
        with engine.begin() as db:
            result = db.execute(
                users.insert().values(name=body.name, email=body.email, password=hash_password(body.password))
            )
    except IntegrityError:
        raise HTTPException(409, "There's already an account with this email. Log in instead.") from None
    user_id = result.inserted_primary_key[0]
    request.session["user"] = user_id
    return {"user": {"id": user_id, "name": body.name, "email": body.email}}


@router.post("/login")
def login(body: Login, request: Request):
    with engine.connect() as db:
        row = db.execute(select(users).where(users.c.email == body.email)).first()
    if not row or not check_password(body.password, row.password):
        raise HTTPException(401, "Wrong email or password.")
    request.session["user"] = row.id
    return {"user": public(row)}


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return {"user": None}
