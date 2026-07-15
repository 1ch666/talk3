import { oc } from "@orpc/contract";
import { z } from "zod";

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 10;

export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`),
    `房號必須是 ${ROOM_CODE_LENGTH} 碼英數字`,
  );

export const displayNameSchema = z.string().trim().min(1, "請輸入暱稱").max(24, "暱稱最多 24 個字");
export const messageTextSchema = z.string().trim().min(1, "訊息不能空白").max(2_000, "訊息最多 2,000 個字");

export const roomSchema = z.object({
  code: roomCodeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const messageSchema = z.object({
  id: z.string().uuid(),
  roomCode: roomCodeSchema,
  senderName: displayNameSchema,
  senderType: z.enum(["guest", "admin"]),
  text: messageTextSchema,
  createdAt: z.string(),
});

export const createRoomInputSchema = z.object({});
export const getRoomInputSchema = z.object({ code: roomCodeSchema });
export const listMessagesInputSchema = z.object({
  roomCode: roomCodeSchema,
  limit: z.number().int().min(1).max(200).default(100),
});
export const sendMessageInputSchema = z.object({
  roomCode: roomCodeSchema,
  senderName: displayNameSchema,
  text: messageTextSchema,
});

export const socketClientEventSchema = z.object({
  type: z.literal("message"),
  text: messageTextSchema,
});

export const socketServerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), message: messageSchema }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

export const appContract = {
  rooms: {
    create: oc.input(createRoomInputSchema).output(roomSchema),
    get: oc.input(getRoomInputSchema).output(roomSchema.nullable()),
    listMessages: oc.input(listMessagesInputSchema).output(z.array(messageSchema)),
    sendMessage: oc.input(sendMessageInputSchema).output(messageSchema),
  },
};

export type Room = z.infer<typeof roomSchema>;
export type ChatMessage = z.infer<typeof messageSchema>;
export type SocketClientEvent = z.infer<typeof socketClientEventSchema>;
export type SocketServerEvent = z.infer<typeof socketServerEventSchema>;
