import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { checkReactTsx, compileDynamicWorker, loadDynamicWorker, TSX_COMPONENT_FIXTURE } from "../../../src/index";
import type { ReactWorkerBuildInput, ReactWorkerBuildOutput, WorkerLoaderBinding } from "../../../src/types";

interface Env {
  LOADER: WorkerLoaderBinding;
}

const workerEnv = env as unknown as Env;

let id = 0;

interface TimedResult<T> {
  durationMs: number;
  result: T;
}

async function timed<T>(operation: () => Promise<T>): Promise<TimedResult<T>> {
  const start = performance.now();
  const result = await operation();
  return { durationMs: Math.round(performance.now() - start), result };
}

function chainedGraph(moduleCount: number): ReactWorkerBuildInput {
  const files: Record<string, string> = {
    "src/index.ts": `import { value } from "./module-0";

export default {
  fetch() {
    return new Response(value);
  }
};
`
  };

  for (let index = 0; index < moduleCount; index++) {
    files[`src/module-${index}.ts`] = index === moduleCount - 1
      ? `export const value: string = "graph-${moduleCount}";
`
      : `import { value as nextValue } from "./module-${index + 1}";

export const value: string = nextValue;
`;
  }

  return { entrypoint: "src/index.ts", files };
}

function assertBuildOk(build: ReactWorkerBuildOutput): asserts build is ReactWorkerBuildOutput & { mainModule: string; modules: Record<string, string> } {
  expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
  expect(build.mainModule).toBeDefined();
  expect(build.modules).toBeDefined();
}

describe("Oxc wasmkernel compile stress in workerd", () => {
  it("records cold and warm parser/transform timings for local module graphs", async () => {
    const checkCold = await timed(() => checkReactTsx(TSX_COMPONENT_FIXTURE));
    expect(checkCold.result.ok, JSON.stringify(checkCold.result.diagnostics, null, 2)).toBe(true);

    const checkWarm = await timed(() => checkReactTsx(TSX_COMPONENT_FIXTURE));
    expect(checkWarm.result.ok, JSON.stringify(checkWarm.result.diagnostics, null, 2)).toBe(true);

    const graph10Cold = await timed(() => compileDynamicWorker(chainedGraph(10)));
    assertBuildOk(graph10Cold.result);
    expect(Object.keys(graph10Cold.result.modules)).toHaveLength(11);

    const graph10Warm = await timed(() => compileDynamicWorker(chainedGraph(10)));
    assertBuildOk(graph10Warm.result);
    expect(Object.keys(graph10Warm.result.modules)).toHaveLength(11);

    const graph50 = await timed(() => compileDynamicWorker(chainedGraph(50)));
    assertBuildOk(graph50.result);
    expect(Object.keys(graph50.result.modules)).toHaveLength(51);

    const worker = loadDynamicWorker(workerEnv.LOADER, `oxc-stress-${id++}`, graph50.result, {
      compatibilityDate: "2026-06-30"
    });
    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    expect(await response.text()).toBe("graph-50");

    const metrics = {
      checkColdMs: checkCold.durationMs,
      checkWarmMs: checkWarm.durationMs,
      graph10ColdMs: graph10Cold.durationMs,
      graph10WarmMs: graph10Warm.durationMs,
      graph50Ms: graph50.durationMs,
      graph10Modules: Object.keys(graph10Cold.result.modules).length,
      graph50Modules: Object.keys(graph50.result.modules).length,
      graph50Evidence: graph50.result.evidence.map((event) => ({
        tool: event.tool,
        stage: event.stage,
        ok: event.ok,
        durationMs: event.durationMs,
        detail: event.detail
      }))
    };

    console.log("[oxc-wasmkernel-stress]", JSON.stringify(metrics));

    for (const value of Object.values(metrics).filter((entry): entry is number => typeof entry === "number")) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});
