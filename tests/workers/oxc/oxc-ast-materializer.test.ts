import { describe, expect, it } from "vitest";
import { experimentalParseReactTsxAstWithOxc } from "../../../src/oxc/ast";

const TSX_SOURCE = `import React from "react";

type Props<T extends string> = { title: T };

export const Widget = <T extends string,>({ title }: Props<T>) => {
  return <section data-title={title}>{title}</section>;
};
`;

const FIXTURE_SOURCE = `export const big = 123n;
export const re = /widget+/gi;
`;

function collectNodeTypes(node: unknown, types = new Set<string>()): Set<string> {
  if (typeof node !== "object" || node === null) return types;
  if ("type" in node && typeof node.type === "string") types.add(node.type);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) collectNodeTypes(item, types);
    } else {
      collectNodeTypes(value, types);
    }
  }
  return types;
}

function collectLiterals(node: unknown, literals: Array<{ bigint?: string; regex?: unknown; value?: unknown }> = []) {
  if (typeof node !== "object" || node === null) return literals;
  if ("type" in node && node.type === "Literal") literals.push(node as { bigint?: string; regex?: unknown; value?: unknown });
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) collectLiterals(item, literals);
    } else {
      collectLiterals(value, literals);
    }
  }
  return literals;
}

describe("experimental Oxc TSX AST materializer in workerd", () => {
  it("materializes the one-shot raw Oxc program JSON into a full Program AST", async () => {
    const result = await experimentalParseReactTsxAstWithOxc(TSX_SOURCE, "component.tsx", { range: true });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join("\n"));

    const types = collectNodeTypes(result.ast);
    expect(result.ast.type).toBe("Program");
    expect(result.ast.sourceType).toBe("module");
    expect(result.ast.body.length).toBeGreaterThan(0);
    expect(result.rawProgramLength).toBeGreaterThan(0);
    expect(types).toContain("TSTypeAliasDeclaration");
    expect(types).toContain("TSTypeParameterDeclaration");
    expect(types).toContain("JSXElement");
    expect(types).toContain("JSXAttribute");
    expect(result.diagnostics).toEqual([]);
    expect(result.evidence.some((event) => event.tool === "oxc-parser" && event.stage === "parse" && event.ok)).toBe(true);
  });

  it("applies Oxc JSON fixes for BigInt and RegExp literal values", async () => {
    const result = await experimentalParseReactTsxAstWithOxc(FIXTURE_SOURCE, "fixes.ts", { astType: "ts" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join("\n"));

    const literals = collectLiterals(result.ast);
    const bigIntLiteral = literals.find((literal) => literal.bigint === "123");
    const regexLiteral = literals.find((literal) => typeof literal.regex === "object" && literal.regex !== null);
    expect(bigIntLiteral?.value).toBe(123n);
    expect(regexLiteral?.value).toBeInstanceOf(RegExp);
    expect(String(regexLiteral?.value)).toBe("/widget+/gi");
  });

  it("returns structured diagnostics instead of throwing on invalid TSX", async () => {
    const result = await experimentalParseReactTsxAstWithOxc("export const Broken = <div>;", "broken.tsx");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid source to fail");

    expect(result.ast).toBeUndefined();
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]).toMatchObject({
      tool: "oxc-parser",
      kind: "parse-failed",
      severity: "error",
      file: "broken.tsx"
    });
    expect(result.evidence.some((event) => event.tool === "oxc-parser" && event.stage === "parse" && !event.ok)).toBe(true);
  });
});
