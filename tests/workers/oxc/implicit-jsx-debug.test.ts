import { describe, expect, it } from "vitest";
import { compileDynamicWorker } from "../../../src/index";

describe("Implicit JSX", () => {
  it("fails with diagnostic if virtual module for jsx is missing", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.tsx",
      files: {
        "src/index.tsx": `export default { fetch() { return new Response(<span></span>.type); } };`
      }
    });
    console.log(JSON.stringify(build.diagnostics, null, 2));
  });
});
