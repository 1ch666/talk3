import { DurableObject } from "cloudflare:workers";
import { roomCodeSchema, socketClientEventSchema, type SocketServerEvent } from "@talk/shared";
import { createDb } from "./db";
import { createRoomMessage } from "./room-service";
import type { Bindings } from "./index";

type Session = { roomCode: string; senderName: string };

export class ChatRoom extends DurableObject<Bindings> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const url = new URL(request.url);
    const roomCode = roomCodeSchema.parse(url.searchParams.get("room"));
    const senderName = (url.searchParams.get("name") ?? "").trim().slice(0, 24);
    if (!senderName) return new Response("Missing display name", { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ roomCode, senderName } satisfies Session);
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

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    socket.close(code, reason);
  }
}
