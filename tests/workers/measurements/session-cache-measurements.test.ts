import { describe, expect, test } from "vitest";

import { compileDynamicWorker, experimentalCreateDynamicWorkerBuildSession } from "../../../src/index";
import {
  createPackageSessionMeasurementInput,
  createSessionMeasurementGraph,
  entrypointWithExtraModule,
  measureDuration,
  sessionMeasurementLeafSource,
  summarizeSessionMeasurements,
} from "./session-cache-measurement-helpers";

function assertBuildOk(build: Awaited<ReturnType<typeof compileDynamicWorker>>): asserts build is Awaited<ReturnType<typeof compileDynamicWorker>> & { mainModule: string; modules: Record<string, unknown> } {
  expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
  expect(build.mainModule).toBeDefined();
  expect(build.modules).toBeDefined();
}

describe("cached Oxc build-session measurements", () => {
  test("records full compile versus cached session timings for 10 and 50 module graphs", async () => {
    const summaries = [];

    for (const moduleCount of [10, 50]) {
      const input = createSessionMeasurementGraph(moduleCount);

      const full = await measureDuration(() => compileDynamicWorker(input));
      assertBuildOk(full.value);
      expect(Object.keys(full.value.modules)).toHaveLength(moduleCount + 1);

      const session = experimentalCreateDynamicWorkerBuildSession(input);
      const initial = await measureDuration(() => session.compile());
      assertBuildOk(initial.value);
      expect(initial.value.session.cache).toMatchObject({
        transformedModules: Array.from({ length: moduleCount + 1 }, (_, index) => index === 0 ? "src/index.js" : `src/module-${index - 1}.js`).sort(),
        reusedModules: [],
        droppedModules: [],
        graphRebuilt: true,
        packageGraphRebuilt: false,
      });

      session.updateFile(`src/module-${moduleCount - 1}.tsx`, sessionMeasurementLeafSource(moduleCount - 1, 999));
      const leafUpdate = await measureDuration(() => session.compile());
      assertBuildOk(leafUpdate.value);
      expect(Object.keys(leafUpdate.value.modules)).toHaveLength(moduleCount + 1);
      expect(leafUpdate.value.session.cache).toMatchObject({
        transformedModules: [`src/module-${moduleCount - 1}.js`],
        reusedModules: Array.from({ length: moduleCount }, (_, index) => index === 0 ? "src/index.js" : `src/module-${index - 1}.js`).sort(),
        droppedModules: [],
        graphRebuilt: true,
        packageGraphRebuilt: false,
      });

      session.updateFile("src/extra.tsx", `export function extra() { return 1000 }`);
      session.updateFile("src/index.tsx", entrypointWithExtraModule(moduleCount));
      const graphUpdate = await measureDuration(() => session.compile());
      assertBuildOk(graphUpdate.value);
      expect(Object.keys(graphUpdate.value.modules)).toHaveLength(moduleCount + 2);
      expect(graphUpdate.value.session.cache?.transformedModules.sort()).toEqual(["src/extra.js", "src/index.js"]);
      expect(graphUpdate.value.session.cache?.reusedModules).toHaveLength(moduleCount);

      summaries.push(summarizeSessionMeasurements(moduleCount, full, initial, leafUpdate, graphUpdate));
    }

    console.log("[session-cache-measurements]", JSON.stringify(summaries));
  });

  test("records package snapshot update timing and package cache metadata", async () => {
    const input = createPackageSessionMeasurementInput();
    const session = experimentalCreateDynamicWorkerBuildSession(input);

    const initial = await measureDuration(() => session.compile());
    assertBuildOk(initial.value);
    expect(initial.value.session.cache?.packageGraphRebuilt).toBe(true);

    session.updateFile("src/index.tsx", `
      import { label } from "pkg";
      export default { async fetch() { return new Response(label + "!") } }
    `);
    const unchangedPackage = await measureDuration(() => session.compile());
    assertBuildOk(unchangedPackage.value);
    expect(unchangedPackage.value.session.cache).toMatchObject({
      transformedModules: ["src/index.js"],
      reusedModules: [],
      droppedModules: [],
      graphRebuilt: true,
      packageGraphRebuilt: false,
    });

    session.setPackageFile("node_modules/pkg/index.js", `export const label = "changed";`);
    const packageUpdate = await measureDuration(() => session.compile());
    assertBuildOk(packageUpdate.value);
    expect(packageUpdate.value.session.cache).toMatchObject({
      transformedModules: [],
      reusedModules: ["src/index.js"],
      droppedModules: [],
      graphRebuilt: true,
      packageGraphRebuilt: true,
    });

    console.log("[session-cache-package-measurement]", JSON.stringify({
      initialMs: initial.durationMs,
      unchangedPackageMs: unchangedPackage.durationMs,
      packageUpdateMs: packageUpdate.durationMs,
      packageUpdateCache: packageUpdate.value.session.cache,
    }));
  });
});
