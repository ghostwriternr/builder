import { describe, expect, it } from "vitest";
import { measureArtifact } from "./toolchain-footprint-helpers";

const ARTIFACTS = [
  { name: "babel-parser-js", path: "node_modules/@babel/parser/lib/index.js" },
  { name: "swc-wasm-web", path: "node_modules/@swc/wasm-web/wasm_bg.wasm" },
  { name: "oxc-parser-wasi", path: "src/wasm/oxc-parser.wasm.bin" },
  { name: "oxc-transform-wasi", path: "src/wasm/oxc-transform.wasm.bin" },
  { name: "wasmkernel", path: "node_modules/@alexbruf/wasmkernel/wasmkernel.wasm" }
] as const;

function assertFiniteNonNegative(value: number): void {
  expect(Number.isFinite(value)).toBe(true);
  expect(value).toBeGreaterThanOrEqual(0);
}

describe("toolchain artifact footprint", () => {
  it("records raw and gzip sizes for concrete parser/transform artifacts", async () => {
    const measurements = await Promise.all(ARTIFACTS.map((artifact) => measureArtifact(artifact.name, artifact.path)));

    for (const measurement of measurements) {
      assertFiniteNonNegative(measurement.rawBytes);
      assertFiniteNonNegative(measurement.gzipBytes);
    }

    const byName = Object.fromEntries(measurements.map((measurement) => [measurement.name, measurement]));
    const totals = {
      babelParserRawBytes: byName["babel-parser-js"]?.rawBytes,
      babelParserGzipBytes: byName["babel-parser-js"]?.gzipBytes,
      swcWasmRawBytes: byName["swc-wasm-web"]?.rawBytes,
      swcWasmGzipBytes: byName["swc-wasm-web"]?.gzipBytes,
      oxcWasmkernelRawBytes:
        (byName["oxc-parser-wasi"]?.rawBytes ?? 0) +
        (byName["oxc-transform-wasi"]?.rawBytes ?? 0) +
        (byName.wasmkernel?.rawBytes ?? 0),
      oxcWasmkernelGzipBytes:
        (byName["oxc-parser-wasi"]?.gzipBytes ?? 0) +
        (byName["oxc-transform-wasi"]?.gzipBytes ?? 0) +
        (byName.wasmkernel?.gzipBytes ?? 0)
    };

    for (const value of Object.values(totals)) assertFiniteNonNegative(value ?? 0);

    console.log("[toolchain-footprint]", JSON.stringify({ artifacts: measurements, totals }));
  });
});
