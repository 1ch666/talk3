import { desc, eq } from "drizzle-orm";
import type { ChatMessage, Room } from "@talk/shared";
import type { Database } from "./db";
import { messages, rooms } from "./db/schema";
import { reserveUniqueCode } from "./room-code";

export async function createUniqueRoom(db: Database): Promise<Room> {
  return reserveUniqueCode(async (code) => {
    const timestamp = new Date().toISOString();
    await db.insert(rooms).values({ code, createdAt: timestamp, updatedAt: timestamp }).run();
    return { code, createdAt: timestamp, updatedAt: timestamp };
  });
}

export async function findRoom(db: Database, code: string): Promise<Room | null> {
  const row = await db.select().from(rooms).where(eq(rooms.code, code)).limit(1).get();
  return row ?? null;
}

export async function deleteRoom(db: Database, code: string): Promise<void> {
  await db.delete(rooms).where(eq(rooms.code, code)).run();
}

export async function listRoomMessages(db: Database, roomCode: string, limit: number): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.roomCode, roomCode))
    .orderBy(desc(messages.createdAt))
    .limit(limit)
    .all();
  return rows.reverse();
}

export async function createRoomMessage(
  db: Database,
  input: { roomCode: string; senderName: string; text: string; senderType?: "guest" | "admin" },
): Promise<ChatMessage> {
  if (!(await findRoom(db, input.roomCode))) throw new Error("ROOM_NOT_FOUND");
  const message: ChatMessage = {
    id: crypto.randomUUID(),
    roomCode: input.roomCode,
    senderName: input.senderName,
    senderType: input.senderType ?? "guest",
    text: input.text,
    createdAt: new Date().toISOString(),
  };
  await db.insert(messages).values(message).run();
  await db.update(rooms).set({ updatedAt: message.createdAt }).where(eq(rooms.code, input.roomCode)).run();
  return message;
}
