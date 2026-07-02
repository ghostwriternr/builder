import { diagnostic, evidence, stringifyCause } from "../diagnostics.ts";
import type { ToolchainDiagnostic, ToolchainEvidence, TransformOptions, TransformResult } from "../types.ts";
import { getOxcTransformer } from "./runtime.ts";

export async function transformReactTsx(filename: string, source: string, options: TransformOptions = {}): Promise<TransformResult> {
  const events: ToolchainEvidence[] = [];
  const importStarted = performance.now();
  let transformer;

  try {
    transformer = await getOxcTransformer();
    events.push(evidence("oxc-transform", "import", true, importStarted, "instantiated oxc-transform wasm through @alexbruf/wasmkernel"));
  } catch (error) {
    events.push(evidence("oxc-transform", "import", false, importStarted));
    return {
      ok: false,
      diagnostics: [diagnostic("oxc-transform", "import-failed", "Could not initialize Oxc transform in workerd.", error)],
      evidence: events,
    };
  }

  const transformStarted = performance.now();
  try {
    if (typeof transformer.transformSync !== "function" && typeof transformer.transform !== "function") {
      throw new Error("Oxc transform exports transformSync/transform are unavailable.");
    }

    const result = transformer.transformSync
      ? transformer.transformSync(filename, source, transformOptions(filename, options))
      : await transformer.transform!(filename, source, transformOptions(filename, options));
    const errors = collectArrayLike(result.errors);

    if (typeof result.code !== "string" || errors.length > 0) {
      events.push(evidence("oxc-transform", "transform", false, transformStarted, `${errors.length} transform errors`));
      return {
        ok: false,
        diagnostics: errors.length > 0
          ? errors.map((error) => transformErrorDiagnostic(filename, error))
          : [diagnostic("oxc-transform", "transform-failed", `Oxc transform did not produce JavaScript for ${filename}.`)],
        evidence: events,
      };
    }

    events.push(evidence("oxc-transform", "transform", true, transformStarted, `transformed ${filename}`));
    return { ok: true, code: result.code, map: result.map, diagnostics: [], evidence: events };
  } catch (error) {
    events.push(evidence("oxc-transform", "transform", false, transformStarted));
    return {
      ok: false,
      diagnostics: [diagnostic("oxc-transform", "transform-failed", "Oxc transform failed in workerd.", error)],
      evidence: events,
    };
  }
}

function transformOptions(filename: string, options: TransformOptions): Record<string, unknown> {
  return {
    lang: languageForFilename(filename),
    sourceType: "module",
    typescript: {},
    jsx: jsxOptions(options),
    target: "es2022",
    sourcemap: true,
  };
}

function jsxOptions(options: TransformOptions): unknown {
  if (options.jsx?.runtime === "preserve") return "preserve";
  return {
    runtime: options.jsx?.runtime ?? "automatic",
    importSource: options.jsx?.importSource ?? "react",
    development: false,
  };
}

function languageForFilename(filename: string): "js" | "jsx" | "ts" | "tsx" {
  if (filename.endsWith(".tsx")) return "tsx";
  if (filename.endsWith(".ts") || filename.endsWith(".mts")) return "ts";
  if (filename.endsWith(".jsx")) return "jsx";
  return "js";
}

function transformErrorDiagnostic(filename: string, error: unknown): ToolchainDiagnostic {
  return {
    tool: "oxc-transform",
    kind: "transform-failed",
    severity: "error",
    message: String(error),
    file: filename,
    cause: stringifyCause(error),
  };
}

function collectArrayLike(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "object" || value === null) return [];

  if (Symbol.iterator in value && typeof value[Symbol.iterator] === "function") {
    const iterated = Array.from(value as Iterable<unknown>);
    if (iterated.length > 0) return iterated;
  }

  const items: unknown[] = [];
  const indexable = value as Record<number, unknown>;
  for (let index = 0; index < 1000; index += 1) {
    const item = indexable[index];
    if (item === undefined) break;
    items.push(item);
  }
  return items;
}
