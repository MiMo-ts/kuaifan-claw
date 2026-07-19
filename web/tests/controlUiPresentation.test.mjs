import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const enhancerPath = resolve(
  projectRoot,
  "src-tauri/resources/control-ui-enhancer.js",
);

function loadPresentationApi() {
  const context = { console };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(enhancerPath, "utf8"), context, {
    filename: enhancerPath,
  });
  return context.KuaifanControlUiPresentation;
}

test("collapses one exact consecutive assistant-text repeat", () => {
  const api = loadPresentationApi();
  const text = "海报生成完成，红色商务风，AI 智能助手主题。";

  assert.equal(api.collapseExactDuplicateText(`${text}\n${text}`), text);
  assert.equal(api.collapseExactDuplicateText(`${text}\n不同的文本。`), `${text}\n不同的文本。`);
});

test("does not collapse short repeated text or structured content", () => {
  const api = loadPresentationApi();

  assert.equal(api.collapseExactDuplicateText("好的\n好的"), "好的\n好的");
  assert.equal(api.collapseExactDuplicateText("```txt\ncopy\n```\n```txt\ncopy\n```"), "```txt\ncopy\n```\n```txt\ncopy\n```");
});

test("keeps one image for each exact source", () => {
  const api = loadPresentationApi();

  assert.deepEqual(
    Array.from(api.uniqueImageSources(["https://cdn.example.test/a.png", "https://cdn.example.test/a.png", "https://cdn.example.test/b.png"])),
    ["https://cdn.example.test/a.png", "https://cdn.example.test/b.png"],
  );
});

test("finds assistant groups inside nested open Shadow DOM", () => {
  const api = loadPresentationApi();
  const assistantGroup = { id: "assistant-group" };
  const nestedShadowRoot = {
    querySelectorAll(selector) {
      if (selector === ".chat-group.assistant") return [assistantGroup];
      return [];
    },
  };
  const shadowHost = { shadowRoot: nestedShadowRoot };
  const documentRoot = {
    querySelectorAll(selector) {
      if (selector === "*") return [shadowHost];
      return [];
    },
  };

  assert.deepEqual(
    Array.from(api.findAssistantGroups(documentRoot)),
    [assistantGroup],
  );
});
