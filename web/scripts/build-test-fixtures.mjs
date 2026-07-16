import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");
const outputDir = path.resolve(webDir, "..", "artifacts", "test", "web");

// TypeScript transpile keeps `from "x"` as-is; Node ESM requires explicit
// extensions on relative imports. Patch them up so the fixture can be loaded
// without a custom resolver.
function appendMjsExtension(source) {
  return source.replace(
    /from(\s+)(['"])(\.\.?\/[^'"\n]+)\2/g,
    (_match, ws, quote, spec) => `from${ws}${quote}${spec}.mjs${quote}`,
  );
}

async function transpile(sourcePath, outputPath) {
  const source = await readFile(sourcePath, "utf8");
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: sourcePath,
  });
  const patched = appendMjsExtension(result.outputText);
  await writeFile(outputPath, patched, "utf8");
}

async function buildFixture(name) {
  await transpile(
    path.join(webDir, "src", "services", `${name}.ts`),
    path.join(outputDir, `${name}.mjs`),
  );
}

async function buildStoreFixture(name) {
  await transpile(
    path.join(webDir, "src", "stores", `${name}.ts`),
    path.join(outputDir, "stores", `${name}.mjs`),
  );
}

async function copyServicesToRelativePath() {
  // The store fixture imports from `../services/...` (relative to its
  // artifacts/test/web/stores/ location). Mirror the service fixtures so the
  // relative import resolves without a custom loader.
  const srcDir = path.join(outputDir);
  const dstDir = path.join(outputDir, "services");
  await mkdir(dstDir, { recursive: true });
  for (const name of ["moduleSessionProtocol", "gatewayClient", "hermesAttachments", "hermesProtocol"]) {
    const src = path.join(srcDir, `${name}.mjs`);
    const dst = path.join(dstDir, `${name}.mjs`);
    try {
      const data = await readFile(src, "utf8");
      await writeFile(dst, data, "utf8");
    } catch {
      // Missing service fixture: the store fixture only references a subset.
    }
  }
}

await mkdir(path.join(outputDir, "stores"), { recursive: true });
await Promise.all([
  buildFixture("gatewayClient"),
  buildFixture("hermesAttachments"),
  buildFixture("hermesProtocol"),
  buildFixture("moduleSessionProtocol"),
  buildStoreFixture("moduleSessionStore"),
]);
await copyServicesToRelativePath();
