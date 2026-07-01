import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  WORKER_ENTRY_FIXTURE,
  TSX_COMPONENT_FIXTURE,
  checkReactTsx,
  compileDynamicWorker,
  explainDevelopmentTooling,
  loadDynamicWorker,
  toLoaderDefinition
} from "../../src/index";
import type { WorkerLoaderBinding } from "../../src/types";

interface Env {
  LOADER: WorkerLoaderBinding;
}

const workerEnv = env as unknown as Env;

let id = 0;

describe("Dynamic Worker TSX compiler workflow in workerd", () => {
  it("can load a control Worker Loader module shape", async () => {
    const worker = workerEnv.LOADER.get(`control-${id++}`, () => ({
      compatibilityDate: "2026-06-30",
      mainModule: "index.js",
      modules: {
        "index.js": `export default { fetch() { return new Response("loader control ok") } }`
      }
    }));

    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    expect(await response.text()).toBe("loader control ok");
  });

  it("checks React TSX source through the workerd Oxc parser path or returns structured evidence", async () => {
    const result = await checkReactTsx(TSX_COMPONENT_FIXTURE);

    expect(result.evidence.length).toBeGreaterThan(0);
    if (!result.ok) {
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0]).toMatchObject({ tool: "oxc-parser", severity: "error" });
    }
  });

  it("compiles the minimal Worker fixture when a VoidZero-family workerd path is viable", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.tsx",
      files: { "src/index.tsx": WORKER_ENTRY_FIXTURE }
    });

    expect(build.evidence.length).toBeGreaterThan(0);

    if (!build.ok) {
      expect(build.mainModule).toBeUndefined();
      expect(build.modules).toBeUndefined();
      expect(build.diagnostics.length).toBeGreaterThan(0);
      expect(build.diagnostics.every((d) => d.severity === "error")).toBe(true);
      return;
    }

    expect(build.mainModule).toBeDefined();
    expect(build.modules?.[build.mainModule!]).toContain("hello from compiled worker");

    const worker = loadDynamicWorker(workerEnv.LOADER, `compiled-${id++}`, build, {
      compatibilityDate: "2026-06-30"
    });
    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    expect(await response.text()).toBe("hello from compiled worker");
  });

  it("distinguishes loader-shape failures from compiler failures", () => {
    expect(() =>
      toLoaderDefinition({
        ok: false,
        diagnostics: [
          {
            tool: "rolldown-browser",
            kind: "bundle-failed",
            severity: "error",
            message: "bundle failed before loader"
          }
        ],
        evidence: [],
        toolchain: { loaderTarget: "none" }
      })
    ).toThrow(/Cannot create Worker Loader definition/);
  });

  it("classifies Vite/Oxlint/Oxfmt as development tools, not workerd builder paths", async () => {
    const result = await explainDevelopmentTooling();
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.tool)).toEqual([
      "vite",
      "rolldown-vite",
      "oxlint",
      "oxfmt"
    ]);
    expect(result.diagnostics.every((d) => d.kind === "not-applicable")).toBe(true);
  });
});
