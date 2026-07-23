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
import { createDb } from "./db";
import { findActiveImage, findRoom } from "./room-service";
import { ChatRoom } from "./chat-room";
import { detectImageMime } from "./image-validation";
import { IMAGE_UPLOAD_UNAVAILABLE_MESSAGE, writeExpiringImage } from "./image-storage";
import { ROOM_CREATE_RATE_LIMIT_MESSAGE, roomCreateRateLimitKey } from "./room-create-rate-limit";

type Env = { Bindings: CloudflareBindings };
const app = new Hono<Env>();
const orpcHandler = new RPCHandler(appRouter);

function roomStub(env: CloudflareBindings, code: string) {
  return env.CHAT_ROOMS.get(env.CHAT_ROOMS.idFromName(code));
}

app.use("/rpc/*", async (c, next) => {
  const lengthHeader = c.req.header("content-length");
  const declaredLength = Number(lengthHeader);
  if (c.req.method === "POST" && (!lengthHeader || !Number.isFinite(declaredLength) || declaredLength <= 0)) {
    return c.json({ error: "A valid Content-Length header is required" }, 411);
  }
  if (declaredLength > 64 * 1024) {
    return c.json({ error: "Request body is too large" }, 413);
  }

  const pathname = new URL(c.req.url).pathname;
  const key = await roomCreateRateLimitKey(c.req.raw);
  const generalLimit = await c.env.API_RATE_LIMITER.limit({ key });
  if (!generalLimit.success) {
    c.header("Retry-After", "60");
    return c.json({ error: "Too many requests" }, 429);
  }

  if (c.req.method === "POST" && pathname === "/rpc/rooms/create") {
    const { success } = await c.env.ROOM_CREATE_RATE_LIMITER.limit({ key });
    if (!success) {
      c.header("Retry-After", "60");
      return c.json({ error: ROOM_CREATE_RATE_LIMIT_MESSAGE }, 429);
    }

    const exactResponse = await roomStub(c.env, `rate:${key}`).fetch("https://chat-room.internal/rate-limit/room-create", {
      method: "POST",
    });
    if (!exactResponse.ok) return c.json({ error: "\u66ab\u6642\u7121\u6cd5\u5efa\u7acb\u623f\u9593\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002" }, 503);
    const exact = await exactResponse.json<{ success: boolean; retryAfterSeconds: number }>();
    if (!exact.success) {
      c.header("Retry-After", String(exact.retryAfterSeconds));
      return c.json({ error: ROOM_CREATE_RATE_LIMIT_MESSAGE }, 429);
    }
  }

  const { matched, response } = await orpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: { db: createDb(c.env.DB), chatRooms: c.env.CHAT_ROOMS },
  });
  if (matched) return c.newResponse(response.body, response);
  await next();
});

app.get("/api/rooms/:code/socket", async (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") return c.text("Expected WebSocket upgrade", 426);
  const socketKey = await roomCreateRateLimitKey(c.req.raw);
  const socketLimit = await c.env.SOCKET_RATE_LIMITER.limit({ key: socketKey });
  if (!socketLimit.success) {
    c.header("Retry-After", "60");
    return c.text("Too many connection attempts", 429);
  }
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
  const uploadKey = await roomCreateRateLimitKey(c.req.raw);
  const uploadLimit = await c.env.ROOM_IMAGE_RATE_LIMITER.limit({ key: uploadKey });
  if (!uploadLimit.success) {
    c.header("Retry-After", "60");
    return c.json({ error: "\u5716\u7247\u4e0a\u50b3\u592a\u983b\u7e41\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002" }, 429);
  }
  const exactResponse = await roomStub(c.env, `rate:${uploadKey}`).fetch("https://chat-room.internal/rate-limit/image-upload", {
    method: "POST",
  });
  if (!exactResponse.ok) return c.json({ error: IMAGE_UPLOAD_UNAVAILABLE_MESSAGE }, 503);
  const exact = await exactResponse.json<{ success: boolean; retryAfterSeconds: number }>();
  if (!exact.success) {
    c.header("Retry-After", String(exact.retryAfterSeconds));
    return c.json({ error: "\u5716\u7247\u4e0a\u50b3\u592a\u983b\u7e41\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002" }, 429);
  }
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
    return c.json({ error }, response.status === 400 || response.status === 429 ? response.status : 500);
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
