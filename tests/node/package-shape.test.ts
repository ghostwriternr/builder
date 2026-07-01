import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);

function packageJson(name: string) {
  return JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8"));
}

describe("published package shape relevant to workerd", () => {
  it("tracks @rolldown/browser as the archived browser/WASI bundler candidate", () => {
    const pkg = packageJson("@rolldown/browser");
    expect(pkg.name).toBe("@rolldown/browser");
    expect(pkg.exports["."].browser).toContain("browser");
    expect(pkg.dependencies).toHaveProperty("@napi-rs/wasm-runtime");
  });

  it("tracks Oxc parser/transform browser entries as WASI candidates", () => {
    const parser = packageJson("oxc-parser");
    const transform = packageJson("oxc-transform");
    expect(parser.browser).toBe("src-js/wasm.js");
    expect(transform.browser).toBe("browser.js");
    expect(parser.optionalDependencies).toHaveProperty("@oxc-parser/binding-wasm32-wasi");
    expect(transform.optionalDependencies).toHaveProperty("@oxc-transform/binding-wasm32-wasi");
  });

  it("tracks Vite and rolldown-vite as Node-facing package exports", () => {
    expect(packageJson("vite").exports["."]).toBe("./dist/node/index.js");
    expect(packageJson("rolldown-vite").exports["."]).toBe("./dist/node/index.js");
  });
});
