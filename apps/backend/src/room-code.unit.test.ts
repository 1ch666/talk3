import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { generateRoomCode, reserveUniqueCode } from "./room-code";

describe("room code generation", () => {
  test("uses the unambiguous 32-character alphabet", () => {
    const code = generateRoomCode(() => Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 30, 31]));
    assert.equal(code, "ABCDEFGH89");
    assert.doesNotMatch(code, /[01IO]/);
  });

  test("retries when the database reports a collision", async () => {
    const codes = ["AAAAAAAAAA", "BBBBBBBBBB"];
    let insertCalls = 0;
    const result = await reserveUniqueCode(
      async (code) => {
        insertCalls += 1;
        if (insertCalls === 1) throw new Error("UNIQUE constraint failed: rooms.code");
        return code;
      },
      () => codes.shift() ?? "CCCCCCCCCC",
    );
    assert.equal(result, "BBBBBBBBBB");
    assert.equal(insertCalls, 2);
  });

  test("does not hide unrelated database failures", async () => {
    await assert.rejects(
      reserveUniqueCode(async () => Promise.reject(new Error("D1 unavailable"))),
      /D1 unavailable/,
    );
  });
});
