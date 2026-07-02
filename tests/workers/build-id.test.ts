import { describe, expect, test } from "vitest";

import { dynamicWorkerBuildId, hashDynamicWorkerBuild } from "../../src/index";

describe("Dynamic Worker build IDs", () => {
  test("hashes complete module maps deterministically across insertion order", () => {
    const first = {
      mainModule: "src/index.js",
      modules: {
        "src/index.js": `import "./data.json"; export default {};`,
        "src/data.json": { json: { z: 1, a: true } },
      },
    };
    const second = {
      mainModule: "src/index.js",
      modules: {
        "src/data.json": { json: { a: true, z: 1 } },
        "src/index.js": `import "./data.json"; export default {};`,
      },
    };

    expect(hashDynamicWorkerBuild(first)).toBe(hashDynamicWorkerBuild(second));
    expect(dynamicWorkerBuildId("demo", first)).toMatch(/^demo:[0-9a-f]{16}$/);
  });

  test("rejects failed or malformed builds", () => {
    expect(() => hashDynamicWorkerBuild({ ok: false, diagnostics: [], evidence: [] })).toThrow(/failed/i);
    expect(() => dynamicWorkerBuildId("bad prefix", { mainModule: "x.js", modules: { "x.js": "" } })).toThrow(/whitespace/i);
    expect(() => hashDynamicWorkerBuild({ mainModule: "x.js", modules: { "x.js": { json: { nope: undefined } } } })).toThrow(/undefined/i);
  });
});
