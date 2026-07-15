import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/rsbuild";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/rpc": "http://127.0.0.1:8787",
      "/api": {
        target: "http://127.0.0.1:8787",
        ws: true,
      },
    },
  },
  plugins: [pluginReact(), tanstackStart()],
});
