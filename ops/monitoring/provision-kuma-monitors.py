#!/usr/bin/env python3
"""Idempotently provision the minimum Uptime Kuma monitor set."""

from __future__ import annotations

import os
import secrets
import sqlite3
from pathlib import Path


DATABASE_PATH = Path("/opt/uptime-kuma/data/kuma.db")
CONFIG_PATH = Path("/etc/usun-monitoring/push.env")

HTTP_MONITORS = [
    ("01 主站 HTTPS", "http", "https://usunai.top/", None, 60, "主站可访问性"),
    ("02 首页核心内容", "keyword", "https://usunai.top/", "友尚AI", 120, "首页应包含稳定品牌文字"),
    ("03 后端健康接口", "keyword", "https://usunai.top/api/health", '"ok":true', 60, "后端聚合健康接口"),
    ("04 管理后台登录页", "http", "https://usunai.top/admin/login", None, 300, "后台登录入口可访问性"),
    ("09a www 主域名与 SSL", "http", "https://www.usunai.top/", None, 600, "www 主域名、DNS 与证书"),
    ("09b cn 根域名与 SSL", "http", "https://usunai.cn/", None, 600, "cn 根域名、DNS 与证书"),
    ("09c cn www 域名与 SSL", "http", "https://www.usunai.cn/", None, 600, "cn www 域名、DNS 与证书"),
    ("09d 状态页域名与 SSL", "http", "https://status.usunai.top/", None, 600, "状态页域名、DNS 与证书"),
]

PUSH_MONITORS = [
    ("05 SQLite 数据库", "SQLITE_PUSH_TOKEN", "数据库只读连接与简单查询"),
    ("06 服务器磁盘", "DISK_PUSH_TOKEN", "数据盘占用率，阈值 85%"),
    ("07 本地备份", "LOCAL_BACKUP_PUSH_TOKEN", "本机每日备份新鲜度与文件大小"),
    ("08 COS 异地备份", "COS_BACKUP_PUSH_TOKEN", "腾讯云 COS 同步日志新鲜度与成功标记"),
]


def insert_monitor(connection: sqlite3.Connection, values: dict[str, object]) -> None:
    exists = connection.execute("SELECT id FROM monitor WHERE name = ?", (values["name"],)).fetchone()
    if exists:
        return
    columns = ", ".join(values)
    placeholders = ", ".join("?" for _ in values)
    connection.execute(
        f"INSERT INTO monitor ({columns}) VALUES ({placeholders})",
        tuple(values.values()),
    )


def main() -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    config: dict[str, str] = {}
    if CONFIG_PATH.exists():
        for line in CONFIG_PATH.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                config[key.strip()] = value.strip()

    connection = sqlite3.connect(DATABASE_PATH)
    try:
        user_row = connection.execute("SELECT id FROM user ORDER BY id LIMIT 1").fetchone()
        if not user_row:
            raise RuntimeError("Uptime Kuma administrator has not been initialized")
        user_id = user_row[0]

        for name, monitor_type, url, keyword, interval, description in HTTP_MONITORS:
            values: dict[str, object] = {
                "name": name,
                "active": 1,
                "user_id": user_id,
                "interval": interval,
                "url": url,
                "type": monitor_type,
                "maxretries": 2,
                "retry_interval": 30,
                "timeout": 15,
                "expiry_notification": 1,
                "description": description,
            }
            if keyword:
                values["keyword"] = keyword
            insert_monitor(connection, values)

        for name, config_key, description in PUSH_MONITORS:
            token = config.setdefault(config_key, secrets.token_urlsafe(24)[:32])
            insert_monitor(
                connection,
                {
                    "name": name,
                    "active": 1,
                    "user_id": user_id,
                    "interval": 300,
                    "type": "push",
                    "maxretries": 1,
                    "retry_interval": 60,
                    "push_token": token,
                    "timeout": 15,
                    "description": description,
                },
            )
        connection.commit()
    finally:
        connection.close()

    content = "".join(f"{key}={value}\n" for key, value in sorted(config.items()))
    CONFIG_PATH.write_text(content, encoding="utf-8")
    os.chmod(CONFIG_PATH, 0o600)


if __name__ == "__main__":
    main()
