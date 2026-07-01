import { diagnostic, evidence, isProbablyWorkerd } from "../diagnostics";
import type {
  ReactWorkerBuildInput,
  ReactWorkerBuildOutput,
  ToolchainDiagnostic,
  ToolchainEvidence
} from "../types";

type RolldownModule = {
  rolldown?: (input: unknown) => Promise<{
    generate(output: unknown): Promise<{ output?: Array<{ type: string; fileName?: string; code?: string }> }>;
    close(): Promise<void>;
  }>;
  build?: (options: unknown) => Promise<unknown>;
};

export async function bundleWithRolldownBrowser(input: ReactWorkerBuildInput): Promise<ReactWorkerBuildOutput> {
  const diagnostics: ToolchainDiagnostic[] = [];
  const events: ToolchainEvidence[] = [];

  const importStart = performance.now();
  if (isProbablyWorkerd()) {
    events.push(evidence("rolldown-browser", "import", false, importStart, "published browser entry fetches .wasm via file URL in this test runtime"));
    diagnostics.push(
      diagnostic(
        "rolldown-browser",
        "runtime-unsupported",
        "@rolldown/browser is the right published package to investigate, but its current browser glue is not directly loadable as a workerd runtime bundler here: it fetches rolldown-binding.wasm32-wasi.wasm from import.meta.url and relies on Worker/SharedArrayBuffer/WASI/NAPI machinery."
      )
    );
    return { ok: false, diagnostics, evidence: events, toolchain: { bundler: "rolldown-browser", loaderTarget: "none" } };
  }

  let rolldownModule: RolldownModule;
  try {
    rolldownModule = (await import("@rolldown/browser")) as unknown as RolldownModule;
    events.push(evidence("rolldown-browser", "import", true, importStart, "imported @rolldown/browser"));
  } catch (error) {
    events.push(evidence("rolldown-browser", "import", false, importStart));
    diagnostics.push(
      diagnostic(
        "rolldown-browser",
        "import-failed",
        "Could not import @rolldown/browser inside workerd.",
        error
      )
    );
    return { ok: false, diagnostics, evidence: events, toolchain: { bundler: "rolldown-browser", loaderTarget: "none" } };
  }

  if (typeof rolldownModule.rolldown !== "function") {
    diagnostics.push(diagnostic("rolldown-browser", "runtime-unsupported", "@rolldown/browser imported, but did not expose rolldown()."));
    return { ok: false, diagnostics, evidence: events, toolchain: { bundler: "rolldown-browser", loaderTarget: "none" } };
  }

  const bundleStart = performance.now();
  let bundle: Awaited<ReturnType<NonNullable<RolldownModule["rolldown"]>>> | undefined;
  try {
    bundle = await rolldownModule.rolldown({
      input: input.entrypoint,
      plugins: [virtualFilesPlugin(input.files)],
      treeshake: false
    });
    const generated = await bundle.generate({ format: "esm" });
    const chunk = generated.output?.find((item) => item.type === "chunk" && typeof item.code === "string");
    if (!chunk?.code) {
      events.push(evidence("rolldown-browser", "bundle", false, bundleStart, "no output chunk"));
      diagnostics.push(diagnostic("rolldown-browser", "bundle-failed", "Rolldown generated no JavaScript chunk for Worker Loader."));
      return { ok: false, diagnostics, evidence: events, toolchain: { bundler: "rolldown-browser", loaderTarget: "none" } };
    }

    events.push(evidence("rolldown-browser", "bundle", true, bundleStart, `generated ${chunk.fileName ?? "bundle.js"}`));
    return {
      ok: true,
      mainModule: "bundle.js",
      modules: { "bundle.js": chunk.code },
      diagnostics,
      evidence: events,
      toolchain: { bundler: "rolldown-browser", loaderTarget: "worker-loader" }
    };
  } catch (error) {
    events.push(evidence("rolldown-browser", "bundle", false, bundleStart));
    diagnostics.push(
      diagnostic(
        "rolldown-browser",
        "bundle-failed",
        "@rolldown/browser imported but could not bundle virtual TSX files inside workerd.",
        error
      )
    );
    return { ok: false, diagnostics, evidence: events, toolchain: { bundler: "rolldown-browser", loaderTarget: "none" } };
  } finally {
    await bundle?.close().catch(() => undefined);
  }
}

function virtualFilesPlugin(files: Record<string, string>) {
  return {
    name: "spike-virtual-files",
    resolveId(source: string, importer?: string) {
      if (Object.hasOwn(files, source)) return source;
      if (source.startsWith(".")) {
        const resolved = resolveRelative(importer ?? "", source, files);
        if (resolved) return resolved;
      }
      return { id: source, external: true };
    },
    load(id: string) {
      if (Object.hasOwn(files, id)) return files[id];
      return null;
    }
  };
}

function resolveRelative(importer: string, specifier: string, files: Record<string, string>): string | undefined {
  const base = importer.includes("/") ? importer.slice(0, importer.lastIndexOf("/")) : "";
  const parts = `${base}/${specifier}`.split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  const stem = normalized.join("/");
  for (const candidate of [stem, `${stem}.tsx`, `${stem}.ts`, `${stem}.jsx`, `${stem}.js`]) {
    if (Object.hasOwn(files, candidate)) return candidate;
  }
  return undefined;
}
