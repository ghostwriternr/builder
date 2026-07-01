import { describe, expect, it } from "vitest";
import { parse } from "@babel/parser";

const TSX_SOURCE = `import type { ReactNode } from "react";
import React from "react";

type Props<T extends string> = {
  title: T;
  children?: ReactNode;
};

export const Widget = <T extends string,>({ title }: Props<T>) => {
  const attrs = { role: "group" } satisfies Record<string, string>;
  return <section {...attrs} data-title={title}>{title}</section>;
};
`;

function walk(node: unknown, visit: (node: { type?: unknown }) => void): void {
  if (typeof node !== "object" || node === null) return;
  if ("type" in node) visit(node as { type?: unknown });

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, visit);
    } else if (typeof value === "object" && value !== null) {
      walk(value, visit);
    }
  }
}

function collectNodeTypes(ast: unknown): Set<string> {
  const types = new Set<string>();
  walk(ast, (node) => {
    if (typeof node.type === "string") types.add(node.type);
  });
  return types;
}

describe("Babel parser TSX AST in workerd", () => {
  it("parses TypeScript and JSX into a full Babel AST", () => {
    const ast = parse(TSX_SOURCE, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
      attachComment: false
    });
    const types = collectNodeTypes(ast);

    expect(ast.type).toBe("File");
    expect(ast.program.type).toBe("Program");
    expect(ast.program.sourceType).toBe("module");
    expect(ast.program.body).toHaveLength(4);
    expect(types).toContain("ImportDeclaration");
    expect(types).toContain("TSTypeAnnotation");
    expect(types).toContain("TSTypeParameterDeclaration");
    expect(types).toContain("TSSatisfiesExpression");
    expect(types).toContain("JSXElement");
    expect(types).toContain("JSXAttribute");
  });

  it("requires both TypeScript and JSX parser plugins for TSX", () => {
    expect(() => parse(TSX_SOURCE, { sourceType: "module", plugins: ["typescript"] })).toThrow();
    expect(() => parse(TSX_SOURCE, { sourceType: "module", plugins: ["jsx"] })).toThrow();
  });
});
