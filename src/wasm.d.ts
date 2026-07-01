declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}

declare module "*.wasm?module" {
  const module: WebAssembly.Module;
  export default module;
}

declare module "*.wasm.bin" {
  const bytes: ArrayBuffer;
  export default bytes;
}

declare module "*?raw" {
  const source: string;
  export default source;
}

declare module "@alexbruf/wasmkernel/worker" {
  export function instantiateNapiModule(
    guestBytes: Uint8Array,
    options: {
      wasi: unknown;
      kernelModule?: WebAssembly.Module;
      kernelBytes?: Uint8Array;
      unshareMemory?: boolean;
      minInitialPages?: number;
      appHeapSize?: number;
      sharedMemMaxPages?: number;
      memoryBackend?: unknown;
      hotWindowPages?: number;
      slotCyclingPages?: number;
    }
  ): Promise<{ napiModule: { exports: Record<string, unknown> } }>;
}
