import type {
  DynamicWorkerLoaderDefinition,
  LoadedDynamicWorker,
  ReactWorkerBuildOutput,
  WorkerLoaderBinding
} from "./types";

export function toLoaderDefinition(
  build: ReactWorkerBuildOutput,
  options: {
    compatibilityDate?: string;
    compatibilityFlags?: string[];
    globalOutbound?: Fetcher | null;
  } = {}
): DynamicWorkerLoaderDefinition {
  if (!build.ok || !build.mainModule || !build.modules) {
    const message = build.diagnostics.map((d) => `${d.tool}: ${d.message}`).join("; ");
    throw new Error(`Cannot create Worker Loader definition from failed build: ${message}`);
  }

  return {
    mainModule: build.mainModule,
    modules: build.modules,
    compatibilityDate: options.compatibilityDate ?? "2026-06-30",
    compatibilityFlags: options.compatibilityFlags,
    globalOutbound: options.globalOutbound
  };
}

export function loadDynamicWorker(
  loader: WorkerLoaderBinding,
  id: string,
  build: ReactWorkerBuildOutput,
  options: {
    compatibilityDate?: string;
    compatibilityFlags?: string[];
    globalOutbound?: Fetcher | null;
  } = {}
): LoadedDynamicWorker {
  return loader.get(id, () => toLoaderDefinition(build, options));
}
