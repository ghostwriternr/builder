import { describe, expect, test } from "vitest";

import { experimentalTransformReactTsxDirect, transformReactTsx } from "../../src/index";

describe("experimentalTransformReactTsxDirect", () => {
  test("transforms TypeScript and TSX through direct wasm ABI inside workerd", async () => {
    const source = `
      type Props = { label: string };
      export function Component(props: Props) {
        return <span>{props.label}</span>;
      }
    `;

    const result = await experimentalTransformReactTsxDirect("src/component.tsx", source);

    expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
    if (!result.ok) return;
    expect(result.code).toContain("export function Component");
    expect(result.code).not.toContain("type Props");
    expect(result.code).toContain("react/jsx-runtime");
    expect(result.map).toBeDefined();
  });

  test("matches current bridge transform on key TSX landmarks", async () => {
    const source = `
      type Props = { label: string };
      export const element = <main data-kind="direct">ok</main>;
    `;
    const direct = await experimentalTransformReactTsxDirect("src/component.tsx", source);
    const bridge = await transformReactTsx("src/component.tsx", source);

    expect(direct.ok, JSON.stringify(direct.diagnostics, null, 2)).toBe(true);
    expect(bridge.ok, JSON.stringify(bridge.diagnostics, null, 2)).toBe(true);
    if (!direct.ok || !bridge.ok) return;

    expect(direct.code).toContain("react/jsx-runtime");
    expect(direct.code).toContain("jsx");
    expect(direct.code).not.toContain("type Props");
    expect(bridge.code).toContain("react/jsx-runtime");
  });

  test("accepts type-only TypeScript modules that erase to empty JavaScript", async () => {
    const result = await experimentalTransformReactTsxDirect("src/types.ts", `
      type Props = { label: string };
      interface ViewModel { count: number }
    `);

    expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
    if (!result.ok) return;
    expect(result.code.trim()).toBe("");
  });

  test("returns source-aware structured diagnostics for direct transform failures", async () => {
    const result = await experimentalTransformReactTsxDirect("src/broken.tsx", `
      export const broken = <div>;
    `);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      tool: "oxc-transform",
      kind: "transform-failed",
      severity: "error",
      file: "src/broken.tsx",
      line: 2,
    });
    expect(result.diagnostics[0]?.span?.start).toBeGreaterThan(0);
  });

  test("converts native UTF-8 diagnostic byte spans to JavaScript source spans", async () => {
    const source = `const café = 1;
export const broken = <div>;`;
    const result = await experimentalTransformReactTsxDirect("src/non-ascii.tsx", source);

    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics[0];
    expect(diagnostic).toMatchObject({
      tool: "oxc-transform",
      kind: "transform-failed",
      file: "src/non-ascii.tsx",
      line: 2,
      column: source.split("\n")[1]!.lastIndexOf(";") + 1,
    });
    expect(diagnostic?.span?.start).toBe(source.lastIndexOf(";"));
  });

  test("recovers after failed direct transforms", async () => {
    const broken = await experimentalTransformReactTsxDirect("src/broken.tsx", `export const broken = <div>;`);
    const recovered = await experimentalTransformReactTsxDirect("src/recovered.tsx", `export const value = <p>ok</p>;`);

    expect(broken.ok).toBe(false);
    expect(recovered.ok, JSON.stringify(recovered.diagnostics, null, 2)).toBe(true);
  });
});
