import { describe, expect, it } from "vitest";
import { compileDynamicWorker } from "../../../src/index";

describe("Implicit JSX", () => {
  it("fails with diagnostic if virtual module for jsx is missing", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.tsx",
      files: {
        "src/index.tsx": `const v = <span></span>; export default { fetch() { return new Response("x"); } };`
      }
    });
    console.log(JSON.stringify(build.diagnostics, null, 2));
    console.log(JSON.stringify(build.modules, null, 2));
  });
});
