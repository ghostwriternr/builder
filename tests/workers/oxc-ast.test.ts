import { describe, expect, test } from "vitest";

import { parseReactTsxAst } from "../../src/index";

describe("parseReactTsxAst", () => {
  test("materializes a full TSX Program AST inside workerd", async () => {
    const result = await parseReactTsxAst("src/component.tsx", `
      type Props = { label: string };
      export function Component(props: Props) {
        return <section data-kind="demo">{props.label}</section>;
      }
    `);

    expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
    if (!result.ok) return;

    expect(result.rawProgramLength).toBeGreaterThan(1000);
    expect(result.ast.type).toBe("Program");
    expect(result.ast.sourceType).toBe("module");
    expect(result.ast.body.some((node) => (node as { type?: string }).type === "TSTypeAliasDeclaration")).toBe(true);
    expect(JSON.stringify(result.ast)).toContain("JSXElement");
  });

  test("returns structured parse diagnostics", async () => {
    const result = await parseReactTsxAst("src/broken.tsx", `export const broken = <div>;`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      tool: "oxc-parser",
      kind: "parse-failed",
      severity: "error",
      file: "src/broken.tsx",
    });
  });
});
