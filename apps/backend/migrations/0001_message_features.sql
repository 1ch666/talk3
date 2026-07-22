ALTER TABLE messages ADD COLUMN sender_id TEXT;
ALTER TABLE messages ADD COLUMN sender_key_hash TEXT;
ALTER TABLE messages ADD COLUMN reply_to_message_id TEXT;
ALTER TABLE messages ADD COLUMN recalled_at TEXT;
ALTER TABLE messages ADD COLUMN image_id TEXT;
ALTER TABLE messages ADD COLUMN image_mime_type TEXT;
ALTER TABLE messages ADD COLUMN image_size INTEGER;

CREATE INDEX IF NOT EXISTS idx_messages_room_image ON messages(room_code, image_id);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_message_id);
