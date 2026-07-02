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
      "node_modules/unused/package.json": JSON.stringify({ name: "unused", exports: "./index.js" }),
      "node_modules/unused/index.js": `export const label = "unused";`,
    },
  };
}

export function createCandidatePackageSessionMeasurementInput(): ReactWorkerBuildInput {
  return {
    entrypoint: "src/index.tsx",
    files: {
      "src/index.tsx": `
        import { label } from "candidate-pkg";
        export default { async fetch() { return new Response(label) } }
      `,
    },
    packageFiles: {
      "node_modules/candidate-pkg/package.json": JSON.stringify({ name: "candidate-pkg", exports: "./index.js" }),
      "node_modules/candidate-pkg/index.js": `import { label } from "./dep";
export { label };
`,
      "node_modules/candidate-pkg/dep.mjs": `export const label = "mjs dependency";`,
    },
  };
}

export function summarizeSessionMeasurements(
  moduleCount: number,
  full: TimedValue<unknown>,
  initial: TimedValue<unknown>,
  leafUpdate: TimedValue<unknown>,
  virtualUpdate: TimedValue<unknown>,
  graphUpdate: TimedValue<unknown>,
): Record<string, unknown> {
  const initialCache = sessionCache(initial.value);
  const leafCache = sessionCache(leafUpdate.value);
  const virtualCache = sessionCache(virtualUpdate.value);
  const graphCache = sessionCache(graphUpdate.value);

  return {
    moduleCount,
    fullCompileMs: full.durationMs,
    sessionInitialMs: initial.durationMs,
    sessionLeafUpdateMs: leafUpdate.durationMs,
    sessionUnrelatedVirtualUpdateMs: virtualUpdate.durationMs,
    sessionGraphUpdateMs: graphUpdate.durationMs,
    leafUpdateVsFullRatio: ratio(leafUpdate.durationMs, full.durationMs),
    unrelatedVirtualUpdateVsFullRatio: ratio(virtualUpdate.durationMs, full.durationMs),
    graphUpdateVsFullRatio: ratio(graphUpdate.durationMs, full.durationMs),
    initialCache: summarizeCache(initialCache),
    leafUpdateCache: summarizeCache(leafCache),
    unrelatedVirtualUpdateCache: summarizeCache(virtualCache),
    graphUpdateCache: summarizeCache(graphCache),
  };
}

export function summarizeSessionMeasurementSteps(steps: Record<string, TimedValue<unknown>>): Array<Record<string, unknown>> {
  return Object.entries(steps).map(([label, timed]) => {
    const cache = sessionCache(timed.value);
    return {
      label,
      durationMs: timed.durationMs,
      moduleCount: moduleCount(timed.value),
      ...summarizeCache(cache),
    };
  });
}

function sessionCache(value: unknown): SessionCacheSummary | undefined {
  return (value as { session?: { cache?: SessionCacheSummary } }).session?.cache;
}

interface SessionCacheSummary {
  transformedModules?: string[];
  reusedModules?: string[];
  droppedModules?: string[];
  graphScannedModules?: string[];
  graphReusedModules?: string[];
  packageGraphRebuilt?: boolean;
}

function summarizeCache(cache: SessionCacheSummary | undefined): Record<string, unknown> {
  return {
    transformedModules: cache?.transformedModules,
    transformedCount: cache?.transformedModules?.length,
    reusedModules: cache?.reusedModules,
    reusedCount: cache?.reusedModules?.length,
    droppedModules: cache?.droppedModules,
    graphScannedModules: cache?.graphScannedModules,
    graphScannedCount: cache?.graphScannedModules?.length,
    graphReusedModules: cache?.graphReusedModules,
    graphReusedCount: cache?.graphReusedModules?.length,
    packageGraphRebuilt: cache?.packageGraphRebuilt,
  };
}

function moduleCount(value: unknown): number | undefined {
  const modules = (value as { modules?: Record<string, unknown> }).modules;
  return modules ? Object.keys(modules).length : undefined;
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
