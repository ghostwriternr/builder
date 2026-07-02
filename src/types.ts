export type ToolName = "oxc-parser" | "oxc-transform" | "worker-loader" | "internal";

export type DiagnosticKind =
  | "import-failed"
  | "parse-failed"
  | "transform-failed"
  | "loader-shape-failed"
  | "loaded-worker-failed"
  | "warning";

export interface SourceSpan {
  start: number;
  end: number;
}

export interface SourceLocation {
  line: number;
  column: number;
}

export interface ToolchainDiagnostic {
  tool: ToolName;
  kind: DiagnosticKind;
  severity: "error" | "warning";
  message: string;
  file?: string;
  line?: number;
  column?: number;
  span?: SourceSpan;
  cause?: string;
}

export interface ToolchainEvidence {
  tool: ToolName;
  stage: "import" | "parse" | "transform" | "loader-shape" | "worker-loader";
  ok: boolean;
  durationMs?: number;
  detail?: string;
}

export type DynamicWorkerObjectModuleContent =
  | { js: string }
  | { cjs: string }
  | { json: unknown }
  | { text: string }
  | { data: ArrayBuffer }
  | { wasm: ArrayBuffer };

export type DynamicWorkerModuleContent = string | DynamicWorkerObjectModuleContent;

export interface DynamicWorkerModules {
  mainModule: string;
  modules: Record<string, DynamicWorkerModuleContent>;
}

export interface ParseOptions {
  lang?: "js" | "jsx" | "ts" | "tsx";
  sourceType?: "module" | "script";
  astType?: "js" | "ts";
  [key: string]: unknown;
}

export type OxcProgramAst = { type: "Program"; sourceType?: string; body: unknown[]; [key: string]: unknown };

export type ParseAstResult =
  | { ok: true; ast: OxcProgramAst; rawProgramLength: number; diagnostics: []; evidence: ToolchainEvidence[] }
  | { ok: false; ast?: undefined; rawProgramLength?: number; diagnostics: ToolchainDiagnostic[]; evidence: ToolchainEvidence[] };

export interface TransformOptions {
  jsx?: {
    runtime?: "automatic" | "classic" | "preserve";
    importSource?: string;
  };
}

export type TransformResult =
  | { ok: true; code: string; map?: unknown; diagnostics: []; evidence: ToolchainEvidence[] }
  | { ok: false; code?: undefined; map?: undefined; diagnostics: ToolchainDiagnostic[]; evidence: ToolchainEvidence[] };

export interface ExplicitModuleCompileInput {
  entrypoint: string;
  modules: Record<string, DynamicWorkerModuleContent>;
  jsx?: TransformOptions["jsx"];
}

export interface DynamicWorkerBuildOutput {
  ok: boolean;
  mainModule?: string;
  modules?: Record<string, DynamicWorkerModuleContent>;
  diagnostics: ToolchainDiagnostic[];
  evidence: ToolchainEvidence[];
}

export interface DynamicWorkerLoaderDefinition extends DynamicWorkerModules {
  compatibilityDate: string;
  compatibilityFlags?: string[];
  globalOutbound?: Fetcher | null;
}

export interface WorkerLoaderBinding {
  get(id: string, factory: () => DynamicWorkerLoaderDefinition | Promise<DynamicWorkerLoaderDefinition>): LoadedDynamicWorker;
  load?(definition: DynamicWorkerLoaderDefinition): LoadedDynamicWorker;
}

export interface LoadedDynamicWorker {
  getEntrypoint(): { fetch(request: Request): Promise<Response> | Response };
}
