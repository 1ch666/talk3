import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cleanupEmptyRoom, EMPTY_ROOM_GRACE_MS, hasActiveRoomSockets } from "./room-lifecycle";

type TestSocket = { readyState: number; id: string };

describe("room lifecycle", () => {
  test("keeps a room while at least one user is connected", () => {
    const sockets: TestSocket[] = [
      { id: "open", readyState: 1 },
      { id: "closed", readyState: 3 },
    ];
    assert.equal(hasActiveRoomSockets(sockets), true);
  });

  test("treats the closing user as disconnected", () => {
    const leaving: TestSocket = { id: "leaving", readyState: 1 };
    assert.equal(hasActiveRoomSockets([leaving], leaving), false);
  });

  test("keeps the room when another user remains after one leaves", () => {
    const leaving: TestSocket = { id: "leaving", readyState: 1 };
    const remaining: TestSocket = { id: "remaining", readyState: 1 };
    assert.equal(hasActiveRoomSockets([leaving, remaining], leaving), true);
  });

  test("deletes the room and clears state when nobody remains", async () => {
    const deleted: string[] = [];
    let stateCleared = false;
    const cleaned = await cleanupEmptyRoom({
      sockets: [],
      roomCode: "ABCDEFGH89",
      deleteRoom: async (code) => { deleted.push(code); },
      clearState: async () => { stateCleared = true; },
    });
    assert.equal(cleaned, true);
    assert.deepEqual(deleted, ["ABCDEFGH89"]);
    assert.equal(stateCleared, true);
  });

  test("does not delete or clear state while somebody is connected", async () => {
    let touched = false;
    const cleaned = await cleanupEmptyRoom({
      sockets: [{ id: "open", readyState: 1 }],
      roomCode: "ABCDEFGH89",
      deleteRoom: async () => { touched = true; },
      clearState: async () => { touched = true; },
    });
    assert.equal(cleaned, false);
    assert.equal(touched, false);
  });

  test("uses a reconnection grace period before deletion", () => {
    assert.equal(EMPTY_ROOM_GRACE_MS, 30_000);
  });
});
