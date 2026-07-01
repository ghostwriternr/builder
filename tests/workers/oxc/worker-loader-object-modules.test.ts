import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { compileDynamicWorker, loadDynamicWorker } from "../../../src/index";
import type { WorkerLoaderBinding } from "../../../src/types";

interface Env {
  LOADER: WorkerLoaderBinding;
}

const workerEnv = env as unknown as Env;

let id = 0;

function bufferFrom(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

const addWasmBytes = bufferFrom([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x07, 0x01, 0x60, 0x02, 0x7f,
  0x7f, 0x01, 0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64,
  0x00, 0x00, 0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b
]);

describe("Worker Loader object modules", () => {
  it("loads json, text, data, and wasm object modules from a control module map", async () => {
    const worker = workerEnv.LOADER.get(`object-control-${id++}`, () => ({
      compatibilityDate: "2026-06-30",
      mainModule: "index.js",
      modules: {
        "index.js": `import config from "./config.json";
import message from "./message.txt";
import bytes from "./bytes.bin";
import addWasm from "./add.wasm";

export default {
  async fetch() {
    const instance = await WebAssembly.instantiate(addWasm, {});
    const add = instance.exports.add;
    return Response.json({
      answer: config.answer,
      message,
      firstByte: new Uint8Array(bytes)[0],
      sum: add(20, 22)
    });
  }
};
`,
        "config.json": { json: { answer: 42 } },
        "message.txt": { text: "hello from text module" },
        "bytes.bin": { data: bufferFrom([7, 8, 9]) },
        "add.wasm": { wasm: addWasmBytes }
      }
    } as any));

    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    await expect(response.json()).resolves.toEqual({
      answer: 42,
      message: "hello from text module",
      firstByte: 7,
      sum: 42
    });
  });

  it("returns structured diagnostics for unsupported virtual object module shapes", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `import styles from "app/styles.css";
export default { fetch() { return new Response(String(styles)); } };
`
      },
      virtualModules: {
        "app/styles.css": { css: ".button {}" }
      } as any
    });

    expect(build.ok).toBe(false);
    expect(build.diagnostics).toContainEqual(
      expect.objectContaining({
        tool: "worker-loader",
        kind: "loader-shape-failed",
        message: expect.stringContaining("Unsupported virtual module content for app/styles.css")
      })
    );
  });

  it("emits virtual object modules as Worker Loader object modules", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `import config from "app/config.json";
import message from "app/message.txt";
import bytes from "app/bytes.bin";
import addWasm from "app/add.wasm";

export default {
  async fetch() {
    const instance = await WebAssembly.instantiate(addWasm, {});
    const add = instance.exports.add;
    return Response.json({
      answer: config.answer,
      message,
      firstByte: new Uint8Array(bytes)[0],
      sum: add(20, 22)
    });
  }
};
`
      },
      virtualModules: {
        "app/config.json": { json: { answer: 42 } },
        "app/message.txt": { text: "hello from virtual text" },
        "app/bytes.bin": { data: bufferFrom([7, 8, 9]) },
        "app/add.wasm": { wasm: addWasmBytes }
      }
    });

    expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
    expect(build.mainModule).toBe("src/index.js");
    expect(Object.keys(build.modules ?? {}).sort()).toEqual([
      "app/add.wasm",
      "app/bytes.bin",
      "app/config.json",
      "app/message.txt",
      "src/index.js"
    ]);
    expect(build.modules?.["src/index.js"]).toContain("from \"/app/config.json\"");
    expect(build.modules?.["src/index.js"]).toContain("from \"/app/message.txt\"");
    expect(build.modules?.["src/index.js"]).toContain("from \"/app/bytes.bin\"");
    expect(build.modules?.["src/index.js"]).toContain("from \"/app/add.wasm\"");
    expect(build.modules?.["app/config.json"]).toEqual({ json: { answer: 42 } });
    expect(build.modules?.["app/message.txt"]).toEqual({ text: "hello from virtual text" });
    expect(build.modules?.["app/bytes.bin"]).toEqual({ data: bufferFrom([7, 8, 9]) });
    expect(build.modules?.["app/add.wasm"]).toEqual({ wasm: addWasmBytes });

    const worker = loadDynamicWorker(workerEnv.LOADER, `object-virtual-${id++}`, build, {
      compatibilityDate: "2026-06-30"
    });
    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    await expect(response.json()).resolves.toEqual({
      answer: 42,
      message: "hello from virtual text",
      firstByte: 7,
      sum: 42
    });
  });
});
