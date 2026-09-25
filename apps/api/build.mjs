// Bundles the API + worker into dist/. Workspace packages (@shopino/*) are TypeScript sources and get
// bundled in; everything from node_modules stays external.
import { build } from "esbuild";

await build({
  entryPoints: ["src/server.ts", "src/worker.ts", "src/migrate.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  logLevel: "info",
  plugins: [
    {
      name: "externalize-node-modules",
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith("@shopino/")) return undefined;
          return { path: args.path, external: true };
        });
      },
    },
  ],
});
