import { DurableObject } from "cloudflare:workers";
import {
  displayNameSchema,
  imageMimeTypeSchema,
  messageIdSchema,
  messageTextSchema,
  recallMessageInputSchema,
  roomCodeSchema,
  sendMessageInputSchema,
  senderIdSchema,
  senderKeySchema,
  socketClientEventSchema,
  type SocketServerEvent,
} from "@talk/shared";
import { z } from "zod";
import { createDb } from "./db";
import { createRoomMessage, deleteRoom, findRoom, listRoomImageIds, recallRoomMessage } from "./room-service";
import { cleanupEmptyRoom, EMPTY_ROOM_GRACE_MS, hasActiveRoomSockets } from "./room-lifecycle";
import { consumeFixedWindowPermit, consumeRoomCreatePermit, IMAGE_UPLOAD_LIMIT, ROOM_MESSAGE_LIMIT, type RoomCreateRateState } from "./room-create-rate-limit";

type Session = { roomCode: string; senderName: string };
const ROOM_CODE_STORAGE_KEY = "roomCode";
const ROOM_CREATE_RATE_STORAGE_KEY = "roomCreateRate";
const IMAGE_UPLOAD_RATE_STORAGE_KEY = "imageUploadRate";

const imageMessageInputSchema = z.object({
  roomCode: roomCodeSchema,
  senderName: displayNameSchema,
  senderId: senderIdSchema,
  senderKey: senderKeySchema,
  text: messageTextSchema,
  replyToMessageId: messageIdSchema.nullable().optional(),
  image: z.object({ id: messageIdSchema, mimeType: imageMimeTypeSchema, size: z.number().int().positive() }),
});

function errorLabel(error: unknown): string {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const labels: Record<string, string> = {
    ROOM_NOT_FOUND: "聊天室不存在",
    EMPTY_MESSAGE: "訊息不能空白",
    REPLY_NOT_FOUND: "找不到要回覆的訊息",
    REPLY_RECALLED: "這則訊息已被收回",
    IMAGE_LIMIT_REACHED: "這個房間已達 100 張圖片上限",
    MESSAGE_NOT_FOUND: "找不到這則訊息",
    MESSAGE_ALREADY_RECALLED: "這則訊息已收回",
    NOT_MESSAGE_OWNER: "只能收回自己發送的訊息",
  };
  return labels[code] ?? code;
}

export class ChatRoom extends DurableObject<CloudflareBindings> {
  private operationQueue: Promise<void> = Promise.resolve();
  private roomMessageRate: RoomCreateRateState | undefined;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/rate-limit/room-create") {
      return this.serialized(() => this.limitRoomCreation());
    }
    if (request.method === "POST" && url.pathname === "/rate-limit/image-upload") {
      return this.serialized(() => this.limitPersistentAction(IMAGE_UPLOAD_RATE_STORAGE_KEY, IMAGE_UPLOAD_LIMIT));
    }

    if (request.method === "POST" && url.pathname === "/lifecycle/created") {
      const body = (await request.json()) as { roomCode?: unknown };
      const roomCode = roomCodeSchema.parse(body.roomCode);
      await this.ctx.storage.put(ROOM_CODE_STORAGE_KEY, roomCode);
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_GRACE_MS);
      return new Response(null, { status: 204 });
    }

    if (request.method === "POST" && url.pathname === "/messages") {
      return this.serialized(async () => this.createAndBroadcast(sendMessageInputSchema.parse(await request.json())));
    }
    if (request.method === "POST" && url.pathname === "/messages/image") {
      return this.serialized(async () => this.createAndBroadcast(imageMessageInputSchema.parse(await request.json())));
    }
    if (request.method === "POST" && url.pathname === "/messages/recall") {
      return this.serialized(async () => this.recallAndBroadcast(recallMessageInputSchema.parse(await request.json())));
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const roomCode = roomCodeSchema.parse(url.searchParams.get("room"));
    const senderName = (url.searchParams.get("name") ?? "").trim().slice(0, 24);
    if (!senderName) return new Response("Missing display name", { status: 400 });
    if (!(await findRoom(createDb(this.env.DB), roomCode))) return new Response("Room not found", { status: 404 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ roomCode, senderName } satisfies Session);
    await this.ctx.storage.put(ROOM_CODE_STORAGE_KEY, roomCode);
    await this.ctx.storage.deleteAlarm();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    const session = socket.deserializeAttachment() as Session | null;
    if (!session) {
      socket.send(JSON.stringify({ type: "error", message: "連線資訊已失效" } satisfies SocketServerEvent));
      return;
    }
    try {
      const raw = typeof rawMessage === "string" ? rawMessage : new TextDecoder().decode(rawMessage);
      const event = socketClientEventSchema.parse(JSON.parse(raw));
      await this.serialized(async () => {
        if (event.type === "message") {
          const response = await this.createAndBroadcast({
            roomCode: session.roomCode,
            senderName: session.senderName,
            senderId: event.senderId,
            senderKey: event.senderKey,
            text: event.text,
            replyToMessageId: event.replyToMessageId,
          });
          if (!response.ok) {
            const payload = await response.json<{ error?: string }>();
            socket.send(JSON.stringify({ type: "error", message: payload.error ?? "Message rejected" } satisfies SocketServerEvent));
          }
        } else {
          await this.recallAndBroadcast({
            roomCode: session.roomCode,
            messageId: event.messageId,
            senderId: event.senderId,
            senderKey: event.senderKey,
          });
        }
      });
    } catch (error) {
      socket.send(JSON.stringify({ type: "error", message: errorLabel(error) } satisfies SocketServerEvent));
    }
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    try { socket.close(code, reason); } finally { await this.scheduleCleanupIfEmpty(socket); }
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.scheduleCleanupIfEmpty(socket);
  }

  async alarm(): Promise<void> {
    const db = createDb(this.env.DB);
    const roomCode = await this.ctx.storage.get<string>(ROOM_CODE_STORAGE_KEY);
    await cleanupEmptyRoom({
      sockets: this.ctx.getWebSockets(),
      roomCode,
      deleteRoom: async (code) => {
        const imageIds = await listRoomImageIds(db, code);
        await deleteRoom(db, code);
        await Promise.allSettled(imageIds.map((imageId) => this.env.IMAGES.delete(`rooms/${code}/${imageId}`)));
      },
      clearState: () => this.ctx.storage.deleteAll(),
    });
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.operationQueue;
    this.operationQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private async limitRoomCreation(): Promise<Response> {
    const state = await this.ctx.storage.get<RoomCreateRateState>(ROOM_CREATE_RATE_STORAGE_KEY);
    const decision = consumeRoomCreatePermit(state, Date.now());
    return this.persistRateDecision(ROOM_CREATE_RATE_STORAGE_KEY, decision);
  }

  private async limitPersistentAction(storageKey: string, limit: number): Promise<Response> {
    const state = await this.ctx.storage.get<RoomCreateRateState>(storageKey);
    const decision = consumeFixedWindowPermit(state, Date.now(), limit);
    return this.persistRateDecision(storageKey, decision);
  }

  private async persistRateDecision(
    storageKey: string,
    decision: ReturnType<typeof consumeFixedWindowPermit>,
  ): Promise<Response> {
    if (decision.allowed) {
      await this.ctx.storage.put(storageKey, decision.state);
      await this.ctx.storage.setAlarm(decision.state.resetAt + 1_000);
    }
    return Response.json({ success: decision.allowed, retryAfterSeconds: decision.retryAfterSeconds });
  }

  private async createAndBroadcast(input: Parameters<typeof createRoomMessage>[1]): Promise<Response> {
    const permit = consumeFixedWindowPermit(this.roomMessageRate, Date.now(), ROOM_MESSAGE_LIMIT);
    this.roomMessageRate = permit.state;
    if (!permit.allowed) {
      return Response.json(
        { error: "\u8a0a\u606f\u50b3\u9001\u592a\u983b\u7e41\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002", code: "MESSAGE_RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": String(permit.retryAfterSeconds) } },
      );
    }
    try {
      const message = await createRoomMessage(createDb(this.env.DB), input);
      this.broadcast({ type: "message", message });
      return Response.json(message, { status: 201 });
    } catch (error) {
      return Response.json({ error: errorLabel(error), code: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, { status: 400 });
    }
  }

  private async recallAndBroadcast(input: Parameters<typeof recallRoomMessage>[1]): Promise<Response> {
    try {
      const result = await recallRoomMessage(createDb(this.env.DB), input);
      this.broadcast({ type: "message_updated", message: result.message });
      if (result.deletedImageId) {
        this.ctx.waitUntil(this.env.IMAGES.delete(`rooms/${input.roomCode}/${result.deletedImageId}`));
      }
      return Response.json(result.message);
    } catch (error) {
      return Response.json({ error: errorLabel(error), code: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, { status: 400 });
    }
  }

  private broadcast(event: Extract<SocketServerEvent, { type: "message" | "message_updated" }>): void {
    const payload = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(payload); } catch { /* runtime removes disconnected sockets */ }
    }
  }

  private async scheduleCleanupIfEmpty(disconnectedSocket: WebSocket): Promise<void> {
    if (hasActiveRoomSockets(this.ctx.getWebSockets(), disconnectedSocket)) return;
    await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_GRACE_MS);
  }
}
