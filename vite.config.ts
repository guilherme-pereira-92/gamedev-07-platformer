import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/gamedev-07-platformer/" : "/",
  server: { port: 5179, open: true },
  build: { target: "es2020" },
}));
