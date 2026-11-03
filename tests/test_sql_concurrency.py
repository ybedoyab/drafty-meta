"""Real PostgreSQL concurrency checks for migration 0007 RPCs.

Requires DRAFTY_TEST_DATABASE_URL (postgresql://...). CI provides a disposable
Postgres service. These tests open independent connections — not Python mocks.
"""

from __future__ import annotations

import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pytest

pytest.importorskip("psycopg")
import psycopg

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "0007_preview_quota_and_geometry_locks.sql"
DATABASE_URL = (os.getenv("DRAFTY_TEST_DATABASE_URL") or "").strip()

pytestmark = [
    pytest.mark.postgres,
    pytest.mark.skipif(not DATABASE_URL, reason="DRAFTY_TEST_DATABASE_URL is not set"),
]


def _connect():
    return psycopg.connect(DATABASE_URL, autocommit=False)


@pytest.fixture(scope="module")
def migrated_db():
    sql = MIGRATION.read_text(encoding="utf-8")
    # Disposable roles used only when the URL is a superuser (local/CI postgres image).
    bootstrap = """
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
    end $$;
    """
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(bootstrap)
            cur.execute(sql)
        conn.commit()
    yield DATABASE_URL
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute("truncate table public.preview_charges restart identity")
            cur.execute("truncate table public.geometry_build_locks")
        conn.commit()


def test_charge_preview_quota_is_atomic_across_independent_transactions(migrated_db):
    owner = "owner-atomic"
    limit = 5
    workers = 40
    results: list[bool] = []
    barrier = threading.Barrier(workers)

    def _charge() -> bool:
        with _connect() as conn:
            with conn.cursor() as cur:
                barrier.wait(timeout=30)
                cur.execute(
                    "select public.charge_preview_quota(%s, %s)",
                    (owner, limit),
                )
                allowed = bool(cur.fetchone()[0])
            conn.commit()
            return allowed

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_charge) for _ in range(workers)]
        for future in as_completed(futures):
            results.append(future.result())

    assert results.count(True) == limit
    assert results.count(False) == workers - limit
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select count(*) from public.preview_charges where owner_id = %s",
                (owner,),
            )
            count = int(cur.fetchone()[0])
        conn.commit()
    assert count == limit


def test_geometry_lock_is_exclusive_until_release_or_expiry(migrated_db):
    digest = "a" * 64
    barrier = threading.Barrier(2)
    claims: list[bool] = []

    def _claim(owner: str) -> bool:
        with _connect() as conn:
            with conn.cursor() as cur:
                barrier.wait(timeout=30)
                cur.execute(
                    "select public.claim_geometry_build_lock(%s, %s, %s)",
                    (digest, owner, 120),
                )
                ok = bool(cur.fetchone()[0])
            conn.commit()
            return ok

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(_claim, "builder-a"), pool.submit(_claim, "builder-b")]
        for future in as_completed(futures):
            claims.append(future.result())

    assert sorted(claims) == [False, True]

    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select owner_id from public.geometry_build_locks where digest = %s",
                (digest,),
            )
            holder = cur.fetchone()[0]
            cur.execute(
                "select public.claim_geometry_build_lock(%s, %s, %s)",
                (digest, "intruder", 120),
            )
            assert cur.fetchone()[0] is False
            cur.execute("select public.release_geometry_build_lock(%s, %s)", (digest, holder))
            cur.execute(
                "select public.claim_geometry_build_lock(%s, %s, %s)",
                (digest, "intruder", 120),
            )
            assert cur.fetchone()[0] is True
        conn.commit()


def test_security_definer_execute_is_service_role_only(migrated_db):
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select
                  p.proname,
                  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
                  has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
                  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_exec,
                  pg_get_functiondef(p.oid) as definition
                from pg_proc p
                join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public'
                  and p.proname in (
                    'charge_preview_quota',
                    'claim_geometry_build_lock',
                    'release_geometry_build_lock'
                  )
                order by p.proname
                """
            )
            rows = cur.fetchall()
        conn.commit()
    assert len(rows) == 3
    for _name, anon_exec, auth_exec, service_exec, definition in rows:
        assert anon_exec is False
        assert auth_exec is False
        assert service_exec is True
        normalized = " ".join(definition.lower().replace("'", "").split())
        assert "set search_path to pg_catalog" in normalized
        assert "public.preview_charges" in definition or "public.geometry_build_locks" in definition or (
            "release_geometry_build_lock" in _name and "public.geometry_build_locks" in definition
        )
