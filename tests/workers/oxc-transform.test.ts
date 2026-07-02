import { describe, expect, test } from "vitest";

import { transformReactTsx } from "../../src/index";

describe("transformReactTsx", () => {
  test("transforms TypeScript and TSX to JavaScript inside workerd", async () => {
    const result = await transformReactTsx("src/component.tsx", `
      type Props = { label: string };
      export function Component(props: Props) {
        return <span>{props.label}</span>;
      }
    `);

    expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
    if (!result.ok) return;

    expect(result.code).toContain("export function Component");
    expect(result.code).not.toContain("type Props");
    expect(result.code).toContain("react/jsx-runtime");
    expect(result.map).toBeDefined();
  });

  test("accepts empty source modules", async () => {
    const result = await transformReactTsx("src/empty.ts", "");

    expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
    if (!result.ok) return;
    expect(result.code).toBe("");
  });

  test("returns structured transform diagnostics", async () => {
    const result = await transformReactTsx("src/broken.tsx", `export const broken = <div>;`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      tool: "oxc-transform",
      kind: "transform-failed",
      severity: "error",
    });
  });
});
