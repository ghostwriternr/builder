import { describe, expect, it } from "vitest";
import { parseSync } from "oxc-parser";

const TSX_AST_SOURCE = `import React from "react";

export const count: number = 1;
export default function Widget() {
  return <section data-count={count}>Hello</section>;
}
`;

describe("Oxc parser AST control in Node", () => {
  it("returns a full TSX Program AST through the normal Oxc wrapper", () => {
    const result = parseSync("component.tsx", TSX_AST_SOURCE, {
      lang: "tsx",
      sourceType: "module",
      astType: "ts",
      range: true
    });

    expect(result.errors).toEqual([]);
    expect(result.module.staticImports).toHaveLength(1);
    expect(result.module.staticImports[0]?.moduleRequest.value).toBe("react");
    expect(result.program.type).toBe("Program");
    expect(result.program.sourceType).toBe("module");
    expect(result.program.body.length).toBeGreaterThan(0);
  });
});
