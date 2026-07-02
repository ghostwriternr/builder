import type { DynamicWorkerBuildOutput, DynamicWorkerLoaderDefinition, LoadedDynamicWorker, WorkerLoaderBinding } from "./types.ts";

export function toLoaderDefinition(
  build: DynamicWorkerBuildOutput,
  options: { compatibilityDate?: string; compatibilityFlags?: string[]; globalOutbound?: Fetcher | null } = {},
): DynamicWorkerLoaderDefinition {
  if (!build.ok || !build.mainModule || !build.modules) {
    const message = build.diagnostics.map((item) => `${item.tool}: ${item.message}`).join("; ");
    throw new Error(`Cannot create Worker Loader definition from failed build: ${message}`);
  }

  return {
    mainModule: build.mainModule,
    modules: build.modules,
    compatibilityDate: options.compatibilityDate ?? "2026-06-30",
    compatibilityFlags: options.compatibilityFlags,
    globalOutbound: options.globalOutbound,
  };
}

export function loadDynamicWorker(
  loader: WorkerLoaderBinding,
  id: string,
  build: DynamicWorkerBuildOutput,
  options: { compatibilityDate?: string; compatibilityFlags?: string[]; globalOutbound?: Fetcher | null } = {},
): LoadedDynamicWorker {
  return loader.get(id, () => toLoaderDefinition(build, options));
}
