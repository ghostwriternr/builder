import analyzeModule from "./wasm/analyze.wasm";
import { instantiateAbiModule, type AnalyzeAbiExports } from "./abi/instance.ts";
import { AbiMemoryScope } from "./abi/memory.ts";
import { readJsonResult } from "./abi/result.ts";
import { byteOffsetToStringOffset } from "./abi/utf8.ts";
import {
  sourceLocationAtOffset,
  sourceSpan,
  runtimeDiagnostic,
  stringifyCause,
} from "./diagnostics.ts";
import type { AnalyzeInput, AnalyzeOutput, OxcDiagnostic, OxcResult } from "./types.ts";

interface AnalyzeSuccessPayload extends AnalyzeOutput {
  abiVersion: number;
  kind: "analyze";
  ok: true;
  diagnostics: [];
}

interface AnalyzeFailurePayload {
  abiVersion: number;
  kind: "analyze";
  ok: false;
  diagnostics: Array<{
    severity: "error" | "warning";
    message: string;
    file: string;
    start?: number;
    end?: number;
  }>;
}

type AnalyzePayload = AnalyzeSuccessPayload | AnalyzeFailurePayload;

export interface AnalyzeRuntime {
  analyze(input: AnalyzeInput): OxcResult<AnalyzeOutput>;
}

export function createAnalyzeRuntime(): AnalyzeRuntime {
  let exports = instantiateAbiModule<AnalyzeAbiExports>(analyzeModule, "Oxc analyzer");

  return {
    analyze(input: AnalyzeInput): OxcResult<AnalyzeOutput> {
      try {
        return analyzeWithExports(exports, input);
      } catch (error) {
        try {
          exports = instantiateAbiModule<AnalyzeAbiExports>(analyzeModule, "Oxc analyzer");
        } catch {
          // Preserve original error
        }
        return {
          ok: false,
          diagnostics: [runtimeDiagnostic("runtime", "Oxc analyzer runtime failed.", error)],
        };
      }
    },
  };
}

function analyzeWithExports(
  exports: AnalyzeAbiExports,
  input: AnalyzeInput,
): OxcResult<AnalyzeOutput> {
  const scope = new AbiMemoryScope(exports);
  try {
    const filename = scope.writeString(input.filename);
    const source = scope.writeString(input.source);
    const optionsJson = JSON.stringify({ lang: input.lang, sourceType: input.sourceType });
    const options = scope.writeString(optionsJson);

    const handle = exports.analyze(
      filename.ptr,
      filename.len,
      source.ptr,
      source.len,
      options.ptr,
      options.len,
    );
    const payload = readJsonResult<AnalyzePayload>(exports, handle);

    const diagnostics = collectArrayLike(payload.diagnostics).map((diagnostic) =>
      normalizeDiagnostic(input, diagnostic),
    );

    if (!payload.ok) {
      return {
        ok: false,
        diagnostics:
          diagnostics.length > 0
            ? diagnostics
            : [
                {
                  phase: "parse",
                  severity: "error",
                  message: "Oxc analyzer failed without structured diagnostics.",
                  filename: input.filename,
                },
              ],
      };
    }

    const value: AnalyzeOutput = {
      scopes: payload.scopes,
      bindings: payload.bindings,
      references: payload.references,
      unresolved: payload.unresolved,
      imports: payload.imports,
      exports: payload.exports,
      jsxTags: payload.jsxTags,
    };
    return { ok: true, value, diagnostics };
  } finally {
    scope.dispose();
  }
}

function normalizeDiagnostic(input: AnalyzeInput, value: unknown): OxcDiagnostic {
  const direct = value as {
    severity?: unknown;
    message?: unknown;
    file?: unknown;
    start?: unknown;
    end?: unknown;
  };
  const start =
    typeof direct.start === "number"
      ? byteOffsetToStringOffset(input.source, direct.start)
      : undefined;
  const end =
    typeof direct.end === "number" ? byteOffsetToStringOffset(input.source, direct.end) : undefined;
  const location = start === undefined ? undefined : sourceLocationAtOffset(input.source, start);
  return {
    phase: "parse",
    severity: direct.severity === "warning" ? "warning" : "error",
    message: typeof direct.message === "string" ? direct.message : String(value),
    filename:
      typeof direct.file === "string" && direct.file.length > 0 ? direct.file : input.filename,
    location,
    span:
      start !== undefined && end !== undefined ? sourceSpan(input.source, start, end) : undefined,
    cause: stringifyCause(value),
  };
}

function collectArrayLike(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
