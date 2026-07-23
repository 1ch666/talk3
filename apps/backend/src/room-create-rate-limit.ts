export const ROOM_CREATE_RATE_LIMIT_MESSAGE = "\u5efa\u7acb\u623f\u9593\u592a\u983b\u7e41\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002";
export const ROOM_CREATE_LIMIT = 5;
export const ROOM_CREATE_WINDOW_MS = 60_000;
export const IMAGE_UPLOAD_LIMIT = 10;
export const ROOM_MESSAGE_LIMIT = 120;

export type RoomCreateRateState = {
  count: number;
  resetAt: number;
};

export type RoomCreateRateDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
  state: RoomCreateRateState;
};

export async function roomCreateRateLimitKey(request: Request): Promise<string> {
  const clientIp = request.headers.get("cf-connecting-ip")?.trim().toLowerCase() || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientIp));
  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function consumeFixedWindowPermit(
  state: RoomCreateRateState | undefined,
  now: number,
  limit: number,
  windowMs = ROOM_CREATE_WINDOW_MS,
): RoomCreateRateDecision {
  if (!state || now >= state.resetAt) {
    return { allowed: true, retryAfterSeconds: 0, state: { count: 1, resetAt: now + windowMs } };
  }
  if (state.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((state.resetAt - now) / 1000)),
      state,
    };
  }
  return { allowed: true, retryAfterSeconds: 0, state: { ...state, count: state.count + 1 } };
}

export function consumeRoomCreatePermit(state: RoomCreateRateState | undefined, now: number): RoomCreateRateDecision {
  return consumeFixedWindowPermit(state, now, ROOM_CREATE_LIMIT);
}
