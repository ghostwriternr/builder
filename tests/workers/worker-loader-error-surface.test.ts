import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

import type { DynamicWorkerLoaderDefinition, WorkerLoaderBinding } from "../../src/types";

interface Env {
  LOADER: WorkerLoaderBinding;
}

interface CapturedLoaderError {
  caseName: string;
  phase: "get" | "getEntrypoint" | "fetch";
  threw: boolean;
  errorName?: string;
  message?: string;
  stack?: string;
}

const workerEnv = env as unknown as Env;
let id = 0;

async function captureWorkerLoaderError(
  caseName: string,
  definition: DynamicWorkerLoaderDefinition
): Promise<CapturedLoaderError> {
  const record: CapturedLoaderError = { caseName, phase: "get", threw: false };

  try {
    const worker = workerEnv.LOADER.get(`loader-error-${caseName}-${id++}`, () => definition);
    record.phase = "getEntrypoint";
    const entrypoint = worker.getEntrypoint();
    record.phase = "fetch";
    await entrypoint.fetch(new Request("http://worker/"));
    return record;
  } catch (error) {
    record.threw = true;
    record.errorName = error instanceof Error ? error.name : typeof error;
    record.message = error instanceof Error ? error.message : String(error);
    record.stack = error instanceof Error ? error.stack : undefined;
    return record;
  }
}

function workerDefinition(modules: DynamicWorkerLoaderDefinition["modules"], mainModule = "index.js"): DynamicWorkerLoaderDefinition {
  return {
    compatibilityDate: "2026-06-30",
    mainModule,
    modules,
  };
}

describe("Worker Loader error surface in workerd", () => {
  it("surfaces syntax errors as fetch-time startup failures with generated module context", async () => {
    const error = await captureWorkerLoaderError(
      "syntax",
      workerDefinition({
        "index.js": `export default { fetch() { return new Response("x") }`,
      })
    );

    expect(error).toMatchObject({
      caseName: "syntax",
      phase: "fetch",
      threw: true,
    });
    expect(error.message).toContain("SyntaxError");
    expect(error.message).toContain("index.js");
  });

  it("surfaces missing module imports as fetch-time startup failures", async () => {
    const error = await captureWorkerLoaderError(
      "missing-import",
      workerDefinition({
        "index.js": `import { missing } from "./missing.js"; export default { fetch() { return new Response(String(missing)) } }`,
      })
    );

    expect(error).toMatchObject({
      caseName: "missing-import",
      phase: "fetch",
      threw: true,
    });
    expect(error.message).toContain("missing.js");
    expect(error.message).toContain("index.js");
  });

  it("surfaces top-level throws as fetch-time startup failures with generated module context", async () => {
    const error = await captureWorkerLoaderError(
      "top-level",
      workerDefinition({
        "index.js": `throw new Error("top-level boom"); export default { fetch() { return new Response("x") } }`,
      })
    );

    expect(error).toMatchObject({
      caseName: "top-level",
      phase: "fetch",
      threw: true,
    });
    expect(error.message).toContain("top-level boom");
    expect(error.message).toContain("index.js");
  });

  it("rejects CJS main modules as fetch-time startup failures", async () => {
    const error = await captureWorkerLoaderError(
      "cjs-main",
      workerDefinition(
        {
          "index.cjs": { cjs: `module.exports = { fetch() { return new Response("x") } };` },
        },
        "index.cjs"
      )
    );

    expect(error).toMatchObject({
      caseName: "cjs-main",
      phase: "fetch",
      threw: true,
    });
    expect(error.message).toMatch(/ES module/i);
  });
});
