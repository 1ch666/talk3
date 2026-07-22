import { oc } from "@orpc/contract";
import { z } from "zod";

export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 10;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_ROOM = 100;
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const roomCodeSchema = z.string().trim().toUpperCase().regex(
  new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`),
  `房號必須是 ${ROOM_CODE_LENGTH} 碼英數字`,
);
export const displayNameSchema = z.string().trim().min(1, "請輸入暱稱").max(24, "暱稱最多 24 個字");
export const messageTextSchema = z.string().trim().max(2_000, "訊息最多 2,000 個字");
export const requiredMessageTextSchema = messageTextSchema.refine((value) => value.length > 0, "訊息不能空白");
export const senderIdSchema = z.string().uuid();
export const senderKeySchema = z.string().regex(/^[a-f0-9]{64}$/i, "無效的訊息擁有者密鑰");
export const messageIdSchema = z.string().uuid();
export const imageMimeTypeSchema = z.enum(IMAGE_MIME_TYPES);

export const roomSchema = z.object({
  code: roomCodeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const imageSchema = z.object({
  id: messageIdSchema,
  url: z.string(),
  mimeType: imageMimeTypeSchema,
  size: z.number().int().positive().max(MAX_IMAGE_BYTES),
});

export const replyPreviewSchema = z.object({
  id: messageIdSchema,
  senderName: displayNameSchema,
  text: z.string(),
  hasImage: z.boolean(),
  recalled: z.boolean(),
});

export const messageSchema = z.object({
  id: messageIdSchema,
  roomCode: roomCodeSchema,
  senderId: senderIdSchema.nullable(),
  senderName: displayNameSchema,
  senderType: z.enum(["guest", "admin"]),
  text: z.string().max(2_000),
  image: imageSchema.nullable(),
  replyTo: replyPreviewSchema.nullable(),
  recalledAt: z.string().nullable(),
  createdAt: z.string(),
}).superRefine((message, context) => {
  if (!message.recalledAt && !message.text.trim() && !message.image) {
    context.addIssue({ code: "custom", message: "訊息必須包含文字或圖片", path: ["text"] });
  }
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
  senderId: senderIdSchema,
  senderKey: senderKeySchema,
  text: requiredMessageTextSchema,
  replyToMessageId: messageIdSchema.nullable().optional(),
});
export const recallMessageInputSchema = z.object({
  roomCode: roomCodeSchema,
  messageId: messageIdSchema,
  senderId: senderIdSchema,
  senderKey: senderKeySchema,
});

export const socketClientEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    senderId: senderIdSchema,
    senderKey: senderKeySchema,
    text: requiredMessageTextSchema,
    replyToMessageId: messageIdSchema.nullable().optional(),
  }),
  z.object({
    type: z.literal("recall"),
    messageId: messageIdSchema,
    senderId: senderIdSchema,
    senderKey: senderKeySchema,
  }),
]);

export const socketServerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), message: messageSchema }),
  z.object({ type: z.literal("message_updated"), message: messageSchema }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

export const appContract = {
  rooms: {
    create: oc.input(createRoomInputSchema).output(roomSchema),
    get: oc.input(getRoomInputSchema).output(roomSchema.nullable()),
    listMessages: oc.input(listMessagesInputSchema).output(z.array(messageSchema)),
    sendMessage: oc.input(sendMessageInputSchema).output(messageSchema),
    recallMessage: oc.input(recallMessageInputSchema).output(messageSchema),
  },
};

export type Room = z.infer<typeof roomSchema>;
export type ChatMessage = z.infer<typeof messageSchema>;
export type SocketClientEvent = z.infer<typeof socketClientEventSchema>;
export type SocketServerEvent = z.infer<typeof socketServerEventSchema>;
export type ImageMimeType = z.infer<typeof imageMimeTypeSchema>;
