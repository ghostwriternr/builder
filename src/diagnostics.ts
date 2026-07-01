import type { ToolName, ToolchainDiagnostic, ToolchainEvidence } from "./types";

export function diagnostic(
  tool: ToolName,
  kind: ToolchainDiagnostic["kind"],
  message: string,
  cause?: unknown
): ToolchainDiagnostic {
  return {
    tool,
    kind,
    severity: kind === "warning" || kind === "not-applicable" ? "warning" : "error",
    message,
    cause: stringifyCause(cause)
  };
}

export function evidence(
  tool: ToolName,
  stage: ToolchainEvidence["stage"],
  ok: boolean,
  started: number,
  detail?: string
): ToolchainEvidence {
  return { tool, stage, ok, durationMs: Math.round(performance.now() - started), detail };
}

export function stringifyCause(cause: unknown): string | undefined {
  if (cause === undefined) return undefined;
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

export function isProbablyWorkerd(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}
