import { describe, expect, it } from "vitest";
import { WASI } from "@bjorn3/browser_wasi_shim";
import { instantiateNapiModule } from "@alexbruf/wasmkernel/worker";
import wasmkernelModule from "@alexbruf/wasmkernel/wasmkernel.wasm";
import oxcParserBytes from "../../../src/wasm/oxc-parser.wasm.bin";

const TSX_AST_SOURCE = `import React from "react";

export const count: number = 1;
export default function Widget() {
  return <section data-count={count}>Hello</section>;
}
`;

type RawOxcParser = {
  parseSync(filename: string, source: string, options?: unknown): any;
};

let parserPromise: Promise<RawOxcParser> | undefined;

async function getRawParser(): Promise<RawOxcParser> {
  parserPromise ??= (async () => {
    const wasi = new WASI([], [], [], { debug: false });
    const { napiModule } = await instantiateNapiModule(new Uint8Array(oxcParserBytes), {
      wasi,
      kernelModule: wasmkernelModule,
      unshareMemory: true
    });
    return napiModule.exports as RawOxcParser;
  })();
  return parserPromise;
}

function isProgramAst(value: unknown): value is { type: "Program"; sourceType?: string } {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "Program";
}

function parseRawProgramJson(programJson: string): { node?: { type?: string; sourceType?: string; body?: unknown[] }; fixes?: unknown[] } {
  return JSON.parse(programJson) as { node?: { type?: string; sourceType?: string; body?: unknown[] }; fixes?: unknown[] };
}

function collectArrayLike(value: unknown): unknown[] {
  if (typeof value !== "object" || value === null) return [];

  if (Symbol.iterator in value && typeof value[Symbol.iterator] === "function") {
    const iterated = Array.from(value as Iterable<unknown>);
    if (iterated.length > 0) return iterated;
  }

  const items: unknown[] = [];
  const indexable = value as Record<number, unknown>;
  for (let index = 0; index < 1000; index++) {
    const item = indexable[index];
    if (item === undefined) break;
    items.push(item);
  }
  return items;
}

describe("Oxc parser full AST access through wasmkernel in workerd", () => {
  it("exposes module metadata and a one-shot serialized TSX Program AST", async () => {
    const parser = await getRawParser();
    const result = parser.parseSync("component.tsx", TSX_AST_SOURCE, {
      lang: "tsx",
      sourceType: "module",
      astType: "ts",
      range: true
    });

    const staticImports = collectArrayLike(result.module.staticImports) as Array<{ moduleRequest?: { value?: string } }>;
    const programJson = result.program;
    const secondProgramRead = result.program;
    const parsed = parseRawProgramJson(programJson);

    expect(result.errors).toEqual([]);
    expect(staticImports).toHaveLength(1);
    expect(staticImports[0]?.moduleRequest?.value).toBe("react");
    expect(isProgramAst(programJson)).toBe(false);
    expect(typeof programJson).toBe("string");
    expect(programJson.length).toBeGreaterThan(0);
    expect(secondProgramRead).toBe("");
    expect(parsed.node?.type).toBe("Program");
    expect(parsed.node?.sourceType).toBe("module");
    expect(parsed.node?.body?.length).toBeGreaterThan(0);
    expect(Array.isArray(parsed.fixes)).toBe(true);
  });

  it("returns a non-empty one-shot Program JSON string for the tested parser option matrix", async () => {
    const parser = await getRawParser();
    const optionMatrix = [
      undefined,
      { lang: "tsx", sourceType: "module" },
      { lang: "tsx", sourceType: "module", astType: "ts" },
      { lang: "tsx", sourceType: "module", astType: "ts", range: true },
      { lang: "tsx", sourceType: "module", astType: "ts", preserveParens: true },
      { lang: "tsx", sourceType: "module", astType: "ts", showSemanticErrors: true }
    ];

    const summaries = optionMatrix.map((options) => {
      const result = parser.parseSync("component.tsx", TSX_AST_SOURCE, options);
      const programJson = result.program;
      const secondProgramRead = result.program;
      const parsed = parseRawProgramJson(programJson);
      return {
        options,
        errors: collectArrayLike(result.errors).length,
        staticImports: collectArrayLike(result.module?.staticImports).length,
        programType: typeof programJson,
        programLength: typeof programJson === "string" ? programJson.length : undefined,
        secondProgramRead,
        isProgramAst: isProgramAst(programJson),
        nodeType: parsed.node?.type
      };
    });

    for (const summary of summaries) {
      expect(summary.errors).toBe(0);
      expect(summary.staticImports).toBe(1);
      expect(summary.programType).toBe("string");
      expect(summary.programLength).toBeGreaterThan(0);
      expect(summary.secondProgramRead).toBe("");
      expect(summary.isProgramAst).toBe(false);
      expect(summary.nodeType).toBe("Program");
    }
  });
});
