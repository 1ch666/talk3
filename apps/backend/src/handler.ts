import { implement } from "@orpc/server";
import { appContract } from "@talk/shared";
import type { Database } from "./db";
import { createRoomMessage, createUniqueRoom, deleteRoom, findRoom, listRoomMessages } from "./room-service";
import type { ChatRoom } from "./chat-room";

type Context = { db: Database; chatRooms: DurableObjectNamespace<ChatRoom> };
const os = implement(appContract);

const createRoom = os.rooms.create.handler(async ({ context }) => {
  const { db, chatRooms } = context as Context;
  const room = await createUniqueRoom(db);
  try {
    const stub = chatRooms.get(chatRooms.idFromName(room.code));
    const response = await stub.fetch("https://chat-room.internal/lifecycle/created", {
      method: "POST",
      body: JSON.stringify({ roomCode: room.code }),
    });
    if (!response.ok) throw new Error(`Room lifecycle initialization failed: ${response.status}`);
    return room;
  } catch (error) {
    await deleteRoom(db, room.code);
    throw error;
  }
});
const getRoom = os.rooms.get.handler(async ({ input, context }) =>
  findRoom((context as Context).db, input.code),
);
const listMessages = os.rooms.listMessages.handler(async ({ input, context }) =>
  listRoomMessages((context as Context).db, input.roomCode, input.limit),
);
const sendMessage = os.rooms.sendMessage.handler(async ({ input, context }) =>
  createRoomMessage((context as Context).db, input),
);

export const appRouter = os.router({
  rooms: { create: createRoom, get: getRoom, listMessages, sendMessage },
});
