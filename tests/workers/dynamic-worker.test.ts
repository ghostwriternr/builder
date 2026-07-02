import { env } from "cloudflare:test";
import { describe, expect, test } from "vitest";

import { compileDynamicWorkerModules, loadDynamicWorker, toLoaderDefinition } from "../../src/index";

describe("compileDynamicWorkerModules", () => {
  test("transforms an explicit TS module map and loads it with Worker Loader", async () => {
    const build = await compileDynamicWorkerModules({
      entrypoint: "src/index.ts",
      modules: {
        "src/index.ts": `
          import { message } from "./message.js";
          export default { async fetch() { return new Response(message) } };
        `,
        "src/message.ts": `export const message: string = "hello from workerd-oxc";`,
      },
    });

    expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
    expect(build.mainModule).toBe("src/index.js");
    expect(Object.keys(build.modules ?? {}).sort()).toEqual(["src/index.js", "src/message.js"]);

    const definition = toLoaderDefinition(build, { compatibilityDate: "2026-06-30" });
    expect(definition.mainModule).toBe("src/index.js");

    const worker = loadDynamicWorker(env.LOADER, "explicit-map-load", build, { compatibilityDate: "2026-06-30" });
    const response = await worker.getEntrypoint().fetch(new Request("https://example.com/"));
    await expect(response.text()).resolves.toBe("hello from workerd-oxc");
  });

  test("does not resolve or rewrite caller import specifiers", async () => {
    const build = await compileDynamicWorkerModules({
      entrypoint: "src/index.ts",
      modules: {
        "src/index.ts": `
          import { message } from "./message.ts";
          export default { async fetch() { return new Response(message) } };
        `,
        "src/message.ts": `export const message: string = "unresolved by design";`,
      },
    });

    expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
    expect(build.modules?.["src/index.js"]).toContain("./message.ts");
    expect(build.modules?.["src/message.js"]).toContain("unresolved by design");

    const worker = loadDynamicWorker(env.LOADER, "unresolved-specifier-load", build, { compatibilityDate: "2026-06-30" });
    await expect(worker.getEntrypoint().fetch(new Request("https://example.com/"))).rejects.toThrow(/message\.ts|No such module|not found|could not resolve/i);
  });

  test("rejects malformed object module content before Worker Loader", async () => {
    const multiKey = await compileDynamicWorkerModules({
      entrypoint: "src/index.ts",
      modules: {
        "src/index.ts": `export default { async fetch() { return new Response("unused") } };`,
        "src/bad.js": { js: "export const a = 1;", text: "bad" } as never,
      },
    });

    expect(multiKey.ok).toBe(false);
    expect(multiKey.diagnostics[0]).toMatchObject({
      tool: "internal",
      kind: "loader-shape-failed",
      severity: "error",
      message: expect.stringContaining("exactly one"),
    });

    const nullModule = await compileDynamicWorkerModules({
      entrypoint: "src/index.ts",
      modules: {
        "src/index.ts": `export default { async fetch() { return new Response("unused") } };`,
        "src/null.js": null as never,
      },
    });

    expect(nullModule.ok).toBe(false);
    expect(nullModule.diagnostics[0]).toMatchObject({
      tool: "internal",
      kind: "loader-shape-failed",
      severity: "error",
      message: expect.stringContaining("must be a string or object module"),
    });
  });

  test("preserves non-JS Worker Loader object modules as explicit leaves", async () => {
    const build = await compileDynamicWorkerModules({
      entrypoint: "src/index.ts",
      modules: {
        "src/index.ts": `
          import data from "./data.json";
          import text from "./note.txt";
          export default { async fetch() { return Response.json({ data, text }) } };
        `,
        "src/data.json": { json: { ok: true } },
        "src/note.txt": { text: "note" },
      },
    });

    expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
    expect(build.modules?.["src/data.json"]).toEqual({ json: { ok: true } });
    expect(build.modules?.["src/note.txt"]).toEqual({ text: "note" });

    const worker = loadDynamicWorker(env.LOADER, "object-module-load", build, { compatibilityDate: "2026-06-30" });
    const response = await worker.getEntrypoint().fetch(new Request("https://example.com/"));
    await expect(response.json()).resolves.toEqual({ data: { ok: true }, text: "note" });
  });

  test("rejects failed builds before Worker Loader", () => {
    expect(() => toLoaderDefinition({ ok: false, diagnostics: [], evidence: [] })).toThrow(/failed build/i);
  });
});
