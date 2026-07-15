import { Hono } from "hono";
import { RPCHandler } from "@orpc/server/fetch";
import { displayNameSchema, roomCodeSchema } from "@talk/shared";
import { appRouter } from "./handler";
import { createAuth } from "./auth";
import { createDb } from "./db";
import { findRoom } from "./room-service";
import { ChatRoom } from "./chat-room";

export type Bindings = {
  DB: D1Database;
  CHAT_ROOMS: DurableObjectNamespace<ChatRoom>;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
};

type Env = { Bindings: Bindings };
const app = new Hono<Env>();
const orpcHandler = new RPCHandler(appRouter);

app.on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

app.use("/rpc/*", async (c, next) => {
  const { matched, response } = await orpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: { db: createDb(c.env.DB) },
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

  const id = c.env.CHAT_ROOMS.idFromName(codeResult.data);
  const stub = c.env.CHAT_ROOMS.get(id);
  const url = new URL(c.req.url);
  url.searchParams.set("room", codeResult.data);
  url.searchParams.set("name", nameResult.data);
  return stub.fetch(new Request(url, c.req.raw));
});

app.get("/health", (c) => c.json({ status: "ok", service: "talk-backend" }));

export { ChatRoom };
export default app;
