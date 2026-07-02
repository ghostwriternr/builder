import { describe, expect, test } from "vitest";

import { diagnostic, diagnosticAtSourceOffset, sourceLocationAtOffset, sourceOffsetAtLocation } from "../../src/diagnostics";

describe("diagnostics", () => {
  test("maps source offsets to one-based locations and back", () => {
    const source = "first\nsecond line\nthird";

    expect(sourceLocationAtOffset(source, 0)).toEqual({ line: 1, column: 1 });
    expect(sourceLocationAtOffset(source, 8)).toEqual({ line: 2, column: 3 });
    expect(sourceOffsetAtLocation(source, { line: 2, column: 3 })).toBe(8);
    expect(sourceOffsetAtLocation(source, { line: 99, column: 99 })).toBe(source.length);
  });

  test("creates source-aware diagnostics with clamped spans", () => {
    const source = "const value = missing;";

    expect(diagnosticAtSourceOffset("oxc-parser", "parse-failed", "Unexpected token", {
      source,
      offset: 14,
      end: 21,
      file: "src/input.tsx",
    })).toMatchObject({
      tool: "oxc-parser",
      kind: "parse-failed",
      severity: "error",
      message: "Unexpected token",
      file: "src/input.tsx",
      line: 1,
      column: 15,
      span: { start: 14, end: 21 },
    });
  });

  test("stringifies causes without throwing", () => {
    expect(diagnostic("internal", "transform-failed", "Failed", new Error("boom"))).toMatchObject({
      cause: "Error: boom",
    });
  });
});
