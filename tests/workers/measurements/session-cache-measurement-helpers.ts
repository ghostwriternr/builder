import type { ReactWorkerBuildInput } from "../../../src/types";

export interface TimedValue<T> {
  durationMs: number;
  value: T;
}

export async function measureDuration<T>(operation: () => Promise<T>): Promise<TimedValue<T>> {
  const start = performance.now();
  const value = await operation();
  return {
    durationMs: Math.round(performance.now() - start),
    value,
  };
}

export function createSessionMeasurementGraph(moduleCount: number): ReactWorkerBuildInput {
  const files: Record<string, string> = {
    "src/index.tsx": entrypointForModules(moduleCount),
  };

  for (let index = 0; index < moduleCount; index += 1) {
    files[`src/module-${index}.tsx`] = sessionMeasurementLeafSource(index, index);
  }

  return {
    entrypoint: "src/index.tsx",
    files,
  };
}

export function sessionMeasurementLeafSource(index: number, value: number): string {
  return `export function value${index}() { return ${value} }`;
}

export function entrypointWithExtraModule(moduleCount: number): string {
  return `${moduleImports(moduleCount)}
import { extra } from "./extra";

export default {
  async fetch() {
    const total = ${moduleCalls(moduleCount)} + extra();
    return new Response(String(total));
  }
};
`;
}

export function createPackageSessionMeasurementInput(): ReactWorkerBuildInput {
  return {
    entrypoint: "src/index.tsx",
    files: {
      "src/index.tsx": `
        import { label } from "pkg";
        export default { async fetch() { return new Response(label) } }
      `,
    },
    packageFiles: {
      "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", exports: "./index.js" }),
      "node_modules/pkg/index.js": `export const label = "initial";`,
    },
  };
}

export function summarizeSessionMeasurements(
  moduleCount: number,
  full: TimedValue<unknown>,
  initial: TimedValue<unknown>,
  leafUpdate: TimedValue<unknown>,
  graphUpdate: TimedValue<unknown>,
): Record<string, unknown> {
  const initialCache = sessionCache(initial.value);
  const leafCache = sessionCache(leafUpdate.value);
  const graphCache = sessionCache(graphUpdate.value);

  return {
    moduleCount,
    fullCompileMs: full.durationMs,
    sessionInitialMs: initial.durationMs,
    sessionLeafUpdateMs: leafUpdate.durationMs,
    sessionGraphUpdateMs: graphUpdate.durationMs,
    leafUpdateVsFullRatio: ratio(leafUpdate.durationMs, full.durationMs),
    graphUpdateVsFullRatio: ratio(graphUpdate.durationMs, full.durationMs),
    initialGraphScanned: initialCache?.graphScannedModules?.length,
    leafGraphScanned: leafCache?.graphScannedModules,
    leafGraphReusedCount: leafCache?.graphReusedModules?.length,
    graphUpdateGraphScanned: graphCache?.graphScannedModules,
    graphUpdateGraphReusedCount: graphCache?.graphReusedModules?.length,
  };
}

function sessionCache(value: unknown): { graphScannedModules?: string[]; graphReusedModules?: string[] } | undefined {
  return (value as { session?: { cache?: { graphScannedModules?: string[]; graphReusedModules?: string[] } } }).session?.cache;
}

function entrypointForModules(moduleCount: number): string {
  return `${moduleImports(moduleCount)}

export default {
  async fetch() {
    const total = ${moduleCalls(moduleCount)};
    return new Response(String(total));
  }
};
`;
}

function moduleImports(moduleCount: number): string {
  return Array.from({ length: moduleCount }, (_, index) => `import { value${index} } from "./module-${index}";`).join("\n");
}

function moduleCalls(moduleCount: number): string {
  return Array.from({ length: moduleCount }, (_, index) => `value${index}()`).join(" + ") || "0";
}

function ratio(value: number, baseline: number): number | null {
  if (baseline === 0) return null;
  return Number((value / baseline).toFixed(3));
}
