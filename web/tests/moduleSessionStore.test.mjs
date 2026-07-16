import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const compiledStore = new URL("../../artifacts/test/web/stores/moduleSessionStore.mjs", import.meta.url);
const storeExists = existsSync(compiledStore);

test("module session store fixture is available", () => {
  assert.equal(storeExists, true);
});

if (storeExists) {
  const { mergeModuleSessions, DEFAULT_NEW_CHAT_TITLE } = await import(compiledStore);

  test("returns current list when remote is empty", () => {
    const cur = [
      { id: "a", moduleId: "openclaw", title: "A", updatedAt: 1 },
    ];
    const out = mergeModuleSessions(cur, []);
    assert.deepEqual(out, cur);
  });

  test("returns remote list when local is empty", () => {
    const inc = [
      { id: "x", moduleId: "openclaw", title: "X", updatedAt: 9 },
    ];
    const out = mergeModuleSessions([], inc);
    assert.deepEqual(out.map((s) => s.id), ["x"]);
  });

  test("preserves local title when remote still shows the default placeholder", () => {
    const cur = [
      { id: "a", moduleId: "openclaw", title: "My Chat", lastMessage: "hi", updatedAt: 5, createdAt: 1 },
    ];
    const inc = [
      { id: "a", moduleId: "openclaw", title: DEFAULT_NEW_CHAT_TITLE, updatedAt: 2, createdAt: 1 },
    ];
    const out = mergeModuleSessions(cur, inc);
    assert.equal(out[0].title, "My Chat");
    assert.equal(out[0].lastMessage, "hi");
    assert.equal(out[0].createdAt, 1);
  });

  test("uses remote title once it stops being the default placeholder", () => {
    const cur = [
      { id: "a", moduleId: "openclaw", title: "Local Name", updatedAt: 1, createdAt: 1 },
    ];
    const inc = [
      { id: "a", moduleId: "openclaw", title: "Gateway Name", updatedAt: 5, createdAt: 1 },
    ];
    const out = mergeModuleSessions(cur, inc);
    assert.equal(out[0].title, "Gateway Name");
  });

  test("keeps local-only sessions that the gateway has not synced yet", () => {
    const cur = [
      { id: "local-only", moduleId: "openclaw", title: "L", updatedAt: 10 },
    ];
    const inc = [
      { id: "remote", moduleId: "openclaw", title: "R", updatedAt: 20 },
    ];
    const out = mergeModuleSessions(cur, inc);
    const ids = out.map((s) => s.id).sort();
    assert.deepEqual(ids, ["local-only", "remote"]);
  });

  test("keeps local lastMessage when remote has none yet", () => {
    const cur = [
      { id: "a", moduleId: "openclaw", title: "T", lastMessage: "hello", updatedAt: 1, createdAt: 1 },
    ];
    const inc = [
      { id: "a", moduleId: "openclaw", title: "T", updatedAt: 1, createdAt: 1 },
    ];
    const out = mergeModuleSessions(cur, inc);
    assert.equal(out[0].lastMessage, "hello");
  });

  test("sorts merged list by updatedAt descending", () => {
    const cur = [
      { id: "old", moduleId: "openclaw", title: "old", updatedAt: 1 },
    ];
    const inc = [
      { id: "new", moduleId: "openclaw", title: "new", updatedAt: 5 },
      { id: "mid", moduleId: "openclaw", title: "mid", updatedAt: 3 },
    ];
    const out = mergeModuleSessions(cur, inc);
    assert.deepEqual(out.map((s) => s.id), ["new", "mid", "old"]);
  });
}
