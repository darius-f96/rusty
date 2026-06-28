import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["cjs"],
  target: "node20",
  platform: "node",
  splitting: false,
  sourcemap: false,
  dts: false,
  noExternal: [/.*/],
  shims: true,
});
