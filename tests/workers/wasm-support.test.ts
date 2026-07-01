import { describe, expect, it } from "vitest";
import addWasm from "../../src/wasm/add.wasm";

describe("Workers WebAssembly support baseline", () => {
  it("imports .wasm as a precompiled WebAssembly.Module and instantiates it", async () => {
    expect(addWasm).toBeInstanceOf(WebAssembly.Module);

    const instance = await WebAssembly.instantiate(addWasm, {});
    const add = instance.exports.add;

    expect(typeof add).toBe("function");
    expect((add as (a: number, b: number) => number)(20, 22)).toBe(42);
  });

  it("does not allow compiling raw wasm bytes at runtime", async () => {
    const bytes = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ]);

    await expect(WebAssembly.compile(bytes)).rejects.toThrow();
  });
});
