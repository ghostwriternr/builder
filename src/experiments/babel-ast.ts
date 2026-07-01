import { parse, type ParseResult, type ParserOptions } from "@babel/parser";
import type { File } from "@babel/types";
import { evidence, stringifyCause } from "../diagnostics";
import type { ToolchainDiagnostic, ToolchainEvidence } from "../types";

const REACT_TSX_PLUGINS = ["typescript", "jsx"] satisfies ParserOptions["plugins"];

export type ExperimentalReactTsxAstParseResult =
  | {
      ok: true;
      ast: ParseResult<File>;
      diagnostics: [];
      evidence: ToolchainEvidence[];
    }
  | {
      ok: false;
      ast?: undefined;
      diagnostics: ToolchainDiagnostic[];
      evidence: ToolchainEvidence[];
    };

/**
 * Experimental full-AST helper for workerd-hosted structural TSX tooling.
 * The AST flavor is Babel's AST, not Oxc's AST or TypeScript's AST.
 *
 * This intentionally stays out of the Dynamic Worker compiler's public API
 * while we validate real product needs around traversal, ranges, comments,
 * and rewrite ergonomics.
 */
export function experimentalParseReactTsxAst(
  source: string,
  filename = "input.tsx"
): ExperimentalReactTsxAstParseResult {
  const started = performance.now();

  try {
    const ast = parse(source, {
      sourceType: "module",
      sourceFilename: filename,
      plugins: REACT_TSX_PLUGINS,
      attachComment: true,
      tokens: true,
      ranges: true,
      createImportExpressions: true,
      errorRecovery: false
    });

    return {
      ok: true,
      ast,
      diagnostics: [],
      evidence: [evidence("babel-parser", "parse", true, started, "Parsed TSX into a Babel File AST.")]
    };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [babelParseDiagnostic(filename, error)],
      evidence: [evidence("babel-parser", "parse", false, started, "Babel parser rejected TSX source.")]
    };
  }
}

function babelParseDiagnostic(filename: string, error: unknown): ToolchainDiagnostic {
  const loc = typeof error === "object" && error !== null && "loc" in error
    ? (error as { loc?: { line?: number; column?: number } }).loc
    : undefined;

  return {
    tool: "babel-parser",
    kind: "parse-failed",
    severity: "error",
    message: error instanceof Error ? error.message : "Babel parser failed to parse TSX source.",
    file: filename,
    line: loc?.line,
    column: loc?.column,
    cause: stringifyCause(error)
  };
}
