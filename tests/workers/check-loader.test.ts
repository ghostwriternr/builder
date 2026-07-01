import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { WorkerLoaderBinding } from "../../src/types";

interface Env {
  LOADER: WorkerLoaderBinding;
}

const workerEnv = env as unknown as Env;

describe("Loader check", () => {
  it("supports { js: string } module content", async () => {
    const worker = workerEnv.LOADER.get(`control-js-obj`, () => ({
      compatibilityDate: "2026-06-30",
      mainModule: "index.js",
      modules: {
        "index.js": { js: `export default { fetch() { return new Response("loader control ok") } }` }
      }
    }));
    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    expect(await response.text()).toBe("loader control ok");
  });
});
