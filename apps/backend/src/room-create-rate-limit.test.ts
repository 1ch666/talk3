import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { consumeRoomCreatePermit, ROOM_CREATE_LIMIT, ROOM_CREATE_WINDOW_MS, roomCreateRateLimitKey } from "./room-create-rate-limit";

describe("room creation rate limit", () => {
  test("uses a stable, non-reversible key instead of storing the client IP", async () => {
    const request = new Request("https://talkroom.example/rpc/rooms/create", {
      headers: { "cf-connecting-ip": "2001:db8::1234" },
    });
    const key = await roomCreateRateLimitKey(request);

    assert.equal(key, await roomCreateRateLimitKey(request));
    assert.match(key, /^[0-9a-f]{32}$/);
    assert.equal(key.includes("2001:db8"), false);
  });

  test("separates different client addresses", async () => {
    const first = new Request("https://talkroom.example", { headers: { "cf-connecting-ip": "192.0.2.1" } });
    const second = new Request("https://talkroom.example", { headers: { "cf-connecting-ip": "192.0.2.2" } });

    assert.notEqual(await roomCreateRateLimitKey(first), await roomCreateRateLimitKey(second));
  });

  test("rejects the sixth room creation in the same minute", () => {
    const now = 1_000_000;
    let state;
    for (let attempt = 0; attempt < ROOM_CREATE_LIMIT; attempt += 1) {
      const decision = consumeRoomCreatePermit(state, now + attempt);
      assert.equal(decision.allowed, true);
      state = decision.state;
    }

    const blocked = consumeRoomCreatePermit(state, now + ROOM_CREATE_LIMIT);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSeconds > 0, true);
  });

  test("starts a fresh allowance after the window expires", () => {
    const full = { count: ROOM_CREATE_LIMIT, resetAt: 2_000_000 };
    assert.equal(consumeRoomCreatePermit(full, full.resetAt + ROOM_CREATE_WINDOW_MS).allowed, true);
  });
});
