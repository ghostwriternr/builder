import { diagnostic } from "./diagnostics.ts";
import { transformReactTsx } from "./oxc/transform.ts";
import type { DynamicWorkerBuildOutput, DynamicWorkerModuleContent, ExplicitModuleCompileInput } from "./types.ts";

export async function compileDynamicWorkerModules(input: ExplicitModuleCompileInput): Promise<DynamicWorkerBuildOutput> {
  const diagnostics: DynamicWorkerBuildOutput["diagnostics"] = [];
  const evidence: DynamicWorkerBuildOutput["evidence"] = [];
  const modules: Record<string, DynamicWorkerModuleContent> = {};

  if (input.modules[input.entrypoint] === undefined) {
    return {
      ok: false,
      diagnostics: [diagnostic("internal", "loader-shape-failed", `Entrypoint is not present in explicit module map: ${input.entrypoint}`)],
      evidence,
    };
  }

  for (const [path, content] of Object.entries(input.modules)) {
    const outputPath = outputPathForSource(path, content);
    if (modules[outputPath] !== undefined) {
      return {
        ok: false,
        diagnostics: [diagnostic("internal", "loader-shape-failed", `Multiple input modules emit the same Worker Loader module key: ${outputPath}`)],
        evidence,
      };
    }

    if (typeof content === "string") {
      const transformed = await transformReactTsx(path, content, { jsx: input.jsx });
      evidence.push(...transformed.evidence);
      if (!transformed.ok) {
        diagnostics.push(...transformed.diagnostics);
        return { ok: false, diagnostics, evidence };
      }
      modules[outputPath] = transformed.code;
      continue;
    }

    if (typeof content !== "object" || content === null) {
      return {
        ok: false,
        diagnostics: [diagnostic("internal", "loader-shape-failed", `Module ${path} must be a string or object module.`)],
        evidence,
      };
    }

    const shapeError = validateObjectModuleContent(path, content);
    if (shapeError) {
      return {
        ok: false,
        diagnostics: [diagnostic("internal", "loader-shape-failed", shapeError)],
        evidence,
      };
    }

    modules[outputPath] = cloneModuleContent(content);
  }

  return {
    ok: true,
    mainModule: outputPathForSource(input.entrypoint, input.modules[input.entrypoint]),
    modules,
    diagnostics,
    evidence,
  };
}

function outputPathForSource(path: string, content: DynamicWorkerModuleContent): string {
  if (typeof content !== "string") return path;
  if (/\.[cm]?tsx?$/.test(path)) return path.replace(/\.[cm]?tsx?$/, ".js");
  if (/\.jsx$/.test(path)) return path.replace(/\.jsx$/, ".js");
  return path;
}

function validateObjectModuleContent(path: string, content: Exclude<DynamicWorkerModuleContent, string>): string | undefined {
  const keys = Object.keys(content);
  if (keys.length !== 1) return `Object module ${path} must contain exactly one Worker Loader type key; got ${keys.length}.`;

  const key = keys[0];
  const record = content as Record<string, unknown>;
  switch (key) {
    case "js":
    case "cjs":
    case "text":
      return typeof record[key] === "string" ? undefined : `Object module ${path} key '${key}' must contain a string.`;
    case "json":
      return undefined;
    case "data":
    case "wasm":
      return record[key] instanceof ArrayBuffer ? undefined : `Object module ${path} key '${key}' must contain an ArrayBuffer.`;
    default:
      return `Object module ${path} has unsupported Worker Loader type key: ${key}.`;
  }
}

function cloneModuleContent(content: Exclude<DynamicWorkerModuleContent, string>): Exclude<DynamicWorkerModuleContent, string> {
  if ("data" in content) return { data: content.data.slice(0) };
  if ("wasm" in content) return { wasm: content.wasm.slice(0) };
  if ("js" in content) return { js: content.js };
  if ("cjs" in content) return { cjs: content.cjs };
  if ("text" in content) return { text: content.text };
  return { json: cloneJson(content.json) };
}

function cloneJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneJson);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneJson(item)]));
}
