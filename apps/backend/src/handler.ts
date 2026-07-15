import { implement } from "@orpc/server";
import { appContract } from "@talk/shared";
import type { Database } from "./db";
import { createRoomMessage, createUniqueRoom, findRoom, listRoomMessages } from "./room-service";

type Context = { db: Database };
const os = implement(appContract);

const createRoom = os.rooms.create.handler(async ({ context }) => createUniqueRoom((context as Context).db));
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
