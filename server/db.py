import os

from sqlalchemy import Column, DateTime, Integer, MetaData, String, Table, create_engine, func

metadata = MetaData()
users = Table(
    "users",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("name", String(80), nullable=False),
    Column("email", String(200), nullable=False, unique=True),
    Column("password", String(200), nullable=False),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
)

# SQLite locally; Render sets DATABASE_URL to its Postgres.
engine = create_engine(os.environ.get("DATABASE_URL") or "sqlite:///chalktalk.db")


def init() -> None:
    metadata.create_all(engine)
