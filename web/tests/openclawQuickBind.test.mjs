import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const quickBindSource = await readFile(
  path.join(webDir, "src", "components", "wizard", "QuickBindModal.tsx"),
  "utf8",
);
const createInstanceSource = await readFile(
  path.join(webDir, "src", "components", "wizard", "CreateInstance.tsx"),
  "utf8",
);

test("Feishu quick bind carries the scanned user into the instance allowlist", () => {
  assert.match(quickBindSource, /user_open_id\?: string/);
  assert.match(quickBindSource, /allowFrom:\s*result\.user_open_id/);
  assert.match(
    quickBindSource,
    /dmPolicy:\s*result\.user_open_id\s*\?\s*['"]allowlist['"]\s*:\s*undefined/,
  );
  assert.match(
    createInstanceSource,
    /allowFrom:\s*data\.allowFrom\s*\?\?\s*prev\.allowFrom/,
  );
  assert.match(
    createInstanceSource,
    /dmPolicy:\s*data\.dmPolicy\s*\?\?\s*prev\.dmPolicy/,
  );
});
