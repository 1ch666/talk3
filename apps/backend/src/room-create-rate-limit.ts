export const ROOM_CREATE_RATE_LIMIT_MESSAGE = "??????????????";

export async function roomCreateRateLimitKey(request: Request): Promise<string> {
  const clientIp = request.headers.get("cf-connecting-ip")?.trim().toLowerCase() || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientIp));
  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
