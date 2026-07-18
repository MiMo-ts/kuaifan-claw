import urllib.request, json
TOKEN = "kfc-desk-3463b6e3f34d0f12fc416939e9a81fc395f40f4730cfc145"
BASE = "http://127.0.0.1:5174"
def get(path):
    req = urllib.request.Request(BASE + path, headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=5) as r:
        return r.status, r.headers.get("content-type", ""), r.read().decode("utf-8", errors="replace")
s, ct, body = get("/api/sessions")
data = json.loads(body)
print("sessions count:", len(data.get("sessions", [])))
for sess in data.get("sessions", [])[:3]:
    print(" ", sess.get("id"), "messages:", sess.get("message_count"), "title:", sess.get("title"))
