#!/usr/bin/env python3
"""Lightweight local health probes for Uptime Kuma push monitors."""

from __future__ import annotations

import glob
import os
import shutil
import sqlite3
import time
import urllib.parse
import urllib.request
from pathlib import Path


CONFIG_PATH = Path("/etc/usun-monitoring/push.env")
DATABASE_PATH = "/opt/usun-data/usun.db"
BACKUP_GLOB = "/opt/usun-backups-v2/daily/usun-full-*.tar.gz"
COS_LOG_PATH = Path("/opt/usun-backups-v2/cos-sync.log")
MAX_BACKUP_AGE_SECONDS = 30 * 60 * 60
MIN_BACKUP_BYTES = 1024 * 1024
DISK_WARNING_PERCENT = 85.0


def load_config() -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in CONFIG_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def push(token: str, is_up: bool, message: str, ping_ms: int | None = None) -> None:
    query = {"status": "up" if is_up else "down", "msg": message}
    if ping_ms is not None:
        query["ping"] = str(ping_ms)
    url = f"http://127.0.0.1:3001/api/push/{token}?{urllib.parse.urlencode(query)}"
    with urllib.request.urlopen(url, timeout=10) as response:
        if response.status != 200:
            raise RuntimeError(f"push returned HTTP {response.status}")


def check_sqlite() -> tuple[bool, str, int]:
    started = time.monotonic()
    connection = sqlite3.connect(f"file:{DATABASE_PATH}?mode=ro", uri=True, timeout=5)
    try:
        result = connection.execute("SELECT 1").fetchone()
    finally:
        connection.close()
    elapsed_ms = round((time.monotonic() - started) * 1000)
    return result == (1,), "database readable", elapsed_ms


def check_disk() -> tuple[bool, str, None]:
    usage = shutil.disk_usage("/opt/usun-data")
    percent = usage.used / usage.total * 100
    return percent < DISK_WARNING_PERCENT, f"disk used {percent:.1f}%", None


def check_local_backup() -> tuple[bool, str, None]:
    candidates = [Path(path) for path in glob.glob(BACKUP_GLOB)]
    if not candidates:
        return False, "no daily backup found", None
    newest = max(candidates, key=lambda path: path.stat().st_mtime)
    stat = newest.stat()
    age_hours = (time.time() - stat.st_mtime) / 3600
    ok = age_hours <= MAX_BACKUP_AGE_SECONDS / 3600 and stat.st_size >= MIN_BACKUP_BYTES
    return ok, f"latest backup age {age_hours:.1f}h, size {stat.st_size // 1024 // 1024}MB", None


def check_cos_backup() -> tuple[bool, str, None]:
    if not COS_LOG_PATH.exists():
        return False, "COS sync log missing", None
    age_hours = (time.time() - COS_LOG_PATH.stat().st_mtime) / 3600
    with COS_LOG_PATH.open("rb") as handle:
        handle.seek(max(0, COS_LOG_PATH.stat().st_size - 65536))
        tail = handle.read().decode("utf-8", errors="replace").lower()
    has_success = "synced" in tail or "success" in tail or "上传成功" in tail
    ok = age_hours <= MAX_BACKUP_AGE_SECONDS / 3600 and has_success
    return ok, f"COS sync log age {age_hours:.1f}h, success marker {'found' if has_success else 'missing'}", None


def main() -> int:
    config = load_config()
    checks = [
        ("SQLITE_PUSH_TOKEN", check_sqlite),
        ("DISK_PUSH_TOKEN", check_disk),
        ("LOCAL_BACKUP_PUSH_TOKEN", check_local_backup),
        ("COS_BACKUP_PUSH_TOKEN", check_cos_backup),
    ]
    failed = False
    for token_key, check in checks:
        try:
            ok, message, ping_ms = check()
        except Exception as error:
            ok, message, ping_ms = False, f"check failed: {type(error).__name__}", None
        failed = failed or not ok
        try:
            push(config[token_key], ok, message, ping_ms)
        except Exception:
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
