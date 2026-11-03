"""Print exact concurrent SQL results for migration 0007."""

from __future__ import annotations

import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

import psycopg

URL = (os.getenv("DRAFTY_TEST_DATABASE_URL") or "").strip()
if not URL:
    raise SystemExit("DRAFTY_TEST_DATABASE_URL is required")


def connect():
    return psycopg.connect(URL, autocommit=False)


def main() -> None:
    owner = "report-owner"
    limit = 5
    workers = 40
    barrier = threading.Barrier(workers)

    def charge() -> bool:
        with connect() as conn:
            with conn.cursor() as cur:
                barrier.wait(timeout=30)
                cur.execute("select public.charge_preview_quota(%s, %s)", (owner, limit))
                ok = bool(cur.fetchone()[0])
            conn.commit()
            return ok

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("truncate table public.preview_charges restart identity")
            cur.execute("truncate table public.geometry_build_locks")
        conn.commit()

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = [pool.submit(charge) for _ in range(workers)]
        results = [future.result() for future in as_completed(futs)]

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("select count(*) from public.preview_charges where owner_id=%s", (owner,))
            count = int(cur.fetchone()[0])
        conn.commit()

    print(f"QUOTA workers={workers} limit={limit} allowed={results.count(True)} denied={results.count(False)} rows={count}")

    digest = "b" * 64
    barrier2 = threading.Barrier(2)

    def claim(name: str) -> bool:
        with connect() as conn:
            with conn.cursor() as cur:
                barrier2.wait(timeout=30)
                cur.execute(
                    "select public.claim_geometry_build_lock(%s, %s, %s)",
                    (digest, name, 120),
                )
                ok = bool(cur.fetchone()[0])
            conn.commit()
            return ok

    with ThreadPoolExecutor(max_workers=2) as pool:
        claims = [
            future.result()
            for future in as_completed([pool.submit(claim, "a"), pool.submit(claim, "b")])
        ]
    print(f"LOCK concurrent_claims={sorted(claims)}")


if __name__ == "__main__":
    main()
