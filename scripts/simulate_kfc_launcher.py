# -*- coding: utf-8 -*-
"""
simulate_kfc_launcher.py
=======================

Reproduce what the kuaifanclaw Rust launcher (``src-tauri/src/commands/
runtime.rs::start_hermes_dashboard``) does when it spawns the Hermes
python gateway.  Lets you drive the same env-var / port / log /
cleanup pipeline from a terminal or a CI script.

Why this exists
---------------
The kuaifanclaw Tauri shell is the *only* place that sets the right
combination of ``HERMES_HOME`` + ``AGENT_BROWSER_EXECUTABLE_PATH`` +
``HERMES_OFFLINE_BROWSER`` + ``PLAYWRIGHT_BROWSERS_PATH`` + path
prepends.  Without those, the Python gateway falls back to the
network-dependent ``agent-browser`` Node CLI and the built-in browser
silently fails.  This script lets you exercise the production code
path without launching the full Tauri shell.

Usage
-----

    # 1. Foreground with smoke test (port 0 = OS-assigned):
    python simulate_kfc_launcher.py --port 0 --smoke-test

    # 2. Foreground, fixed port, just run a browser tool to prove the chain:
    python simulate_kfc_launcher.py --port 64860 --smoke-browser

    # 3. Background, returns immediately, prints PID + log path:
    python simulate_kfc_launcher.py --port 64860 --detach

    # 4. Tail the log of a previously-launched instance:
    python simulate_kfc_launcher.py --tail-last

    # 5. Kill all running gateways spawned by this script:
    python simulate_kfc_launcher.py --kill-all
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import websockets  # bundled with the hermes runtime
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths (mirrors what the Rust launcher uses)
# ---------------------------------------------------------------------------

PROJECT_SRC = Path(r"D:\kuaifanclaw")
DATA_BASE    = Path(r"D:\快泛claw")
RUNTIME_DIR  = DATA_BASE / "data" / "runtimes" / "hermes"
HERMES_HOME  = DATA_BASE / "data" / "modules" / "hermes"

# Per the runtime.rs launcher + handoff: the kuaifanclaw shell spawns the
# *system* Python (3.11.9) rather than the bundled one in the runtime dir.
PYTHON_EXE = Path(r"C:\Users\admin\AppData\Local\Programs\Python\Python311\python.exe")

# Hard-coded in src-tauri/src/commands/runtime.rs as
# HERMES_DESKTOP_SESSION_TOKEN.  Matches what the GUI uses to auth REST
# and WebSocket calls.
SESSION_TOKEN = "kfc-desk-3463b6e3f34d0f12fc416939e9a81fc395f40f4730cfc145"

CHROMIUM_EXE = HERMES_HOME / "ms-playwright" / "chromium-1228" / "chrome-win64" / "chrome.exe"

LOG_DIR = DATA_BASE / "data" / "logs" / "hermes-launcher"
LOG_DIR.mkdir(parents=True, exist_ok=True)

# Tags we leave in the env so we can find our own subprocesses later
# (mirrors the unique-token trick the Rust launcher uses for its
#  ``clear_stale_hermes_dashboard_listener``).
OWNER_TAG = "kfc_simulator"


# ---------------------------------------------------------------------------
# Env construction (mirrors runtime.rs lines 900-920)
# ---------------------------------------------------------------------------


def build_env() -> dict:
    env = os.environ.copy()
    env["HERMES_HOME"] = str(HERMES_HOME)
    env["HERMES_DASHBOARD_SESSION_TOKEN"] = SESSION_TOKEN
    env["AGENT_BROWSER_EXECUTABLE_PATH"] = str(CHROMIUM_EXE)
    env["HERMES_OFFLINE_BROWSER"] = "1"
    env["PLAYWRIGHT_BROWSERS_PATH"] = str(HERMES_HOME / "ms-playwright")
    # Prepend bundled node + agent-browser shim dir to PATH so the
    # python's _find_agent_browser() finds our shim first.
    bundled_node = HERMES_HOME / "node"
    bundled_bin  = HERMES_HOME / "node_modules" / ".bin"
    extra = os.pathsep.join([str(bundled_node), str(bundled_bin)])
    env["PATH"] = extra + os.pathsep + env.get("PATH", "")
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"]      = "1"
    # Marker so other tooling can spot processes this script spawned.
    env["KFC_LAUNCHER_OWNER"] = OWNER_TAG
    return env


# ---------------------------------------------------------------------------
# Stale-listener cleanup (mirrors clear_stale_hermes_dashboard_listener)
# ---------------------------------------------------------------------------


def kill_stale_gateways() -> int:
    """Best-effort: kill any leftover ``python -m hermes_cli.main serve``
    that we previously spawned, so a fresh launch can bind the port."""
    killed = 0
    try:
        import psutil  # type: ignore
        for proc in psutil.process_iter(["pid", "cmdline", "environ"]):
            try:
                cmdline = proc.info.get("cmdline") or []
                cmd = " ".join(cmdline)
                if (
                    "hermes_cli.main" in cmd
                    and "serve" in cmd
                    and proc.info.get("environ", {}).get("KFC_LAUNCHER_OWNER") == OWNER_TAG
                ):
                    proc.terminate()
                    killed += 1
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
    except ImportError:
        # Fallback: use wmic + taskkill.  Less precise but works without psutil.
        out = subprocess.run(
            ["wmic", "process", "where",
             "name='python.exe'",
             "get", "ProcessId,CommandLine", "/FORMAT:CSV"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        for line in out.stdout.splitlines():
            if "hermes_cli.main" in line and "serve" in line:
                m = re.search(r"(\d+)\s*$", line.strip())
                if m:
                    pid = int(m.group(1))
                    try:
                        os.kill(pid, signal.SIGTERM)
                        killed += 1
                    except OSError:
                        pass
    return killed


# ---------------------------------------------------------------------------
# Launch + port discovery
# ---------------------------------------------------------------------------


def wait_for_port(stdout_log: Path, timeout: float = 45.0) -> int:
    """Tail the stdout log until uvicorn announces the port."""
    deadline = time.time() + timeout
    rx = re.compile(r"(?:Uvicorn running on https?://127\.0\.0\.1:(\d+)|HERMES_BACKEND_READY\s+port=(\d+))")
    while time.time() < deadline:
        if stdout_log.is_file():
            try:
                with open(stdout_log, "r", encoding="utf-8", errors="replace") as f:
                    for line in f:
                        m = rx.search(line)
                        if m:
                            port_str = m.group(1) or m.group(2)
                            if port_str:
                                return int(port_str)
            except OSError:
                pass
        time.sleep(0.2)
    raise TimeoutError("Gateway did not bind a port within %.0fs" % timeout)


def spawn_gateway(port: int, label: str | None = None) -> tuple[subprocess.Popen, Path, Path]:
    label = label or time.strftime("%Y%m%d-%H%M%S")
    stdout_log = LOG_DIR / f"hermes-{label}.log"
    stderr_log = LOG_DIR / f"hermes-{label}.err"
    env = build_env()
    cmd = [
        str(PYTHON_EXE), "-X", "utf8",
        "-m", "hermes_cli.main", "serve",
        "--host", "127.0.0.1", "--port", str(port),
    ]
    proc = subprocess.Popen(
        cmd,
        cwd=str(RUNTIME_DIR),
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=open(stdout_log, "wb"),
        stderr=open(stderr_log, "wb"),
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0,
    )
    return proc, stdout_log, stderr_log


# ---------------------------------------------------------------------------
# Smoke tests (WebSocket + browser tool)
# ---------------------------------------------------------------------------


async def _ws_rpc(port: int, method: str, params: dict | None = None, timeout: float = 15.0):
    ws_url = f"ws://127.0.0.1:{port}/api/ws?token={SESSION_TOKEN}"
    async with websockets.connect(ws_url, open_timeout=5) as ws:
        rid = 0
        async def call(m, p):
            nonlocal rid
            rid += 1
            await ws.send(json.dumps({"jsonrpc": "2.0", "id": rid, "method": m, "params": p or {}}))
            for _ in range(500):
                raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
                data = json.loads(raw)
                if data.get("method") == "event":
                    continue  # event - ignore
                if "id" in data and data["id"] == rid:
                    if "error" in data:
                        raise RuntimeError(f"{m}: {data['error']}")
                    return data.get("result") or {}
            raise TimeoutError(f"no response for {m}")
        return await call(method, params or {})


async def smoke_test(port: int) -> None:
    print("  [smoke] session.create ...")
    sess = await _ws_rpc(port, "session.create", {"source": "kfc-sim"})
    sid = sess["session_id"]
    print(f"  [smoke]   session_id={sid}")
    print(f"  [smoke]   model={sess.get('info', {}).get('model', '?')}")
    return sid


async def smoke_browser(port: int) -> None:
    print("  [browser-smoke] session.create ...")
    sess = await _ws_rpc(port, "session.create", {"source": "kfc-sim-browser"})
    sid = sess["session_id"]
    print(f"  [browser-smoke]   session_id={sid}")

    print("  [browser-smoke] prompt.submit: 'open example.com' ...")
    ws_url = f"ws://127.0.0.1:{port}/api/ws?token={SESSION_TOKEN}"
    rid = 1
    last_event_ts = time.time()
    events_seen = []
    async with websockets.connect(ws_url, open_timeout=5) as ws:
        await ws.send(json.dumps({
            "jsonrpc": "2.0", "id": rid, "method": "prompt.submit",
            "params": {"session_id": sid, "text": "Use the browser to open https://www.example.com and tell me the page title.", "stream": True},
        }))
        deadline = time.time() + 120
        while time.time() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=10)
            except asyncio.TimeoutError:
                if time.time() - last_event_ts > 60:
                    print("  [browser-smoke]   60s of silence; stopping")
                    break
                continue
            data = json.loads(raw)
            if "id" in data:
                if "error" in data:
                    print(f"  [browser-smoke]   prompt.submit error: {data['error']}")
                continue
            if data.get("method") == "event":
                p = data.get("params") or {}
                ptype = p.get("type", "?")
                payload = p.get("payload") or {}
                events_seen.append(ptype)
                if ptype == "tool.start":
                    tc = payload.get("context") or payload.get("name", "?")
                    print(f"  [browser-smoke]   tool.start   {tc}")
                elif ptype == "tool.complete":
                    res = payload.get("result", {})
                    ok = res.get("success")
                    title = res.get("title") if isinstance(res, dict) else None
                    dur = payload.get("duration_s")
                    print(f"  [browser-smoke]   tool.complete success={ok} title={title!r} duration={dur}s")
                elif ptype == "message.complete":
                    txt = payload.get("text", "")
                    print(f"  [browser-smoke]   message.complete: {txt[:200]!r}")
                elif ptype == "final":
                    print(f"  [browser-smoke]   final event")
                    break
                elif ptype == "error":
                    print(f"  [browser-smoke]   ERROR: {payload}")
                    break
                last_event_ts = time.time()
    summary = "events=" + ",".join(events_seen)
    print(f"  [browser-smoke] DONE ({summary})")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def cmd_spawn(args) -> int:
    print("=== simulating kuaifanclaw Rust launcher ===")
    print(f"  Python:        {PYTHON_EXE}")
    print(f"  Runtime dir:   {RUNTIME_DIR}")
    print(f"  HERMES_HOME:   {HERMES_HOME}")
    print(f"  Chromium:      {CHROMIUM_EXE}")
    print(f"  Log dir:       {LOG_DIR}")
    print(f"  Port:          {args.port}")
    print()
    n = kill_stale_gateways()
    if n:
        print(f"  killed {n} stale gateway process(es)")

    label = "smoke" if args.smoke_test or args.smoke_browser else None
    proc, out_log, err_log = spawn_gateway(args.port, label=label)
    print(f"  spawned pid={proc.pid}")
    print(f"  stdout: {out_log}")
    print(f"  stderr: {err_log}")
    print()

    try:
        port = wait_for_port(out_log)
    except TimeoutError as e:
        print(f"ERROR: {e}")
        print("--- last 30 lines of stdout ---")
        try:
            with open(out_log, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
                for line in lines[-30:]:
                    print("  " + line.rstrip())
        except OSError:
            pass
        proc.terminate()
        return 2

    print(f"  gateway listening on http://127.0.0.1:{port}")
    print(f"  WS endpoint:   ws://127.0.0.1:{port}/api/ws?token=kfc-desk-...")
    print()

    rc = 0
    try:
        if args.smoke_test:
            print("=== running WS smoke test ===")
            asyncio.run(smoke_test(port))
            print()
        if args.smoke_browser:
            print("=== running end-to-end browser smoke test ===")
            asyncio.run(smoke_browser(port))
            print()

        if args.exit_after_smoke:
            print("=== --exit-after-smoke: tearing down gateway ===")
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
            return rc

        if args.detach:
            print("=== gateway running in background ===")
            print(f"  pid:  {proc.pid}")
            print(f"  port: {port}")
            print(f"  log:  {out_log}")
            print(f"  to stop:    taskkill /F /T /PID {proc.pid}")
            print(f"  to attach:  Get-Content '{out_log}' -Wait")
        else:
            print("=== gateway running in foreground (Ctrl-C to stop) ===")
            try:
                while proc.poll() is None:
                    time.sleep(0.5)
            except KeyboardInterrupt:
                print()
                print("  stopping gateway...")
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
    except Exception as e:
        print(f"ERROR during smoke test: {type(e).__name__}: {e}")
        proc.terminate()
        rc = 1
    finally:
        if not args.detach:
            if proc.poll() is None:
                proc.terminate()
                try: proc.wait(timeout=5)
                except subprocess.TimeoutExpired: proc.kill()
    return rc


def cmd_kill_all(_args) -> int:
    n = kill_stale_gateways()
    print(f"killed {n} stale gateway process(es)")
    return 0


def cmd_tail_last(_args) -> int:
    logs = sorted(LOG_DIR.glob("hermes-*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not logs:
        print("no log files found in", LOG_DIR)
        return 1
    last = logs[0]
    print(f"=== tailing {last} ===")
    try:
        with open(last, "r", encoding="utf-8", errors="replace") as f:
            f.seek(0, os.SEEK_END)
            while True:
                line = f.readline()
                if not line:
                    time.sleep(0.2)
                    continue
                print(line.rstrip())
    except KeyboardInterrupt:
        return 0
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split(chr(10))[1], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=0, help="port to bind (0 = OS-assigned)")
    ap.add_argument("--smoke-test", action="store_true", help="after launch, run a basic WS smoke test")
    ap.add_argument("--smoke-browser", action="store_true", help="after launch, run an end-to-end browser_navigate test")
    ap.add_argument("--detach", action="store_true", help="don't wait; print PID + log path and return")
    ap.add_argument("--kill-all", action="store_true", help="kill any leftover gateway processes and exit")
    ap.add_argument("--exit-after-smoke", action="store_true", help="after smoke tests finish, terminate the gateway and exit cleanly")
    ap.add_argument("--tail-last", action="store_true", help="tail the most recent log file")
    args = ap.parse_args()
    if args.kill_all:
        return cmd_kill_all(args)
    if args.tail_last:
        return cmd_tail_last(args)
    return cmd_spawn(args)


if __name__ == "__main__":
    sys.exit(main())