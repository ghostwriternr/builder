import directTransformModule from "../wasm/oxc-direct-transform.wasm";

const ABI_VERSION = 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface DirectTransformDiagnostic {
  severity?: unknown;
  message?: unknown;
  file?: unknown;
  start?: unknown;
  end?: unknown;
}

export interface DirectTransformPayload {
  abiVersion?: unknown;
  kind?: unknown;
  ok?: unknown;
  code?: unknown;
  map?: unknown;
  diagnostics?: unknown;
}

interface DirectTransformExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  abi_version: () => number;
  alloc: (len: number) => number;
  free: (ptr: number, len: number) => void;
  transform: (
    filenamePtr: number,
    filenameLen: number,
    sourcePtr: number,
    sourceLen: number,
    optionsPtr: number,
    optionsLen: number,
  ) => number;
  result_ptr: (handle: number) => number;
  result_len: (handle: number) => number;
  free_result: (handle: number) => void;
}

let transformerPromise: Promise<DirectTransformExports> | undefined;

export async function getDirectTransformer(): Promise<DirectTransformExports> {
  transformerPromise ??= instantiateDirectTransformer();
  return transformerPromise;
}

export async function transformWithDirectTransformer(filename: string, source: string, options: unknown): Promise<DirectTransformPayload> {
  const transformer = await getDirectTransformer();
  const allocations: Array<{ ptr: number; len: number }> = [];
  let handle = 0;

  try {
    const filenameBytes = trackAllocation(allocations, writeBytes(transformer, filename));
    const sourceBytes = trackAllocation(allocations, writeBytes(transformer, source));
    const optionsJson = JSON.stringify(options ?? {});
    if (optionsJson === undefined) throw new Error("Oxc direct transform options must be JSON-serializable.");
    const optionsBytes = trackAllocation(allocations, writeBytes(transformer, optionsJson));

    handle = transformer.transform(
      filenameBytes.ptr,
      filenameBytes.len,
      sourceBytes.ptr,
      sourceBytes.len,
      optionsBytes.ptr,
      optionsBytes.len,
    );

    const resultPtr = transformer.result_ptr(handle);
    const resultLen = transformer.result_len(handle);
    if (resultPtr === 0 || resultLen === 0) {
      throw new Error("Oxc direct transform returned an empty result handle.");
    }

    const resultBytes = new Uint8Array(transformer.memory.buffer, resultPtr, resultLen);
    return JSON.parse(decoder.decode(resultBytes)) as DirectTransformPayload;
  } catch (error) {
    // A WebAssembly trap can leave an instance in an unknown state. Recreate the
    // direct transformer on the next call rather than reusing a potentially
    // poisoned instance.
    transformerPromise = undefined;
    throw error;
  } finally {
    if (handle !== 0) transformer.free_result(handle);
    for (let index = allocations.length - 1; index >= 0; index -= 1) {
      freeBytes(transformer, allocations[index]!);
    }
  }
}

async function instantiateDirectTransformer(): Promise<DirectTransformExports> {
  const instance = await WebAssembly.instantiate(directTransformModule, {});
  const exports = instance.exports as DirectTransformExports;
  if (exports.abi_version() !== ABI_VERSION) {
    throw new Error(`Unsupported Oxc direct transform ABI version ${exports.abi_version()}.`);
  }
  return exports;
}

function trackAllocation(
  allocations: Array<{ ptr: number; len: number }>,
  allocation: { ptr: number; len: number },
): { ptr: number; len: number } {
  if (allocation.ptr !== 0 && allocation.len > 0) allocations.push(allocation);
  return allocation;
}

function writeBytes(transformer: DirectTransformExports, value: string): { ptr: number; len: number } {
  const bytes = encoder.encode(value);
  if (bytes.length === 0) return { ptr: 0, len: 0 };

  const ptr = transformer.alloc(bytes.length);
  if (ptr === 0) throw new Error(`Oxc direct transform could not allocate ${bytes.length} bytes.`);
  new Uint8Array(transformer.memory.buffer, ptr, bytes.length).set(bytes);
  return { ptr, len: bytes.length };
}

function freeBytes(transformer: DirectTransformExports, allocation: { ptr: number; len: number }): void {
  if (allocation.ptr !== 0 && allocation.len > 0) transformer.free(allocation.ptr, allocation.len);
}
