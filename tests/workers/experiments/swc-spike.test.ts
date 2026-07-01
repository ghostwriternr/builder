import { describe, expect, it } from "vitest";
import { experimentalParseTransformReactTsxWithSwc } from "../../../src/experiments/swc";

const TSX_SOURCE = `import type { ReactNode } from "react";

type Props<T extends string> = { title: T; children?: ReactNode };

export const Widget = <T extends string,>({ title }: Props<T>) => {
  return <section data-title={title}>{title}</section>;
};
`;

function collectTypes(value: unknown, types = new Set<string>()): Set<string> {
  if (typeof value !== "object" || value === null) return types;
  if ("type" in value && typeof value.type === "string") types.add(value.type);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) collectTypes(item, types);
    } else {
      collectTypes(child, types);
    }
  }
  return types;
}

describe("experimental SWC TSX parse+transform helper", () => {
  it("parses TSX into an SWC AST and transforms it to automatic-runtime ESM", () => {
    const result = experimentalParseTransformReactTsxWithSwc(TSX_SOURCE, "component.tsx");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join("\n"));

    const types = collectTypes(result.ast);
    expect((result.ast as { type?: unknown }).type).toBe("Module");
    expect(types).toContain("JSXElement");
    expect(result.code).toContain("react/jsx-runtime");
    expect(result.code).toContain("_jsx");
    expect(result.code).not.toContain(": Props");
    expect(result.diagnostics).toEqual([]);
    expect(result.evidence.some((e) => e.tool === "swc-wasm-web" && e.stage === "parse" && e.ok)).toBe(true);
    expect(result.evidence.some((e) => e.tool === "swc-wasm-web" && e.stage === "transform" && e.ok)).toBe(true);
  });

  it("can transform from the parsed AST without reparsing source", () => {
    const result = experimentalParseTransformReactTsxWithSwc(TSX_SOURCE, "component.tsx", { transformFromAst: true });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join("\n"));

    expect(result.code).toContain("react/jsx-runtime");
    expect(result.evidence.some((e) => e.detail?.includes("from parsed AST"))).toBe(true);
  });

  it("returns structured diagnostics for invalid TSX", () => {
    const result = experimentalParseTransformReactTsxWithSwc("export const Broken = <div>;", "broken.tsx");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid TSX to fail");

    expect(result.diagnostics[0]).toMatchObject({
      tool: "swc-wasm-web",
      kind: "parse-failed",
      severity: "error",
      file: "broken.tsx"
    });
    expect(result.evidence.some((e) => e.tool === "swc-wasm-web" && e.stage === "parse" && !e.ok)).toBe(true);
  });

  it("handles repeated parse+transform calls in one isolate", () => {
    const results = Array.from({ length: 5 }, (_, index) =>
      experimentalParseTransformReactTsxWithSwc(TSX_SOURCE.replace("Widget", `Widget${index}`), `component-${index}.tsx`)
    );

    expect(results.every((result) => result.ok)).toBe(true);
    for (const result of results) {
      if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join("\n"));
      expect(result.evidence.some(
        (e) => e.tool === "swc-wasm-web" && e.stage === "transform" && typeof e.durationMs === "number"
      )).toBe(true);
    }
  });
});
