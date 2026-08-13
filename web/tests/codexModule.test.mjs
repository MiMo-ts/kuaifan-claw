import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('registers Codex as an additive installable module', async () => {
  const [registry, cards, wizard, config] = await Promise.all([
    readFile(new URL('src/modules/registry.ts', root), 'utf8'),
    readFile(new URL('src/components/ModuleCardsModal.tsx', root), 'utf8'),
    readFile(new URL('src/pages/WizardPage.tsx', root), 'utf8'),
    readFile(new URL('../src-tauri/tauri.conf.json', root), 'utf8'),
  ]);

  assert.match(registry, /codex:\s*\{[^}]*available:\s*true/);
  assert.match(cards, /key:\s*"codex"[\s\S]*available:\s*true/);
  assert.match(cards, /get_codex_install_status/);
  assert.match(wizard, /codex:\s*\[/);
  assert.match(config, /bundled-codex\/\*/);
});

test('release builds stage a freshly built Codex++ runtime in the internal package', async () => {
  const releaseBuild = await readFile(new URL('../src-tauri/build-all.ps1', root), 'utf8');

  assert.match(releaseBuild, /cargo build -p codex-plus-launcher --release/);
  assert.match(releaseBuild, /bundled-codex/);
  assert.match(releaseBuild, /RC_PATH/);
});

test('leaves the OpenClaw and Hermes installers registered', async () => {
  const [registry, installer, runtime] = await Promise.all([
    readFile(new URL('src/modules/registry.ts', root), 'utf8'),
    readFile(new URL('../src-tauri/src/commands/installer.rs', root), 'utf8'),
    readFile(new URL('../src-tauri/src/commands/runtime.rs', root), 'utf8'),
  ]);

  assert.match(registry, /openclaw:\s*\{[^}]*available:\s*true/);
  assert.match(registry, /hermes:\s*\{[^}]*available:\s*true/);
  assert.match(installer, /install_openclaw/);
  assert.match(runtime, /install_hermes_runtime/);
});

test('keeps the return-home action visible after ChatGPT installation is detected', async () => {
  const install = await readFile(new URL('src/components/wizard/CodexInstall.tsx', root), 'utf8');

  assert.doesNotMatch(install, /hasReturnedHome/);
  assert.match(install, /status\?\.installed \? <button onClick=\{onNext\}/);
});

test('checks Codex installation status when the module center opens', async () => {
  const cards = await readFile(new URL('src/components/ModuleCardsModal.tsx', root), 'utf8');

  assert.match(cards, /const codexStatus = await invoke<\{ installed: boolean \}>\("get_codex_install_status"\);/);
  assert.match(cards, /installed\.codex = codexStatus\?\.installed \?\? false;/);
});
