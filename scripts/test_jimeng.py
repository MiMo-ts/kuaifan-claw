# -*- coding: utf-8 -*-
"""test_jimeng.py - 验证 Hermes agent 真访问 jimeng.jianying.com 的浏览器自动化链路."""
import asyncio, json, os, re, subprocess, time
from pathlib import Path
import websockets

SIM = Path(r"D:\kuaifanclaw\scripts\simulate_kfc_launcher.py")
PYTHON = Path(r"C:\Users\admin\AppData\Local\Programs\Python\Python311\python.exe")
HERMES_HOME = Path(r"D:\快泛claw\data\modules\hermes")
RUNTIME_DIR = Path(r"D:\快泛claw\data\runtimes\hermes")
CHROMIUM = HERMES_HOME / "ms-playwright" / "chromium-1228" / "chrome-win64" / "chrome.exe"
TOKEN = "kfc-desk-3463b6e3f34d0f12fc416939e9a81fc395f40f4730cfc145"
PROMPT = (
    "用浏览器打开 https://jimeng.jianying.com/ ，等待页面完全加载，"
    "然后用 browser_snapshot 读出页面顶部导航菜单和首屏主要内容，"
    "告诉我：1) 首屏能看到什么；2) 是否需要登录才能用；3) 文生图/文生视频的入口在哪个位置。"
)

def kill_stale():
    subprocess.run([str(PYTHON), str(SIM), "--kill-all"], capture_output=True)

def build_env():
    env = os.environ.copy()
    env["HERMES_HOME"] = str(HERMES_HOME)
    env["PLAYWRIGHT_BROWSERS_PATH"] = str(HERMES_HOME / "ms-playwright")
    if CHROMIUM.exists():
        env["AGENT_BROWSER_EXECUTABLE_PATH"] = str(CHROMIUM)
    env["HERMES_OFFLINE_BROWSER"] = "1"
    env["HERMES_DASHBOARD_SESSION_TOKEN"] = TOKEN
    path_parts = [str(HERMES_HOME / "node"), str(HERMES_HOME / "node_modules" / ".bin")] + [p for p in env.get("PATH", "").split(os.pathsep) if p]
    env["PATH"] = os.pathsep.join(path_parts)
    return env

def find_port(log: Path, timeout=45):
    rx = re.compile(r"HERMES_BACKEND_READY port=(\d+)")
    deadline = time.time() + timeout
    while time.time() < deadline:
        if log.exists():
            m = rx.search(log.read_text(encoding="utf-8", errors="replace"))
            if m:
                return int(m.group(1))
        time.sleep(0.2)
    return None

async def main():
    kill_stale()
    log = RUNTIME_DIR / "_jimeng.log"
    err = RUNTIME_DIR / "_jimeng.err"
    if log.exists(): log.unlink()
    if err.exists(): err.unlink()
    fout = open(log, "wb")
    ferr = open(err, "wb")
    proc = subprocess.Popen(
        [str(PYTHON), "-X", "utf8", "-m", "hermes_cli.main", "serve",
         "--host", "127.0.0.1", "--port", "0"],
        cwd=str(RUNTIME_DIR), env=build_env(),
        stdin=subprocess.DEVNULL, stdout=fout, stderr=ferr,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
    )
    port = find_port(log)
    if not port:
        print("GATEWAY_TIMEOUT")
        proc.terminate(); return
    print(f"GATEWAY_READY port={port} pid={proc.pid}")
    events = []
    final_text = ""
    try:
        async with websockets.connect(
            f"ws://127.0.0.1:{port}/api/ws?token={TOKEN}", open_timeout=5
        ) as ws:
            await ws.send(json.dumps({
                "jsonrpc": "2.0", "id": 1, "method": "session.create",
                "params": {"source": "jimeng-test"},
            }))
            sid = None
            while True:
                d = json.loads(await asyncio.wait_for(ws.recv(), timeout=15))
                if d.get("id") == 1:
                    sid = d["result"]["session_id"]
                    break
            print(f"SESSION sid={sid} model={d['result'].get('info', {}).get('model', '?')}")

            await ws.send(json.dumps({
                "jsonrpc": "2.0", "id": 2, "method": "prompt.submit",
                "params": {"session_id": sid, "text": PROMPT, "stream": True},
            }))

            deadline = time.time() + 180
            last_ts = time.time()
            while time.time() < deadline:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=15)
                except asyncio.TimeoutError:
                    if time.time() - last_ts > 90:
                        print("TIMEOUT_90s_silence")
                        break
                    continue
                d = json.loads(raw)
                if d.get("method") == "event":
                    p = d.get("params") or {}
                    t = p.get("type")
                    pl = p.get("payload") or {}
                    events.append(t)
                    if t == "tool.start":
                        ctx = pl.get("context") or pl.get("name", "?")
                        print(f"  tool.start   {ctx}")
                    elif t == "tool.complete":
                        res = pl.get("result", {})
                        ok = res.get("success") if isinstance(res, dict) else None
                        dur = pl.get("duration_s")
                        print(f"  tool.complete ok={ok} dur={dur}s")
                    elif t == "message.delta":
                        txt = pl.get("text", "")
                        if txt:
                            print(f"  delta: {txt[:120]!r}")
                    elif t == "message.complete":
                        final_text = pl.get("text", "")
                        print(f"  message.complete: {final_text[:1500]!r}")
                    elif t == "error":
                        print(f"  ERROR: {pl}")
                        break
                    last_ts = time.time()
                elif d.get("id") == 2:
                    err = d.get("error")
                    if err: print(f"  prompt.submit err: {err}")
    finally:
        proc.terminate()
        try: proc.wait(timeout=5)
        except subprocess.TimeoutExpired: proc.kill()
    print(f"EVENT_SUMMARY: {','.join(events)}")
    print(f"FINAL_LEN: {len(final_text)}")

asyncio.run(main())