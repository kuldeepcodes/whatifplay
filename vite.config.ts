import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/whatifplay/" : "/",
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
