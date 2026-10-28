"""Poll shared job storage. The API container does not run CalculiX."""

import os
import time
from pathlib import Path

from drafty_api.executor import execute
from drafty_api.jobs import TERMINAL, claim_is_fresh, update_job
from drafty_api.settings import settings


def main() -> None:
    os.environ["DRAFTY_IN_WORKER"] = "1"
    root = settings.data_dir / "jobs"
    root.mkdir(parents=True, exist_ok=True)
    while True:
        ran = False
        for directory in sorted(path for path in root.iterdir() if path.is_dir()):
            if _take(directory):
                execute(directory)
                ran = True
                break
        if not ran:
            time.sleep(1)


def _take(directory: Path) -> bool:
    path = directory / "job.json"
    if not path.exists() or claim_is_fresh(directory):
        return False
    try:
        import json

        job = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return False
    if job.get("status") in TERMINAL:
        return False
    if job.get("status") != "queued":
        return False
    if (directory / "cancel").exists():
        update_job(directory, status="cancelled", message="Cancelled", error="The job was cancelled before it started.")
        return False
    return True


if __name__ == "__main__":
    main()
