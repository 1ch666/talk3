import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { roomCreateRateLimitKey } from "./room-create-rate-limit";

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
});
