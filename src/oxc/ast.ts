import { WASI } from "@bjorn3/browser_wasi_shim";
import { instantiateNapiModule } from "@alexbruf/wasmkernel/worker";
import wasmkernelModule from "@alexbruf/wasmkernel/wasmkernel.wasm";
import oxcParserBytes from "../wasm/oxc-parser.wasm.bin";
import { diagnostic, evidence, stringifyCause } from "../diagnostics";
import type { ToolchainDiagnostic, ToolchainEvidence } from "../types";

type RawOxcParseResult = {
  errors?: unknown;
  program?: string;
};

type RawOxcParser = {
  parseSync?: (filename: string, source: string, options?: unknown) => RawOxcParseResult;
};

type OxcJsonAstPayload = {
  node?: unknown;
  fixes?: Array<Array<string | number>>;
};

export type ExperimentalOxcAstParseResult =
  | {
      ok: true;
      ast: { type: "Program"; sourceType?: string; body: unknown[]; [key: string]: unknown };
      rawProgramLength: number;
      diagnostics: [];
      evidence: ToolchainEvidence[];
    }
  | {
      ok: false;
      ast?: undefined;
      rawProgramLength?: number;
      diagnostics: ToolchainDiagnostic[];
      evidence: ToolchainEvidence[];
    };

let parserPromise: Promise<RawOxcParser> | undefined;

/**
 * Experimental full-AST helper for the Oxc parser inside workerd.
 *
 * The raw Oxc N-API binding exposes `result.program` as a one-shot JSON
 * string. Read it exactly once, parse `{ node, fixes }`, and apply the same
 * BigInt/RegExp repair pass used by `oxc-parser/src-js/wrap.js`.
 */
export async function experimentalParseReactTsxAstWithOxc(
  source: string,
  filename = "input.tsx",
  options: Record<string, unknown> = {}
): Promise<ExperimentalOxcAstParseResult> {
  const events: ToolchainEvidence[] = [];
  const importStarted = performance.now();
  let parser: RawOxcParser;

  try {
    parser = await getWasmkernelOxcParser();
    events.push(evidence("oxc-parser", "import", true, importStarted, "instantiated oxc-parser wasm through @alexbruf/wasmkernel"));
  } catch (error) {
    events.push(evidence("oxc-parser", "import", false, importStarted));
    return {
      ok: false,
      diagnostics: [diagnostic("oxc-parser", "import-failed", "Could not initialize Oxc parser for AST materialization.", error)],
      evidence: events
    };
  }

  const parseStarted = performance.now();
  try {
    if (typeof parser.parseSync !== "function") throw new Error("Oxc parser export parseSync is unavailable.");
    const result = parser.parseSync(filename, source, parseOptions(filename, options));
    const errors = collectArrayLike(result.errors);

    // The raw getter is one-shot (`mem::take` in Oxc's Rust N-API type).
    // Accessing it more than once returns an empty string.
    const programJson = result.program;
    const rawProgramLength = typeof programJson === "string" ? new TextEncoder().encode(programJson).byteLength : 0;

    if (errors.length > 0) {
      events.push(evidence("oxc-parser", "parse", false, parseStarted, `${errors.length} parser errors`));
      return {
        ok: false,
        rawProgramLength,
        diagnostics: errors.map((error) => oxcParseDiagnostic(filename, error)),
        evidence: events
      };
    }

    if (typeof programJson !== "string" || programJson.length === 0) {
      events.push(evidence("oxc-parser", "parse", false, parseStarted, "Oxc parser returned an empty raw program string."));
      return {
        ok: false,
        rawProgramLength,
        diagnostics: [diagnostic("oxc-parser", "parse-failed", "Oxc parser returned an empty raw program string before AST materialization.")],
        evidence: events
      };
    }

    const ast = jsonParseOxcAst(programJson);
    if (!isProgramAst(ast)) {
      events.push(evidence("oxc-parser", "parse", false, parseStarted, "Oxc parser JSON did not materialize to a Program AST."));
      return {
        ok: false,
        rawProgramLength,
        diagnostics: [diagnostic("oxc-parser", "parse-failed", "Oxc parser JSON did not materialize to a Program AST.")],
        evidence: events
      };
    }

    events.push(evidence("oxc-parser", "parse", true, parseStarted, `materialized ${rawProgramLength} bytes of Oxc AST JSON`));
    return { ok: true, ast, rawProgramLength, diagnostics: [], evidence: events };
  } catch (error) {
    events.push(evidence("oxc-parser", "parse", false, parseStarted));
    return {
      ok: false,
      diagnostics: [diagnostic("oxc-parser", "parse-failed", "Oxc parser failed to materialize a TSX AST in workerd.", error)],
      evidence: events
    };
  }
}

function jsonParseOxcAst(programJson: string): unknown {
  const { node, fixes = [] } = JSON.parse(programJson) as OxcJsonAstPayload;
  if (node !== undefined) {
    for (const fixPath of fixes) applyFix(node, fixPath);
  }
  return node;
}

function applyFix(program: unknown, fixPath: Array<string | number>): void {
  let node: unknown = program;
  for (const key of fixPath) {
    if (typeof node !== "object" || node === null) return;
    node = (node as Record<string | number, unknown>)[key];
  }

  if (typeof node !== "object" || node === null) return;
  const literal = node as { bigint?: string; regex?: { pattern?: string; flags?: string }; value?: unknown };
  if (literal.bigint) {
    literal.value = BigInt(literal.bigint);
    return;
  }

  if (literal.regex) {
    try {
      literal.value = RegExp(literal.regex.pattern ?? "", literal.regex.flags ?? "");
    } catch {
      // Match Oxc's JS wrapper: leave value untouched for regex syntax that
      // this JavaScript runtime cannot construct.
    }
  }
}

function isProgramAst(value: unknown): value is { type: "Program"; sourceType?: string; body: unknown[]; [key: string]: unknown } {
  return typeof value === "object" && value !== null &&
    (value as { type?: unknown }).type === "Program" &&
    Array.isArray((value as { body?: unknown }).body);
}

function parseOptions(filename: string, options: Record<string, unknown>): Record<string, unknown> {
  return {
    lang: filename.endsWith(".tsx") ? "tsx" : filename.endsWith(".ts") || filename.endsWith(".mts") ? "ts" : filename.endsWith(".jsx") ? "jsx" : "js",
    sourceType: "module",
    astType: filename.endsWith(".ts") || filename.endsWith(".tsx") || filename.endsWith(".mts") ? "ts" : "js",
    ...options
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
  for (let index = 0; index < 1000; index++) {
    const item = indexable[index];
    if (item === undefined) break;
    items.push(item);
  }
  return items;
}

function oxcParseDiagnostic(filename: string, error: unknown): ToolchainDiagnostic {
  return {
    tool: "oxc-parser",
    kind: "parse-failed",
    severity: "error",
    message: String(error),
    file: filename,
    cause: stringifyCause(error)
  };
}

function getWasmkernelOxcParser(): Promise<RawOxcParser> {
  parserPromise ??= (async () => {
    const wasi = new WASI([], [], [], { debug: false });
    const { napiModule } = await instantiateNapiModule(new Uint8Array(oxcParserBytes), {
      wasi,
      kernelModule: wasmkernelModule,
      unshareMemory: true
    });
    return napiModule.exports as RawOxcParser;
  })();
  return parserPromise;
}
