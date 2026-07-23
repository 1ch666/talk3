import server from "./dist/server/index.js";

const BACKEND_ORIGIN = "https://talk-backend.yichengc869.workers.dev";

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("referrer-policy", "no-referrer");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/assets/")) return withSecurityHeaders(await env.ASSETS.fetch(request));
    if (url.pathname === "/rpc" || url.pathname.startsWith("/rpc/") || url.pathname.startsWith("/api/")) {
      const backendUrl = new URL(url.pathname + url.search, BACKEND_ORIGIN);
      return env.BACKEND.fetch(new Request(backendUrl, request));
    }
    return withSecurityHeaders(await server.fetch(request, env, context));
  },
};
