import { index, sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const rooms = sqliteTable(
  "rooms",
  {
    code: text("code").primaryKey(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index("idx_rooms_updated_at").on(table.updatedAt)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    roomCode: text("room_code")
      .notNull()
      .references(() => rooms.code, { onDelete: "cascade" }),
    senderName: text("sender_name").notNull(),
    senderId: text("sender_id"),
    senderKeyHash: text("sender_key_hash"),
    senderType: text("sender_type", { enum: ["guest", "admin"] }).notNull(),
    text: text("text").notNull(),
    replyToMessageId: text("reply_to_message_id"),
    recalledAt: text("recalled_at"),
    imageId: text("image_id"),
    imageMimeType: text("image_mime_type", { enum: ["image/jpeg", "image/png", "image/webp"] }),
    imageSize: integer("image_size"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_messages_room_created").on(table.roomCode, table.createdAt),
    index("idx_messages_room_image").on(table.roomCode, table.imageId),
    index("idx_messages_reply_to").on(table.replyToMessageId),
  ],
);
