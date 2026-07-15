import server from "./dist/server/index.js";

const BACKEND_ORIGIN = "https://talk-backend.yichengc869.workers.dev";

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/assets/")) return env.ASSETS.fetch(request);
    if (url.pathname === "/rpc" || url.pathname.startsWith("/rpc/") || url.pathname.startsWith("/api/")) {
      const backendUrl = new URL(url.pathname + url.search, BACKEND_ORIGIN);
      return env.BACKEND.fetch(new Request(backendUrl, request));
    }
    return server.fetch(request, env, context);
  },
};
