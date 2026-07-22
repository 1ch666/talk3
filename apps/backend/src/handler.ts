import { implement } from "@orpc/server";
import { appContract, messageSchema } from "@talk/shared";
import type { Database } from "./db";
import { createUniqueRoom, deleteRoom, findRoom, listRoomMessages } from "./room-service";
import type { ChatRoom } from "./chat-room";

type Context = { db: Database; chatRooms: DurableObjectNamespace<ChatRoom> };
const os = implement(appContract);

async function callRoom(chatRooms: DurableObjectNamespace<ChatRoom>, roomCode: string, path: string, body: unknown) {
  const stub = chatRooms.get(chatRooms.idFromName(roomCode));
  const response = await stub.fetch(`https://chat-room.internal${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json<unknown>();
  if (!response.ok) {
    const error = payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "聊天室操作失敗";
    throw new Error(error);
  }
  return messageSchema.parse(payload);
}

const createRoom = os.rooms.create.handler(async ({ context }) => {
  const { db, chatRooms } = context as Context;
  const room = await createUniqueRoom(db);
  try {
    const response = await chatRooms.get(chatRooms.idFromName(room.code)).fetch("https://chat-room.internal/lifecycle/created", {
      method: "POST", body: JSON.stringify({ roomCode: room.code }),
    });
    if (!response.ok) throw new Error(`Room lifecycle initialization failed: ${response.status}`);
    return room;
  } catch (error) {
    await deleteRoom(db, room.code);
    throw error;
  }
});

const getRoom = os.rooms.get.handler(async ({ input, context }) => findRoom((context as Context).db, input.code));
const listMessages = os.rooms.listMessages.handler(async ({ input, context }) =>
  listRoomMessages((context as Context).db, input.roomCode, input.limit));
const sendMessage = os.rooms.sendMessage.handler(async ({ input, context }) =>
  callRoom((context as Context).chatRooms, input.roomCode, "/messages", input));
const recallMessage = os.rooms.recallMessage.handler(async ({ input, context }) =>
  callRoom((context as Context).chatRooms, input.roomCode, "/messages/recall", input));

export const appRouter = os.router({ rooms: { create: createRoom, get: getRoom, listMessages, sendMessage, recallMessage } });
