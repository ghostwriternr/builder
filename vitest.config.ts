import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "node-metadata",
    include: ["tests/node/**/*.test.ts"]
  }
});
