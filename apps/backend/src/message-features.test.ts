import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { detectImageMime } from "./image-validation";
import { IMAGE_EXPIRATION_TTL_SECONDS, writeExpiringImage } from "./image-storage";
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

  test("stores images with a seven-day expiration fallback", async () => {
    let receivedOptions: { expirationTtl: number; metadata: { mimeType: string; size: number } } | undefined;
    const stored = await writeExpiringImage(async (_key, _value, options) => {
      receivedOptions = options;
    }, "rooms/ROOM/image", new ArrayBuffer(4), { mimeType: "image/png", size: 4 });

    assert.equal(stored, true);
    assert.equal(receivedOptions?.expirationTtl, IMAGE_EXPIRATION_TTL_SECONDS);
    assert.equal(IMAGE_EXPIRATION_TTL_SECONDS, 604_800);
  });

  test("reports unavailable storage without leaking the provider error", async () => {
    const stored = await writeExpiringImage(async () => {
      throw new Error("KV quota exceeded");
    }, "rooms/ROOM/image", new ArrayBuffer(4), { mimeType: "image/png", size: 4 });

    assert.equal(stored, false);
  });
});
