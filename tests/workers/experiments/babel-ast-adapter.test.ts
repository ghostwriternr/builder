import { describe, expect, it } from "vitest";
import { experimentalParseReactTsxAst } from "../../../src/experiments/babel-ast";

const SOURCE_WITH_COMMENTS = `// lead comment
import type { ReactNode } from "react";

type Props<T extends string> = {
  title: T;
  children?: ReactNode;
};

export function Widget<T extends string>({ title }: Props<T>) {
  return <section data-title={title}>{title}</section>;
}
`;

function collectNodeTypes(node: unknown, types = new Set<string>()): Set<string> {
  if (typeof node !== "object" || node === null) return types;
  if ("type" in node && typeof node.type === "string") types.add(node.type);

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) collectNodeTypes(item, types);
    } else if (typeof value === "object" && value !== null) {
      collectNodeTypes(value, types);
    }
  }

  return types;
}

describe("experimental Babel TSX AST adapter", () => {
  it("returns a full Babel AST with source positions, ranges, comments, and tokens", () => {
    const result = experimentalParseReactTsxAst(SOURCE_WITH_COMMENTS, "component.tsx");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join("\n"));

    const types = collectNodeTypes(result.ast);
    expect(result.ast.type).toBe("File");
    expect(result.ast.program.type).toBe("Program");
    expect(result.ast.program.sourceType).toBe("module");
    expect(types).toContain("TSTypeParameterDeclaration");
    expect(types).toContain("TSTypeAnnotation");
    expect(types).toContain("JSXElement");
    expect(types).toContain("JSXAttribute");

    expect(result.ast.start).toBe(0);
    expect(result.ast.end).toBe(SOURCE_WITH_COMMENTS.length);
    expect(result.ast.loc?.start.line).toBe(1);
    expect(result.ast.range).toEqual([0, SOURCE_WITH_COMMENTS.length]);
    expect(result.ast.comments?.[0]?.value).toContain("lead comment");
    expect(result.ast.tokens?.length).toBeGreaterThan(0);

    expect(result.diagnostics).toEqual([]);
    expect(result.evidence).toMatchObject([{ tool: "babel-parser", stage: "parse", ok: true }]);
  });

  it("returns structured diagnostics instead of throwing on invalid TSX", () => {
    const result = experimentalParseReactTsxAst("export const Broken = <div>;", "broken.tsx");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid source to fail");

    expect(result.ast).toBeUndefined();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      tool: "babel-parser",
      kind: "parse-failed",
      severity: "error",
      file: "broken.tsx"
    });
    expect(result.diagnostics[0]?.line).toBeGreaterThan(0);
    expect(result.diagnostics[0]?.column).toBeGreaterThanOrEqual(0);
    expect(result.evidence).toMatchObject([{ tool: "babel-parser", stage: "parse", ok: false }]);
  });
});
