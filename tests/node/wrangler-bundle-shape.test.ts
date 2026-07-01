import { describe, expect, it } from "vitest";
import { measureWranglerBundleShape } from "./wrangler-bundle-shape-helpers";

const CASES = [
  { caseName: "babel", entrypoint: "tests/bundle-shape/entries/babel.ts" },
  { caseName: "swc", entrypoint: "tests/bundle-shape/entries/swc.ts" },
  { caseName: "oxc", entrypoint: "tests/bundle-shape/entries/oxc.ts" }
] as const;

function assertFiniteNonNegative(value: number): void {
  expect(Number.isFinite(value)).toBe(true);
  expect(value).toBeGreaterThanOrEqual(0);
}

describe("Wrangler dry-run bundle shape", () => {
  it("records deployable bundle output for Babel, SWC, and Oxc fixtures", async () => {
    const results = [];
    for (const entry of CASES) {
      results.push(await measureWranglerBundleShape(entry.caseName, entry.entrypoint));
    }

    for (const result of results) {
      expect(result.ok, result.stderr || result.stdout).toBe(true);
      expect(result.files.length).toBeGreaterThan(0);
      assertFiniteNonNegative(result.totalBytes);
      assertFiniteNonNegative(result.metafileInputBytes);
      assertFiniteNonNegative(result.metafileOutputBytes);
      expect(result.wranglerUploadBytes).toBeGreaterThan(0);
      expect(result.wranglerUploadGzipBytes).toBeGreaterThan(0);
      for (const file of result.files) assertFiniteNonNegative(file.bytes);
    }

    console.log("[wrangler-bundle-shape]", JSON.stringify(results));
  }, 120_000);
});
