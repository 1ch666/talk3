import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterContractClient } from "@orpc/contract";
import { appContract } from "@talk/shared";

const link = new RPCLink({
  url: "/rpc",
  origin: () => {
    if (typeof window === "undefined") return "http://127.0.0.1:8787";
    return window.location.origin;
  },
});

export const api: RouterContractClient<typeof appContract> = createORPCClient(link);

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message && !error.message.includes("[object Object]")) return error.message;
  return fallback;
}
