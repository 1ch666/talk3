import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerPath = resolve(root, "apps/frontend/dist/server/index.js");
const source = await readFile(workerPath, "utf8");
const patched = source.replace(
  "__rspack_createRequire(import.meta.url)",
  '__rspack_createRequire("file:///worker.js")',
);

if (patched === source) {
  throw new Error("Unable to find the frontend createRequire bootstrap to patch.");
}

await writeFile(workerPath, patched);
