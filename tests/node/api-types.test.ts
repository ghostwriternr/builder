import { describe, expect, test, vi } from "vitest";

import type {
  AnalyzeInput,
  AnalyzeOutput,
  OxcResult,
  ReferenceFact,
  TransformInput,
} from "../../src/index";
import { createOxc, experimentalAnalyze } from "../../src/index";

vi.mock("../../src/abi/instance.ts", () => ({
  instantiateAbiModule: () => ({
    abi_version: () => 1,
    alloc: () => 0,
    free: () => {},
    result_ptr: () => 0,
    result_len: () => 0,
    free_result: () => {},
    parse: () => 0,
    transform: () => 0,
    analyze: () => 0,
    memory: {
      buffer: new ArrayBuffer(65536),
    },
  }),
}));

// @ts-expect-error CreateOxcOptions is intentionally not exported.
import type { CreateOxcOptions as MissingCreateOxcOptions } from "../../src/index";

type MissingOptionsExport = MissingCreateOxcOptions;

describe("public API types", () => {
  void (undefined as MissingOptionsExport | undefined);

  test("analyze types align with top-level and instance signatures", async () => {
    const input: AnalyzeInput = { filename: "src/app.tsx", source: "const x = 1;" };
    const topLevel: Promise<OxcResult<AnalyzeOutput>> = experimentalAnalyze(input);
    const instance = await createOxc();
    const syncResult: OxcResult<AnalyzeOutput> = instance.experimentalAnalyze(input);
    void topLevel;
    void syncResult;
    expect(true).toBe(true);
  });
  test("reference kind only exposes emitted analyzer variants", () => {
    const identifierReference: ReferenceFact = {
      id: 1,
      name: "value",
      kind: "identifier",
      flags: ["read"],
      scopeId: 0,
      span: { start: 0, end: 5 },
    };
    const typeReference: ReferenceFact = { ...identifierReference, kind: "type" };

    // @ts-expect-error analyzer does not currently emit distinct JSX reference kinds.
    const jsxReference: ReferenceFact = { ...identifierReference, kind: "jsx" };
    // @ts-expect-error analyzer does not currently emit namespace reference kinds.
    const namespaceReference: ReferenceFact = { ...identifierReference, kind: "namespace" };

    expect(identifierReference.kind).toBe("identifier");
    expect(typeReference.kind).toBe("type");
    expect(jsxReference.kind).toBe("jsx");
    expect(namespaceReference.kind).toBe("namespace");
  });

  test("transform target is a single string", () => {
    const valid: TransformInput = {
      filename: "src/input.ts",
      source: "export const value = 1;",
      target: "es2022",
    };

    expect(valid.target).toBe("es2022");

    const invalid: TransformInput = {
      filename: "src/input.ts",
      source: "export const value = 1;",
      // @ts-expect-error target arrays are intentionally not part of the public API.
      target: ["es2022", "es2020"],
    };

    expect(Array.isArray(invalid.target)).toBe(true);
  });

  test("createOxc has no options object", async () => {
    type CreateOxcArgs = Parameters<typeof createOxc>;

    const valid: CreateOxcArgs = [];
    expect(valid).toEqual([]);

    // @ts-expect-error createOxc does not accept placeholder options.
    const invalid: CreateOxcArgs = [{}];
    expect(invalid).toEqual([{}]);

    // @ts-expect-error exercise runtime behavior for untyped JavaScript callers.
    await expect(createOxc({})).rejects.toThrow("does not accept options");
  });
});
