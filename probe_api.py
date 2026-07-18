import urllib.request, json, time, sys
TOKEN = "kfc-desk-3463b6e3f34d0f12fc416939e9a81fc395f40f4730cfc145"
BASE = "http://127.0.0.1:5174"
def get(path):
    req = urllib.request.Request(BASE + path, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=5) as r:
        return r.status, r.read().decode("utf-8", errors="replace")
for p in ["/api/health", "/api/version", "/api/sessions", "/api/models", "/api/agents", "/api/instances"]:
    try:
        s, body = get(p)
        print(s, p, body[:200].replace("\n", " "))
    except Exception as e:
        print("ERR", p, repr(e))
