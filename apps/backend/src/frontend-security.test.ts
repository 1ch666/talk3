import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

describe("frontend security", () => {
  test("sets browser hardening headers without wrapping API or WebSocket responses", () => {
    const workerPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../frontend/worker-entry.js");
    const worker = readFileSync(workerPath, "utf8");

    for (const header of [
      "content-security-policy",
      "permissions-policy",
      "referrer-policy",
      "strict-transport-security",
      "x-content-type-options",
      "x-frame-options",
    ]) {
      assert.match(worker, new RegExp(`headers\\.set\\(\\"${header}\\"`));
    }
    assert.match(worker, /return env\.BACKEND\.fetch/);
    assert.doesNotMatch(worker, /dangerouslySetInnerHTML|document\.write|eval\(/);
  });
});
