import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { detectImageMime } from "./image-validation";
import { hashSenderKey, verifySenderKeyHash } from "./room-service";

describe("message feature security", () => {
  test("detects supported image signatures and rejects disguised files", () => {
    assert.equal(detectImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
    assert.equal(detectImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
    assert.equal(detectImageMime(new TextEncoder().encode("RIFF0000WEBP")), "image/webp");
    assert.equal(detectImageMime(new TextEncoder().encode("GIF89a")), null);
  });

  test("accepts only the original sender secret", async () => {
    const expected = await hashSenderKey("a".repeat(64));
    assert.equal(await verifySenderKeyHash("a".repeat(64), expected), true);
    assert.equal(await verifySenderKeyHash("b".repeat(64), expected), false);
  });
});
