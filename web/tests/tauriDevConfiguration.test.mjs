import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceDir = path.resolve(webDir, "..");
const cargoToml = await readFile(path.join(workspaceDir, "src-tauri", "Cargo.toml"), "utf8");
const tauriConfig = await readFile(path.join(workspaceDir, "src-tauri", "tauri.conf.json"), "utf8");

test("development build can disable bundled custom protocol and use the Vite dev URL", () => {
  const tauriDependency = cargoToml.match(/^tauri\s*=\s*\{[^\n]+\}$/m)?.[0] ?? "";

  assert.match(tauriConfig, /"devUrl"\s*:\s*"http:\/\/127\.0\.0\.1:5173"/);
  assert.doesNotMatch(tauriDependency, /"custom-protocol"/);
  assert.match(cargoToml, /^tauri-custom-protocol\s*=\s*\["tauri\/custom-protocol"\]/m);
});
