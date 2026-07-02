import { diagnostic, evidence, sourceLocationAtOffset, stringifyCause } from "../diagnostics.ts";
import type { ToolchainDiagnostic, ToolchainEvidence, TransformOptions, TransformResult } from "../types.ts";
import type { DirectTransformDiagnostic } from "./direct-transform-runtime.ts";
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

export async function experimentalTransformReactTsxDirect(filename: string, source: string, options: TransformOptions = {}): Promise<TransformResult> {
  const events: ToolchainEvidence[] = [];
  const importStarted = performance.now();

  try {
    const { getDirectTransformer } = await import("./direct-transform-runtime.ts");
    await getDirectTransformer();
    events.push(evidence("oxc-transform", "import", true, importStarted, "instantiated oxc-transform wasm through direct ABI"));
  } catch (error) {
    events.push(evidence("oxc-transform", "import", false, importStarted));
    return {
      ok: false,
      diagnostics: [diagnostic("oxc-transform", "import-failed", "Could not initialize Oxc direct transform in workerd.", error)],
      evidence: events,
    };
  }

  const transformStarted = performance.now();
  try {
    const { transformWithDirectTransformer } = await import("./direct-transform-runtime.ts");
    const result = await transformWithDirectTransformer(filename, source, transformOptions(filename, options));
    const directDiagnostics = collectArrayLike(result.diagnostics);

    if (result.ok !== true || typeof result.code !== "string") {
      events.push(evidence("oxc-transform", "transform", false, transformStarted, `${directDiagnostics.length} direct transform errors`));
      return {
        ok: false,
        diagnostics: directDiagnostics.length > 0
          ? directDiagnostics.map((directDiagnostic) => directTransformDiagnostic(filename, source, directDiagnostic))
          : [diagnostic("oxc-transform", "transform-failed", "Oxc direct transform failed without structured diagnostics.")],
        evidence: events,
      };
    }

    events.push(evidence("oxc-transform", "transform", true, transformStarted, `transformed ${filename} through direct ABI`));
    return { ok: true, code: result.code, map: result.map, diagnostics: [], evidence: events };
  } catch (error) {
    events.push(evidence("oxc-transform", "transform", false, transformStarted));
    return {
      ok: false,
      diagnostics: [diagnostic("oxc-transform", "transform-failed", "Oxc direct transform failed in workerd.", error)],
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

function directTransformDiagnostic(filename: string, source: string, value: unknown): ToolchainDiagnostic {
  const direct = value as DirectTransformDiagnostic;
  const start = typeof direct.start === "number" ? byteOffsetToStringOffset(source, direct.start) : undefined;
  const end = typeof direct.end === "number" ? byteOffsetToStringOffset(source, direct.end) : undefined;
  const location = start === undefined ? undefined : sourceLocationAtOffset(source, start);
  return {
    tool: "oxc-transform",
    kind: "transform-failed",
    severity: direct.severity === "warning" ? "warning" : "error",
    message: typeof direct.message === "string" ? direct.message : String(value),
    file: typeof direct.file === "string" && direct.file.length > 0 ? direct.file : filename,
    line: location?.line,
    column: location?.column,
    span: start !== undefined && end !== undefined
      ? { start, end }
      : undefined,
  };
}

function byteOffsetToStringOffset(source: string, byteOffset: number): number {
  if (!Number.isFinite(byteOffset)) return 0;
  const target = Math.max(0, Math.trunc(byteOffset));
  let bytes = 0;

  for (let index = 0; index < source.length;) {
    if (bytes >= target) return index;
    const codePoint = source.codePointAt(index) ?? 0;
    const width = utf8ByteLength(codePoint);
    if (bytes + width > target) return index;
    bytes += width;
    index += codePoint > 0xffff ? 2 : 1;
  }

  return source.length;
}

function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
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
