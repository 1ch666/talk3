import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ROOM_CODE_LENGTH,
  messageSchema,
  roomCodeSchema,
  socketClientEventSchema,
} from "./chat";

describe("chat schemas", () => {
  test("normalizes valid room codes", () => {
    assert.equal(roomCodeSchema.parse("abcd2345ef"), "ABCD2345EF");
    assert.equal(roomCodeSchema.parse("ABCD2345EF").length, ROOM_CODE_LENGTH);
  });

  test("rejects ambiguous and malformed room codes", () => {
    assert.equal(roomCodeSchema.safeParse("ABCDO12345").success, false);
    assert.equal(roomCodeSchema.safeParse("SHORT").success, false);
  });

  test("validates chat messages", () => {
    assert.equal(socketClientEventSchema.safeParse({ type: "message", text: "   " }).success, false);
    assert.equal(
      messageSchema.safeParse({
        id: "018f3f58-4c5f-7a20-b870-5f021b743aa1",
        roomCode: "ABCD2345EF",
        senderName: "測試者",
        senderType: "guest",
        text: "嗨",
        createdAt: new Date().toISOString(),
      }).success,
      true,
    );
  });
});
