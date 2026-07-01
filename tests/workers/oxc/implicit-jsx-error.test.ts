import { describe, expect, it } from "vitest";
import { checkReactTsx } from "../../../src/index";

describe("Implicit JSX", () => {
  it("fails with diagnostic if virtual module for jsx is missing", async () => {
    const result = await checkReactTsx({
      entrypoint: "src/index.tsx",
      files: {
        "src/index.tsx": `export default { fetch() { return new Response(<span></span>.type); } };`
      }
    });
    console.log(JSON.stringify(result.diagnostics, null, 2));
  });
});
