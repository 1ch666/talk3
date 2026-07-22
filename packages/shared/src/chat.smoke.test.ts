import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ROOM_CODE_LENGTH,
  messageSchema,
  roomCodeSchema,
  socketClientEventSchema,
} from "./chat";

const senderId = "018f3f58-4c5f-7a20-b870-5f021b743aa1";
const senderKey = "a".repeat(64);

describe("chat schemas", () => {
  test("normalizes valid room codes", () => {
    assert.equal(roomCodeSchema.parse("abcd2345ef"), "ABCD2345EF");
    assert.equal(roomCodeSchema.parse("ABCD2345EF").length, ROOM_CODE_LENGTH);
  });

  test("rejects ambiguous and malformed room codes", () => {
    assert.equal(roomCodeSchema.safeParse("ABCDO12345").success, false);
    assert.equal(roomCodeSchema.safeParse("SHORT").success, false);
  });

  test("validates send, reply and recall socket events", () => {
    assert.equal(socketClientEventSchema.safeParse({ type: "message", senderId, senderKey, text: "   " }).success, false);
    assert.equal(socketClientEventSchema.safeParse({ type: "message", senderId, senderKey, text: "回覆", replyToMessageId: senderId }).success, true);
    assert.equal(socketClientEventSchema.safeParse({ type: "recall", senderId, senderKey, messageId: senderId }).success, true);
    assert.equal(socketClientEventSchema.safeParse({ type: "recall", senderId, senderKey: "wrong", messageId: senderId }).success, false);
  });

  test("validates text, image, reply and recalled public messages", () => {
    const base = {
      id: senderId,
      roomCode: "ABCD2345EF",
      senderId,
      senderName: "測試者",
      senderType: "guest" as const,
      text: "你好",
      image: null,
      replyTo: null,
      recalledAt: null,
      createdAt: new Date().toISOString(),
    };
    assert.equal(messageSchema.safeParse(base).success, true);
    assert.equal(messageSchema.safeParse({ ...base, text: "", image: { id: senderId, url: "/image", mimeType: "image/webp", size: 1024 } }).success, true);
    assert.equal(messageSchema.safeParse({ ...base, replyTo: { id: senderId, senderName: "朋友", text: "上一則", hasImage: false, recalled: false } }).success, true);
    assert.equal(messageSchema.safeParse({ ...base, text: "", recalledAt: new Date().toISOString() }).success, true);
  });
});
