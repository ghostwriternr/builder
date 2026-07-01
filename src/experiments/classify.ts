import { diagnostic, evidence } from "../diagnostics";
import type { SourceCheckResult, ToolName, ToolchainDiagnostic, ToolchainEvidence } from "../types";

const UNSUPPORTED: Array<{ tool: ToolName; message: string }> = [
  {
    tool: "vite",
    message:
      "Vite is a Node build/dev-server API in this use case. Its package export points at dist/node/index.js and is not a workerd runtime compiler."
  },
  {
    tool: "rolldown-vite",
    message:
      "rolldown-vite is a Vite distribution for Node build/dev-server workflows; it is not a workerd runtime bundler API."
  },
  {
    tool: "oxlint",
    message:
      "Oxlint does not expose a useful workerd lint API here; the package is CLI/native-oriented."
  },
  {
    tool: "oxfmt",
    message:
      "Oxfmt formatting is native/NAPI-oriented and is not a workerd runtime formatting path for this spike."
  }
];

export async function describeUnsupportedDevelopmentTools(): Promise<SourceCheckResult> {
  const diagnostics: ToolchainDiagnostic[] = [];
  const events: ToolchainEvidence[] = [];
  for (const item of UNSUPPORTED) {
    const started = performance.now();
    events.push(evidence(item.tool, "import", false, started, "intentionally not imported in workerd path"));
    diagnostics.push(diagnostic(item.tool, "not-applicable", item.message));
  }
  return { ok: false, diagnostics, evidence: events };
}
