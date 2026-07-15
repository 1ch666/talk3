import { DurableObject } from "cloudflare:workers";
import { roomCodeSchema, socketClientEventSchema, type SocketServerEvent } from "@talk/shared";
import { createDb } from "./db";
import { createRoomMessage, deleteRoom, findRoom } from "./room-service";
import type { Bindings } from "./index";
import { cleanupEmptyRoom, EMPTY_ROOM_GRACE_MS, hasActiveRoomSockets } from "./room-lifecycle";

type Session = { roomCode: string; senderName: string };

const ROOM_CODE_STORAGE_KEY = "roomCode";

export class ChatRoom extends DurableObject<Bindings> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/lifecycle/created") {
      const body = (await request.json()) as { roomCode?: unknown };
      const roomCode = roomCodeSchema.parse(body.roomCode);
      await this.ctx.storage.put(ROOM_CODE_STORAGE_KEY, roomCode);
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_GRACE_MS);
      return new Response(null, { status: 204 });
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
      const message = await createRoomMessage(createDb(this.env.DB), {
        roomCode: session.roomCode,
        senderName: session.senderName,
        text: event.text,
      });
      const payload = JSON.stringify({ type: "message", message } satisfies SocketServerEvent);
      for (const connectedSocket of this.ctx.getWebSockets()) {
        try {
          connectedSocket.send(payload);
        } catch {
          // Disconnected sockets are ignored and cleaned up by the runtime.
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "訊息格式錯誤";
      socket.send(JSON.stringify({ type: "error", message } satisfies SocketServerEvent));
    }
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    try {
      socket.close(code, reason);
    } finally {
      await this.scheduleCleanupIfEmpty(socket);
    }
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
      deleteRoom: (code) => deleteRoom(db, code),
      clearState: () => this.ctx.storage.deleteAll(),
    });
  }

  private async scheduleCleanupIfEmpty(disconnectedSocket: WebSocket): Promise<void> {
    if (hasActiveRoomSockets(this.ctx.getWebSockets(), disconnectedSocket)) return;
    await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_GRACE_MS);
  }
}
