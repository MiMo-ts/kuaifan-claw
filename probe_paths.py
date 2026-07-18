import urllib.request, json
TOKEN = "kfc-desk-3463b6e3f34d0f12fc416939e9a81fc395f40f4730cfc145"
BASE = "http://127.0.0.1:5174"
def get(path):
    req = urllib.request.Request(BASE + path, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=5) as r:
        return r.status, r.read().decode("utf-8", errors="replace")
# Look at the openapi spec
s, body = get("/openapi.json")
data = json.loads(body)
paths = sorted(data.get("paths", {}).keys())
for p in paths:
    if "chat" in p or "send" in p or "session" in p or "stream" in p or "run" in p:
        print(p, list(data["paths"][p].keys()))
