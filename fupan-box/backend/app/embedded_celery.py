"""开发模式: 把 celery worker + beat 作为 fastapi 的子进程拉起 / 回收.

只在 reload 主进程或非 reload 模式启动一次, uvicorn --reload 子进程不会重复 spawn.

使用:
    settings.dev_embed_celery = True (默认)
    在 main.py lifespan 里调 start_embedded_celery() / stop_embedded_celery()

生产 (docker-compose worker / beat 独立服务):
    设 DEV_EMBED_CELERY=0, 这里直接返回不做事.
"""
from __future__ import annotations

import logging
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

logger = logging.getLogger(__name__)

_PROCS: list[subprocess.Popen] = []
_LOCK_FILE = Path("/tmp/fupanbox_celery.lock")  # 跨进程锁, 避免 --reload 重复 spawn
_LOCK_TTL_S = 10  # 主进程超过这个时间没刷新就视为死锁


def _redis_alive(redis_url: str, timeout: float = 0.5) -> bool:
    """快速 ping, 不引入 redis-py 依赖."""
    try:
        # 解析 redis://host:port[/db]
        u = redis_url.removeprefix("redis://").split("/")[0]
        host, _, port = u.partition(":")
        port = int(port or 6379)
        with socket.create_connection((host or "localhost", port), timeout=timeout) as s:
            s.sendall(b"PING\r\n")
            data = s.recv(64)
            return b"PONG" in data
    except Exception:
        return False


def _acquire_lock() -> bool:
    """简易 PID lock. 防止 uvicorn --reload 多次 spawn."""
    now = time.time()
    if _LOCK_FILE.exists():
        try:
            stat = _LOCK_FILE.stat()
            if now - stat.st_mtime < _LOCK_TTL_S:
                # 锁仍新鲜, 主进程还活着 → 跳过
                return False
        except FileNotFoundError:
            pass
    try:
        _LOCK_FILE.write_text(str(os.getpid()))
        return True
    except Exception:
        return False


def _refresh_lock():
    try:
        _LOCK_FILE.touch()
    except Exception:
        pass


def _release_lock():
    try:
        if _LOCK_FILE.exists():
            txt = _LOCK_FILE.read_text().strip()
            if txt == str(os.getpid()):
                _LOCK_FILE.unlink()
    except Exception:
        pass


def _resolve_celery_bin() -> str | None:
    """优先用同 venv 的 celery, fallback 到 PATH."""
    py_dir = Path(sys.executable).parent
    candidate = py_dir / "celery"
    if candidate.exists():
        return str(candidate)
    found = shutil.which("celery")
    return found


def start_embedded_celery() -> dict:
    """拉起 celery worker + beat 子进程, 返回 {worker_pid, beat_pid, status}."""
    from app.config import get_settings

    settings = get_settings()
    if not settings.dev_embed_celery:
        return {"status": "disabled"}

    if not _acquire_lock():
        return {"status": "skipped_lock_held"}

    if not _redis_alive(settings.redis_url):
        logger.warning(
            "[embedded-celery] Redis 未启动 (%s) — celery worker/beat 不拉起. "
            "运行 `docker compose up -d redis` 后重启 backend.",
            settings.redis_url,
        )
        _release_lock()
        return {"status": "redis_down", "redis_url": settings.redis_url}

    celery_bin = _resolve_celery_bin()
    if not celery_bin:
        logger.warning("[embedded-celery] 未找到 celery 命令, 跳过")
        _release_lock()
        return {"status": "celery_not_found"}

    backend_dir = Path(__file__).resolve().parent.parent
    log_dir = Path("/tmp/fupanbox_logs")
    log_dir.mkdir(exist_ok=True)

    common_env = {**os.environ}

    worker_log = open(log_dir / "celery_worker.log", "ab", buffering=0)
    beat_log = open(log_dir / "celery_beat.log", "ab", buffering=0)

    try:
        worker_proc = subprocess.Popen(
            [
                celery_bin, "-A", "app.tasks.celery_app", "worker",
                "--loglevel=info",
                "-c", str(settings.dev_embed_celery_concurrency),
                "-Q", "celery",
                "-n", "embedded@%h",
            ],
            cwd=str(backend_dir),
            stdout=worker_log,
            stderr=subprocess.STDOUT,
            env=common_env,
            start_new_session=True,
        )
    except Exception as e:
        logger.error(f"[embedded-celery] worker 启动失败: {e}")
        _release_lock()
        return {"status": "worker_failed", "error": str(e)}

    try:
        beat_proc = subprocess.Popen(
            [
                celery_bin, "-A", "app.tasks.celery_app", "beat",
                "--loglevel=info",
                "-s", str(backend_dir / "celerybeat-schedule"),
            ],
            cwd=str(backend_dir),
            stdout=beat_log,
            stderr=subprocess.STDOUT,
            env=common_env,
            start_new_session=True,
        )
    except Exception as e:
        logger.error(f"[embedded-celery] beat 启动失败: {e}")
        try:
            worker_proc.terminate()
        except Exception:
            pass
        _release_lock()
        return {"status": "beat_failed", "error": str(e)}

    _PROCS.extend([worker_proc, beat_proc])
    logger.info(
        "[embedded-celery] worker pid=%s beat pid=%s logs=/tmp/fupanbox_logs/",
        worker_proc.pid, beat_proc.pid,
    )
    return {
        "status": "started",
        "worker_pid": worker_proc.pid,
        "beat_pid": beat_proc.pid,
        "log_dir": str(log_dir),
    }


def stop_embedded_celery():
    for p in _PROCS:
        try:
            os.killpg(os.getpgid(p.pid), signal.SIGTERM)
        except Exception:
            try:
                p.terminate()
            except Exception:
                pass
    deadline = time.time() + 5.0
    for p in _PROCS:
        timeout = max(0.1, deadline - time.time())
        try:
            p.wait(timeout=timeout)
        except Exception:
            try:
                os.killpg(os.getpgid(p.pid), signal.SIGKILL)
            except Exception:
                try:
                    p.kill()
                except Exception:
                    pass
    _PROCS.clear()
    _release_lock()
    logger.info("[embedded-celery] worker + beat stopped")


def heartbeat():
    """lifespan 后台心跳: 刷新 lock + 检测子进程是否意外死亡."""
    _refresh_lock()
    dead = [p for p in _PROCS if p.poll() is not None]
    for p in dead:
        logger.warning(
            "[embedded-celery] 子进程 pid=%s 已退出 (returncode=%s), 查看 /tmp/fupanbox_logs/",
            p.pid, p.returncode,
        )
        _PROCS.remove(p)
    return {
        "alive": [p.pid for p in _PROCS if p.poll() is None],
        "dead": [p.pid for p in dead],
    }
