import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("Oxc direct transform wasm artifact", () => {
  test("has a workerd-compatible zero-import ABI shape", () => {
    expect(existsSync("src/wasm/oxc-direct-transform.wasm")).toBe(true);
    const directTransformModule = new WebAssembly.Module(readFileSync("src/wasm/oxc-direct-transform.wasm"));

    expect(WebAssembly.Module.imports(directTransformModule)).toEqual([]);

    const exports = WebAssembly.Module.exports(directTransformModule).map((entry) => `${entry.kind}:${entry.name}`);
    expect(exports).toEqual(expect.arrayContaining([
      "memory:memory",
      "function:abi_version",
      "function:alloc",
      "function:free",
      "function:transform",
      "function:result_ptr",
      "function:result_len",
      "function:free_result",
    ]));
  });
});
