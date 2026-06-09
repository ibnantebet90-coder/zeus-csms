"""
ZEUS CSMS — Database Session
SQLAlchemy engine + session factory untuk MySQL.
"""

import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "../../.env"))

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "mysql+pymysql://zeus_user:zeus_password@localhost:3306/zeus_csms",
)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,  # auto-reconnect jika koneksi mati
    pool_recycle=3600,  # recycle koneksi tiap 1 jam
    echo=False,  # ganti True untuk debug query SQL
    connect_args={"init_command": "SET time_zone='+07:00'"},  # WIB (Asia/Jakarta)
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """Dependency FastAPI — inject session ke setiap endpoint."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
