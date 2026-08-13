import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('Codex page uses the Kuaifan catalog, wraps save-and-launch arguments, and embeds manager controls', async () => {
  const source = await readFile(new URL('../src/pages/CodexPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /https:\/\/kuaifanio\.cn\/v1/);
  assert.match(source, /invoke<Model\[\]>\("list_codex_kuaifan_marketplace_models"\)/);
  assert.match(source, /save_and_launch_codex_kuaifan", \{\s*request:\s*\{/);
  assert.match(source, /id="codex-default-model"/);
  assert.match(source, /get_codex_manager_preferences/);
  assert.match(source, /save_codex_manager_preferences/);
  assert.match(source, /const managerSections =/);
  assert.doesNotMatch(source, /const AREAS =/);
  assert.doesNotMatch(source, /modelQuery/);
  assert.doesNotMatch(source, /fetch\(`\$\{KUAIFAN_BASE_URL\}\/models/);
});

test('Codex page refreshes the public model plaza without passing an API key', async () => {
  const source = await readFile(new URL('../src/pages/CodexPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /const loadModels = async \(\) =>/);
  assert.match(source, /invoke<Model\[\]>\("list_codex_kuaifan_marketplace_models"\)/);
  assert.match(source, /onClick=\{\(\) => void loadModels\(\)\}[\s\S]*?获取模型/);
  assert.match(source, /void loadModels\(\)/);
  assert.match(source, /模型广场目录/);
  assert.doesNotMatch(source, /账号可用模型/);
});

test('Codex manager disables launch actions until a Kuaifan key and default model are ready', async () => {
  const source = await readFile(new URL('../src/pages/CodexPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /onClick=\{onSaveAndLaunch\} disabled=\{!canLaunch \|\| saving\}/);
  assert.match(source, /onClick=\{onApplyPreferencesAndLaunch\} disabled=\{!canLaunch \|\| saving \|\| savingPreferences\}/);
  assert.match(source, /next\.launchError/);
});

test('Codex page refreshes manager preferences after save and launch', async () => {
  const source = await readFile(new URL('../src/pages/CodexPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /const updatedPreferences = await invoke<CodexManagerPreferences>\("get_codex_manager_preferences"\);/);
  assert.match(source, /setPreferences\(updatedPreferences\);/);
});

test('Codex page uses one native default-model select that opens its own list', async () => {
  const source = await readFile(new URL('../src/pages/CodexPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /<select[\s\S]*?id="codex-default-model"[\s\S]*?value=\{model\}/);
  assert.match(source, /className="h-11 rounded border px-3"/);
  assert.doesNotMatch(source, /modelsExpanded/);
  assert.doesNotMatch(source, /展开模型列表/);
  assert.doesNotMatch(source, /size=\{7\}/);
});

test('Codex page places model refresh below the default-model select', async () => {
  const source = await readFile(new URL('../src/pages/CodexPage.tsx', import.meta.url), 'utf8');
  const selectIndex = source.indexOf('id="codex-default-model"');
  const refreshIndex = source.indexOf('获取模型');

  assert.ok(selectIndex >= 0);
  assert.ok(refreshIndex > selectIndex);
  assert.match(source, /<div className="mt-1 flex flex-wrap items-center justify-between gap-3 border-t pt-3"[^>]*>[\s\S]*?获取模型/);
  assert.doesNotMatch(source, /activeSection === "provider" \? <button[\s\S]*?获取模型/);
});
