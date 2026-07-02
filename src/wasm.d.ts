declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}

declare module "*.wasm.bin" {
  const bytes: ArrayBuffer;
  export default bytes;
}

declare module "@alexbruf/wasmkernel/worker" {
  export function instantiateNapiModule(
    bytes: Uint8Array,
    options: { wasi: unknown; kernelModule: WebAssembly.Module; unshareMemory?: boolean },
  ): Promise<{ napiModule: { exports: unknown } }>;
}
