// PATCHED-BY-KUAIFANCLAW: runtime-store sub-module (missing from upstream dist)
const store = new Map();
export function createPluginRuntimeStore(name) {
  const key = name || 'default';
  return {
    getRuntime: () => store.get(key),
    setRuntime: (v) => { store.set(key, v); },
  };
}
export const { getRuntime, setRuntime } = createPluginRuntimeStore('default');
