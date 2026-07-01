import {
  initSync,
  parseSync,
  transformSync,
  type Module,
  type Options,
  type Output,
  type ParseOptions
} from "@swc/wasm-web";
import swcWasmModule from "@swc/wasm-web/wasm_bg.wasm";
import { evidence, stringifyCause } from "../diagnostics";
import type { ToolchainDiagnostic, ToolchainEvidence } from "../types";

export interface ExperimentalSwcOptions {
  transformFromAst?: boolean;
}

export type ExperimentalSwcParseTransformResult =
  | {
      ok: true;
      ast: Module;
      code: string;
      output: Output;
      diagnostics: [];
      evidence: ToolchainEvidence[];
    }
  | {
      ok: false;
      ast?: undefined;
      code?: undefined;
      output?: undefined;
      diagnostics: ToolchainDiagnostic[];
      evidence: ToolchainEvidence[];
    };

const PARSE_OPTIONS = {
  syntax: "typescript",
  tsx: true,
  target: "es2022",
  comments: true
} satisfies ParseOptions;

let initialized = false;

/**
 * Experimental SWC wasm-web helper for workerd-hosted TSX tooling. It keeps
 * SWC separate from the Dynamic Worker compiler path while we evaluate whether
 * one workerd-compatible package can provide both full AST access and TSX to
 * JavaScript transforms.
 */
export function experimentalParseTransformReactTsxWithSwc(
  source: string,
  filename = "input.tsx",
  options: ExperimentalSwcOptions = {}
): ExperimentalSwcParseTransformResult {
  const collectedEvidence: ToolchainEvidence[] = [];

  try {
    ensureSwcInitialized(collectedEvidence);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [swcDiagnostic("import-failed", filename, "Could not initialize @swc/wasm-web in workerd.", error)],
      evidence: collectedEvidence.length > 0
        ? collectedEvidence
        : [evidence("swc-wasm-web", "import", false, performance.now(), "SWC initialization failed.")]
    };
  }

  const parseStarted = performance.now();
  let ast: Module;
  try {
    ast = parseSync(source, PARSE_OPTIONS);
    collectedEvidence.push(evidence("swc-wasm-web", "parse", true, parseStarted, "Parsed TSX into an SWC Module AST."));
  } catch (error) {
    collectedEvidence.push(evidence("swc-wasm-web", "parse", false, parseStarted, "SWC parser rejected TSX source."));
    return {
      ok: false,
      diagnostics: [swcDiagnostic("parse-failed", filename, "SWC parser failed to parse TSX source.", error)],
      evidence: collectedEvidence
    };
  }

  const transformStarted = performance.now();
  const transformOptions = swcTransformOptions(filename);
  try {
    const output = options.transformFromAst
      ? transformSync(ast, transformOptions)
      : transformSync(source, transformOptions);
    collectedEvidence.push(
      evidence(
        "swc-wasm-web",
        "transform",
        true,
        transformStarted,
        options.transformFromAst ? "Transformed TSX from parsed AST." : "Transformed TSX from source text."
      )
    );

    return { ok: true, ast, code: output.code, output, diagnostics: [], evidence: collectedEvidence };
  } catch (error) {
    collectedEvidence.push(evidence("swc-wasm-web", "transform", false, transformStarted, "SWC transform failed."));
    return {
      ok: false,
      diagnostics: [swcDiagnostic("transform-failed", filename, "SWC failed to transform TSX source.", error)],
      evidence: collectedEvidence
    };
  }
}

function ensureSwcInitialized(collectedEvidence: ToolchainEvidence[]): void {
  if (initialized) {
    collectedEvidence.push({ tool: "swc-wasm-web", stage: "import", ok: true, durationMs: 0, detail: "SWC wasm-web already initialized." });
    return;
  }

  const started = performance.now();
  try {
    initSync({ module: swcWasmModule });
    initialized = true;
    collectedEvidence.push(evidence("swc-wasm-web", "import", true, started, "Initialized SWC from a Worker WebAssembly.Module."));
  } catch (error) {
    collectedEvidence.push(evidence("swc-wasm-web", "import", false, started, "SWC wasm-web initialization failed."));
    throw error;
  }
}

function swcTransformOptions(filename: string): Options {
  return {
    filename,
    swcrc: false,
    configFile: false,
    jsc: {
      parser: { syntax: "typescript", tsx: true },
      target: "es2022",
      transform: { react: { runtime: "automatic" } }
    },
    module: { type: "es6" },
    sourceMaps: false
  };
}

function swcDiagnostic(
  kind: ToolchainDiagnostic["kind"],
  filename: string,
  fallbackMessage: string,
  error: unknown
): ToolchainDiagnostic {
  const cause = stringifyCause(error);
  const location = parseSwcLocation(cause);
  return {
    tool: "swc-wasm-web",
    kind,
    severity: "error",
    message: error instanceof Error ? error.message : fallbackMessage,
    file: filename,
    line: location?.line,
    column: location?.column,
    cause
  };
}

function parseSwcLocation(cause: string | undefined): { line: number; column: number } | undefined {
  if (!cause) return undefined;
  const match = /:(\d+):(\d+)/.exec(cause) ?? /line\s+(\d+),?\s+column\s+(\d+)/i.exec(cause);
  if (!match) return undefined;
  return { line: Number(match[1]), column: Number(match[2]) };
}
