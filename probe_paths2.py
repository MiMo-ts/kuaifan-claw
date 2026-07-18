import urllib.request, json
TOKEN = "kfc-desk-3463b6e3f34d0f12fc416939e9a81fc395f40f4730cfc145"
BASE = "http://127.0.0.1:5174"
def get(path):
    req = urllib.request.Request(BASE + path, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=5) as r:
        return r.read().decode("utf-8", errors="replace")
body = get("/openapi.json")
data = json.loads(body)
for p, m in sorted(data["paths"].items()):
    for verb, info in m.items():
        if verb in ("get","post","put","delete","patch"):
            print(verb.upper(), p)
