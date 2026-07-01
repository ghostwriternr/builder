import { describe, expect, it } from "vitest";
import { initSync, parseSync, transformSync } from "@swc/wasm-web";
import swcWasmModule from "@swc/wasm-web/wasm_bg.wasm";

const TSX_SOURCE = `type Props = { name: string };

export const Component = ({ name }: Props) => {
  return <div data-name={name}>{name}</div>;
};
`;

let initialized = false;

function ensureSwcInitialized(): void {
  if (initialized) return;
  expect(swcWasmModule).toBeInstanceOf(WebAssembly.Module);
  initSync({ module: swcWasmModule });
  initialized = true;
}

function collectTypes(value: unknown, types = new Set<string>()): Set<string> {
  if (typeof value !== "object" || value === null) return types;
  const maybeNode = value as { type?: unknown };
  if (typeof maybeNode.type === "string") types.add(maybeNode.type);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) collectTypes(item, types);
    } else {
      collectTypes(child, types);
    }
  }
  return types;
}

describe("SWC wasm-web TSX AST and transform in workerd", () => {
  it("initializes from a precompiled Worker WebAssembly.Module", () => {
    ensureSwcInitialized();
    expect(swcWasmModule).toBeInstanceOf(WebAssembly.Module);
  });

  it("parses TSX into an SWC AST", () => {
    ensureSwcInitialized();

    const ast = parseSync(TSX_SOURCE, {
      syntax: "typescript",
      tsx: true,
      target: "es2022"
    });
    const types = collectTypes(ast);

    expect((ast as { type?: unknown }).type).toBe("Module");
    expect(types).toContain("Module");
    expect(types).toContain("ExportDeclaration");
    expect(types).toContain("VariableDeclaration");
    expect(types).toContain("JSXElement");
  });

  it("transforms TSX source and parsed AST", () => {
    ensureSwcInitialized();

    const transformOptions = {
      jsc: {
        parser: { syntax: "typescript" as const, tsx: true },
        target: "es2022" as const,
        transform: { react: { runtime: "automatic" as const } }
      },
      module: { type: "es6" as const }
    };
    const fromSource = transformSync(TSX_SOURCE, transformOptions);
    const ast = parseSync(TSX_SOURCE, {
      syntax: "typescript",
      tsx: true,
      target: "es2022"
    });
    const fromAst = transformSync(ast, transformOptions);

    expect(fromSource.code).toContain("react/jsx-runtime");
    expect(fromSource.code).toContain("_jsx");
    expect(fromSource.code).not.toContain(": Props");
    expect(fromAst.code).toContain("react/jsx-runtime");
    expect(fromAst.code).toContain("_jsx");
  });
});
