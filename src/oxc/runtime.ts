export interface RawOxcParseResult {
  errors?: unknown;
  program?: string;
}

export interface RawOxcParser {
  parseSync?: (filename: string, source: string, options?: unknown) => RawOxcParseResult;
}

export interface RawOxcTransformResult {
  code?: string;
  errors?: unknown;
  map?: unknown;
}

export interface RawOxcTransformer {
  transformSync?: (filename: string, source: string, options?: unknown) => RawOxcTransformResult;
  transform?: (filename: string, source: string, options?: unknown) => RawOxcTransformResult | Promise<RawOxcTransformResult>;
}

let parserPromise: Promise<RawOxcParser> | undefined;
let transformerPromise: Promise<RawOxcTransformer> | undefined;

export function getOxcParser(): Promise<RawOxcParser> {
  parserPromise ??= instantiateOxcNapiModule<RawOxcParser>("parser");
  return parserPromise;
}

export function getOxcTransformer(): Promise<RawOxcTransformer> {
  transformerPromise ??= instantiateOxcNapiModule<RawOxcTransformer>("transform");
  return transformerPromise;
}

async function instantiateOxcNapiModule<T>(kind: "parser" | "transform"): Promise<T> {
  const [workerRuntime, kernel, wasiModule, wasmBytes] = await Promise.all([
    import("@alexbruf/wasmkernel/worker"),
    import("@alexbruf/wasmkernel/wasmkernel.wasm"),
    import("@bjorn3/browser_wasi_shim"),
    kind === "parser"
      ? import("../wasm/oxc-parser.wasm.bin")
      : import("../wasm/oxc-transform.wasm.bin"),
  ]);

  const wasi = new wasiModule.WASI([], [], [], { debug: false });
  const { napiModule } = await workerRuntime.instantiateNapiModule(new Uint8Array(wasmBytes.default), {
    wasi,
    kernelModule: kernel.default,
    unshareMemory: true,
  });
  return napiModule.exports as T;
}
