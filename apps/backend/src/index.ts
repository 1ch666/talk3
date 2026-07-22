import { Hono } from "hono";
import { RPCHandler } from "@orpc/server/fetch";
import {
  MAX_IMAGE_BYTES,
  displayNameSchema,
  imageMimeTypeSchema,
  messageIdSchema,
  messageSchema,
  messageTextSchema,
  roomCodeSchema,
  senderIdSchema,
  senderKeySchema,
} from "@talk/shared";
import { appRouter } from "./handler";
import { createAuth } from "./auth";
import { createDb } from "./db";
import { findActiveImage, findRoom } from "./room-service";
import { ChatRoom } from "./chat-room";
import { detectImageMime } from "./image-validation";
import { IMAGE_UPLOAD_UNAVAILABLE_MESSAGE, writeExpiringImage } from "./image-storage";

type Env = { Bindings: CloudflareBindings };
const app = new Hono<Env>();
const orpcHandler = new RPCHandler(appRouter);

function roomStub(env: CloudflareBindings, code: string) {
  return env.CHAT_ROOMS.get(env.CHAT_ROOMS.idFromName(code));
}

app.on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

app.use("/rpc/*", async (c, next) => {
  const { matched, response } = await orpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: { db: createDb(c.env.DB), chatRooms: c.env.CHAT_ROOMS },
  });
  if (matched) return c.newResponse(response.body, response);
  await next();
});

app.get("/api/rooms/:code/socket", async (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") return c.text("Expected WebSocket upgrade", 426);
  const codeResult = roomCodeSchema.safeParse(c.req.param("code"));
  const nameResult = displayNameSchema.safeParse(c.req.query("name"));
  if (!codeResult.success || !nameResult.success) return c.text("Invalid room or display name", 400);
  if (!(await findRoom(createDb(c.env.DB), codeResult.data))) return c.text("Room not found", 404);
  const url = new URL(c.req.url);
  url.searchParams.set("room", codeResult.data);
  url.searchParams.set("name", nameResult.data);
  return roomStub(c.env, codeResult.data).fetch(new Request(url, c.req.raw));
});

app.post("/api/rooms/:code/images", async (c) => {
  const code = roomCodeSchema.safeParse(c.req.param("code"));
  if (!code.success) return c.json({ error: "無效的房號" }, 400);
  const declaredLength = Number(c.req.header("content-length") ?? 0);
  if (declaredLength > MAX_IMAGE_BYTES + 64 * 1024) return c.json({ error: "圖片不可超過 5MB" }, 413);
  if (!(await findRoom(createDb(c.env.DB), code.data))) return c.json({ error: "聊天室不存在" }, 404);

  let form: FormData;
  try { form = await c.req.raw.formData(); } catch { return c.json({ error: "無法讀取圖片" }, 400); }
  const file = form.get("file");
  const senderName = displayNameSchema.safeParse(form.get("senderName"));
  const senderId = senderIdSchema.safeParse(form.get("senderId"));
  const senderKey = senderKeySchema.safeParse(form.get("senderKey"));
  const text = messageTextSchema.safeParse(form.get("text") ?? "");
  const replyRaw = form.get("replyToMessageId");
  const replyToMessageId = replyRaw ? messageIdSchema.safeParse(replyRaw) : null;
  if (!(file instanceof File) || !senderName.success || !senderId.success || !senderKey.success || !text.success || (replyToMessageId && !replyToMessageId.success)) {
    return c.json({ error: "圖片訊息資料無效" }, 400);
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) return c.json({ error: "圖片不可超過 5MB" }, 413);
  const declaredMime = imageMimeTypeSchema.safeParse(file.type);
  if (!declaredMime.success) return c.json({ error: "只支援 JPEG、PNG、WebP" }, 415);
  const buffer = await file.arrayBuffer();
  const detectedMime = detectImageMime(new Uint8Array(buffer));
  if (detectedMime !== declaredMime.data) return c.json({ error: "圖片格式與內容不符" }, 415);

  const imageId = crypto.randomUUID();
  const key = `rooms/${code.data}/${imageId}`;
  const stored = await writeExpiringImage(
    (imageKey, value, options) => c.env.IMAGES.put(imageKey, value, options),
    key,
    buffer,
    { mimeType: detectedMime, size: file.size },
  );
  if (!stored) return c.json({ error: IMAGE_UPLOAD_UNAVAILABLE_MESSAGE }, 503);
  const response = await roomStub(c.env, code.data).fetch("https://chat-room.internal/messages/image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      roomCode: code.data,
      senderName: senderName.data,
      senderId: senderId.data,
      senderKey: senderKey.data,
      text: text.data,
      replyToMessageId: replyToMessageId?.success ? replyToMessageId.data : null,
      image: { id: imageId, mimeType: detectedMime, size: file.size },
    }),
  });
  const payload = await response.json<unknown>();
  if (!response.ok) {
    await c.env.IMAGES.delete(key);
    const error = payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "圖片傳送失敗";
    return c.json({ error }, response.status === 400 ? 400 : 500);
  }
  return c.json(messageSchema.parse(payload), 201);
});

app.get("/api/rooms/:code/images/:imageId", async (c) => {
  const code = roomCodeSchema.safeParse(c.req.param("code"));
  const imageId = messageIdSchema.safeParse(c.req.param("imageId"));
  if (!code.success || !imageId.success) return c.text("Not found", 404);
  if (!(await findRoom(createDb(c.env.DB), code.data))) return c.text("Not found", 404);
  const image = await findActiveImage(createDb(c.env.DB), code.data, imageId.data);
  if (!image) return c.text("Not found", 404);
  const object = await c.env.IMAGES.get(`rooms/${code.data}/${imageId.data}`, "arrayBuffer");
  if (!object) return c.text("Not found", 404);
  const headers = new Headers();
  headers.set("content-type", image.mimeType);
  headers.set("content-length", String(image.size));
  headers.set("etag", `"${imageId.data}"`);
  headers.set("cache-control", "private, max-age=60");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object, { headers });
});

app.get("/health", (c) => c.json({ status: "ok", service: "talk-backend" }));

export { ChatRoom };
export default app;
