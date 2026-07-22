import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

describe("D1 migrations", () => {
  test("applies the base schema and message feature migration", () => {
    const database = new DatabaseSync(":memory:");
    const migrations = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");
    database.exec(readFileSync(resolve(migrations, "0000_create.sql"), "utf8"));
    database.exec(readFileSync(resolve(migrations, "0001_message_features.sql"), "utf8"));
    const columns = database.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    for (const column of ["sender_id", "sender_key_hash", "reply_to_message_id", "recalled_at", "image_id", "image_mime_type", "image_size"]) {
      assert.equal(names.has(column), true, `missing ${column}`);
    }
    database.close();
  });
});
