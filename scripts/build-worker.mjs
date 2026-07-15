import path from "node:path";
import { rspack } from "@rspack/core";

const root = path.resolve(import.meta.dirname, "..");

const compiler = rspack({
  mode: "production",
  target: "webworker",
  entry: path.join(root, "apps/backend/src/index.ts"),
  output: {
    path: path.join(root, "apps/backend/dist"),
    filename: "worker.js",
    module: true,
    library: { type: "module" },
    chunkFormat: "module",
    clean: true,
  },
  experiments: { outputModule: true },
  externalsType: "module",
  externals: { "cloudflare:workers": "cloudflare:workers" },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: [
          {
            loader: "builtin:swc-loader",
            options: { jsc: { parser: { syntax: "typescript" } } },
          },
        ],
      },
    ],
  },
  resolve: { extensions: [".ts", ".tsx", ".js", ".mjs"] },
  optimization: { minimize: true },
});

compiler.run((error, stats) => {
  compiler.close(() => {});
  if (error) {
    console.error(error);
    process.exitCode = 1;
    return;
  }
  if (stats?.hasErrors()) {
    console.error(stats.toString({ colors: true, errors: true, warnings: true }));
    process.exitCode = 1;
    return;
  }
  console.log(stats?.toString({ colors: true, assets: true, chunks: false, modules: false }));
});
