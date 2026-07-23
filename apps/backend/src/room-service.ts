import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  MAX_IMAGES_PER_ROOM,
  type ChatMessage,
  type ImageMimeType,
  type Room,
} from "@talk/shared";
import type { Database } from "./db";
import { messages, rooms } from "./db/schema";
import { reserveUniqueCode } from "./room-code";

type MessageRow = typeof messages.$inferSelect;

export type CreateMessageInput = {
  roomCode: string;
  senderId: string;
  senderKey: string;
  senderName: string;
  text: string;
  senderType?: "guest" | "admin";
  replyToMessageId?: string | null;
  image?: { id: string; mimeType: ImageMimeType; size: number } | null;
};

export async function hashSenderKey(senderKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(senderKey));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function verifySenderKeyHash(senderKey: string, expectedHash: string): Promise<boolean> {
  return constantTimeEqual(await hashSenderKey(senderKey), expectedHash);
}

function publicMessage(row: MessageRow, replyTarget: MessageRow | null = null): ChatMessage {
  const recalled = row.recalledAt !== null;
  const replyRecalled = replyTarget?.recalledAt !== null;
  return {
    id: row.id,
    roomCode: row.roomCode,
    senderId: row.senderId,
    senderName: row.senderName,
    senderType: row.senderType,
    text: recalled ? "" : row.text,
    image: !recalled && row.imageId && row.imageMimeType && row.imageSize
      ? {
          id: row.imageId,
          url: `/api/rooms/${row.roomCode}/images/${row.imageId}`,
          mimeType: row.imageMimeType,
          size: row.imageSize,
        }
      : null,
    replyTo: replyTarget
      ? {
          id: replyTarget.id,
          senderName: replyTarget.senderName,
          text: replyRecalled ? "" : replyTarget.text,
          hasImage: !replyRecalled && replyTarget.imageId !== null,
          recalled: replyRecalled,
        }
      : null,
    recalledAt: row.recalledAt,
    createdAt: row.createdAt,
  };
}

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

export async function listRoomImageIds(db: Database, roomCode: string): Promise<string[]> {
  const rows = await db.select({ imageId: messages.imageId }).from(messages).where(and(
    eq(messages.roomCode, roomCode),
    isNotNull(messages.imageId),
  )).all();
  return rows.flatMap((row) => row.imageId ? [row.imageId] : []);
}

export async function listRoomMessages(db: Database, roomCode: string, limit: number): Promise<ChatMessage[]> {
  const rows = await db.select().from(messages).where(eq(messages.roomCode, roomCode))
    .orderBy(desc(messages.createdAt)).limit(limit).all();
  const ordered = rows.reverse();
  const replyIds = [...new Set(ordered.flatMap((row) => row.replyToMessageId ? [row.replyToMessageId] : []))];
  const replyRows = replyIds.length > 0
    ? await db.select().from(messages).where(inArray(messages.id, replyIds)).all()
    : [];
  const replies = new Map(replyRows.map((row) => [row.id, row]));
  return ordered.map((row) => publicMessage(row, row.replyToMessageId ? replies.get(row.replyToMessageId) ?? null : null));
}

async function findMessageRow(db: Database, roomCode: string, messageId: string): Promise<MessageRow | null> {
  return await db.select().from(messages)
    .where(and(eq(messages.roomCode, roomCode), eq(messages.id, messageId))).limit(1).get() ?? null;
}

async function resolveReply(db: Database, roomCode: string, replyToMessageId?: string | null): Promise<MessageRow | null> {
  if (!replyToMessageId) return null;
  const target = await findMessageRow(db, roomCode, replyToMessageId);
  if (!target) throw new Error("REPLY_NOT_FOUND");
  if (target.recalledAt) throw new Error("REPLY_RECALLED");
  return target;
}

export async function createRoomMessage(db: Database, input: CreateMessageInput): Promise<ChatMessage> {
  if (!(await findRoom(db, input.roomCode))) throw new Error("ROOM_NOT_FOUND");
  const text = input.text.trim();
  if (!text && !input.image) throw new Error("EMPTY_MESSAGE");
  const replyTarget = await resolveReply(db, input.roomCode, input.replyToMessageId);
  if (input.image) {
    const result = await db.select({ count: sql<number>`count(*)` }).from(messages).where(and(
      eq(messages.roomCode, input.roomCode), isNotNull(messages.imageId), isNull(messages.recalledAt),
    )).get();
    if (Number(result?.count ?? 0) >= MAX_IMAGES_PER_ROOM) throw new Error("IMAGE_LIMIT_REACHED");
  }
  const timestamp = new Date().toISOString();
  const row: typeof messages.$inferInsert = {
    id: crypto.randomUUID(),
    roomCode: input.roomCode,
    senderId: input.senderId,
    senderKeyHash: await hashSenderKey(input.senderKey),
    senderName: input.senderName,
    senderType: input.senderType ?? "guest",
    text,
    replyToMessageId: replyTarget?.id ?? null,
    imageId: input.image?.id ?? null,
    imageMimeType: input.image?.mimeType ?? null,
    imageSize: input.image?.size ?? null,
    recalledAt: null,
    createdAt: timestamp,
  };
  await db.insert(messages).values(row).run();
  await db.update(rooms).set({ updatedAt: timestamp }).where(eq(rooms.code, input.roomCode)).run();
  return publicMessage(row as MessageRow, replyTarget);
}

export async function recallRoomMessage(
  db: Database,
  input: { roomCode: string; messageId: string; senderId: string; senderKey: string },
): Promise<{ message: ChatMessage; deletedImageId: string | null }> {
  const row = await findMessageRow(db, input.roomCode, input.messageId);
  if (!row) throw new Error("MESSAGE_NOT_FOUND");
  if (row.recalledAt) throw new Error("MESSAGE_ALREADY_RECALLED");
  if (!row.senderId || row.senderId !== input.senderId || !row.senderKeyHash) throw new Error("NOT_MESSAGE_OWNER");
  if (!(await verifySenderKeyHash(input.senderKey, row.senderKeyHash))) throw new Error("NOT_MESSAGE_OWNER");

  const replyTarget = row.replyToMessageId ? await findMessageRow(db, input.roomCode, row.replyToMessageId) : null;
  const recalledAt = new Date().toISOString();
  const deletedImageId = row.imageId;
  await db.update(messages).set({
    text: "",
    imageId: null,
    imageMimeType: null,
    imageSize: null,
    recalledAt,
  }).where(and(eq(messages.id, row.id), isNull(messages.recalledAt))).run();
  const updated: MessageRow = { ...row, text: "", imageId: null, imageMimeType: null, imageSize: null, recalledAt };
  return { message: publicMessage(updated, replyTarget), deletedImageId };
}

export async function findActiveImage(
  db: Database,
  roomCode: string,
  imageId: string,
): Promise<{ mimeType: ImageMimeType; size: number } | null> {
  const row = await db.select({ mimeType: messages.imageMimeType, size: messages.imageSize }).from(messages).where(and(
    eq(messages.roomCode, roomCode), eq(messages.imageId, imageId), isNull(messages.recalledAt),
  )).limit(1).get();
  return row?.mimeType && row.size ? { mimeType: row.mimeType, size: row.size } : null;
}
