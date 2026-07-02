import { describe, expect, test } from "vitest";

import { compileDynamicWorker, experimentalCreateDynamicWorkerBuildSession } from "../../../src/index";
import {
  createCandidatePackageSessionMeasurementInput,
  createPackageSessionMeasurementInput,
  createSessionMeasurementGraph,
  entrypointWithExtraModule,
  measureDuration,
  sessionMeasurementLeafSource,
  summarizeSessionMeasurements,
  summarizeSessionMeasurementSteps,
} from "./session-cache-measurement-helpers";

function assertBuildOk(build: Awaited<ReturnType<typeof compileDynamicWorker>>): asserts build is Awaited<ReturnType<typeof compileDynamicWorker>> & { mainModule: string; modules: Record<string, unknown> } {
  expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
  expect(build.mainModule).toBeDefined();
  expect(build.modules).toBeDefined();
}

describe("cached Oxc build-session measurements", () => {
  test("records graph, virtual, and cached session timings for 10 and 50 module graphs", async () => {
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
        graphScannedModules: Array.from({ length: moduleCount + 1 }, (_, index) => index === 0 ? "src/index.tsx" : `src/module-${index - 1}.tsx`).sort(),
        graphReusedModules: [],
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
        graphScannedModules: [`src/module-${moduleCount - 1}.tsx`],
        graphReusedModules: Array.from({ length: moduleCount }, (_, index) => index === 0 ? "src/index.tsx" : `src/module-${index - 1}.tsx`).sort(),
        packageGraphRebuilt: false,
      });

      session.setVirtualModule("unused/virtual", { js: `export const unused = ${moduleCount};` });
      const unrelatedVirtualUpdate = await measureDuration(() => session.compile());
      assertBuildOk(unrelatedVirtualUpdate.value);
      expect(Object.keys(unrelatedVirtualUpdate.value.modules)).toHaveLength(moduleCount + 2);
      expect(unrelatedVirtualUpdate.value.session.cache).toMatchObject({
        transformedModules: ["unused/virtual.js"],
        reusedModules: Array.from({ length: moduleCount + 1 }, (_, index) => index === 0 ? "src/index.js" : `src/module-${index - 1}.js`).sort(),
        droppedModules: [],
        graphRebuilt: true,
        graphScannedModules: [],
        graphReusedModules: Array.from({ length: moduleCount + 1 }, (_, index) => index === 0 ? "src/index.tsx" : `src/module-${index - 1}.tsx`).sort(),
        packageGraphRebuilt: false,
      });

      session.updateFile("src/extra.tsx", `export function extra() { return 1000 }`);
      session.updateFile("src/index.tsx", entrypointWithExtraModule(moduleCount));
      const graphUpdate = await measureDuration(() => session.compile());
      assertBuildOk(graphUpdate.value);
      expect(Object.keys(graphUpdate.value.modules)).toHaveLength(moduleCount + 3);
      expect(graphUpdate.value.session.cache?.transformedModules.sort()).toEqual(["src/extra.js", "src/index.js"]);
      expect(graphUpdate.value.session.cache?.reusedModules).toHaveLength(moduleCount + 1);
      expect(graphUpdate.value.session.cache?.reusedModules).toContain("unused/virtual.js");
      expect(graphUpdate.value.session.cache?.graphScannedModules.sort()).toEqual(["src/extra.tsx", "src/index.tsx"]);
      expect(graphUpdate.value.session.cache?.graphReusedModules).toHaveLength(moduleCount);

      summaries.push(summarizeSessionMeasurements(moduleCount, full, initial, leafUpdate, unrelatedVirtualUpdate, graphUpdate));
    }

    console.log("[session-cache-measurements]", JSON.stringify(summaries));
  });

  test("records package snapshot update timing and package cache guardrails", async () => {
    const input = createPackageSessionMeasurementInput();
    const session = experimentalCreateDynamicWorkerBuildSession(input);

    const initial = await measureDuration(() => session.compile());
    assertBuildOk(initial.value);
    expect(Object.keys(initial.value.modules).sort()).toEqual(["node_modules/pkg/index.js", "src/index.js"]);
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
      graphScannedModules: ["src/index.tsx"],
      graphReusedModules: [],
      packageGraphRebuilt: false,
    });

    session.setPackageFile("node_modules/pkg/index.js", `export const label = "changed";`);
    const activePackageUpdate = await measureDuration(() => session.compile());
    assertBuildOk(activePackageUpdate.value);
    expect(activePackageUpdate.value.session.cache).toMatchObject({
      transformedModules: [],
      reusedModules: ["src/index.js"],
      droppedModules: [],
      graphRebuilt: true,
      graphScannedModules: [],
      graphReusedModules: ["src/index.tsx"],
      packageGraphRebuilt: true,
    });
    expect(activePackageUpdate.value.modules["node_modules/pkg/index.js"]).toEqual({ js: expect.stringContaining("changed") });

    session.setPackageFile("node_modules/unused/index.js", `export const label = "changed unused";`);
    session.setPackageFile("node_modules/unused/package.json", JSON.stringify({ name: "unused", exports: "./changed.js" }));
    const unusedPackageUpdate = await measureDuration(() => session.compile());
    assertBuildOk(unusedPackageUpdate.value);
    expect(unusedPackageUpdate.value.session.cache).toMatchObject({
      transformedModules: [],
      reusedModules: ["src/index.js"],
      droppedModules: [],
      graphRebuilt: true,
      graphScannedModules: [],
      graphReusedModules: ["src/index.tsx"],
      packageGraphRebuilt: false,
    });
    expect(unusedPackageUpdate.value.modules["node_modules/pkg/index.js"]).toEqual({ js: expect.stringContaining("changed") });
    expect(unusedPackageUpdate.value.modules["node_modules/unused/index.js"]).toBeUndefined();

    const packageSummary = summarizeSessionMeasurementSteps({
      initial,
      unchangedPackage,
      activePackageUpdate,
      unusedPackageUpdate,
    });
    expect(packageSummary.map((step) => step.label)).toEqual(["initial", "unchangedPackage", "activePackageUpdate", "unusedPackageUpdate"]);
    expect(packageSummary.find((step) => step.label === "unusedPackageUpdate")?.packageGraphRebuilt).toBe(false);

    const candidateSession = experimentalCreateDynamicWorkerBuildSession(createCandidatePackageSessionMeasurementInput());
    const candidateInitial = await measureDuration(() => candidateSession.compile());
    assertBuildOk(candidateInitial.value);
    expect(candidateInitial.value.modules["node_modules/candidate-pkg/dep.mjs"]).toEqual({ js: expect.stringContaining("mjs dependency") });

    candidateSession.setPackageFile("node_modules/candidate-pkg/dep.js", `export const label = "js dependency";`);
    const candidateInsertion = await measureDuration(() => candidateSession.compile());
    assertBuildOk(candidateInsertion.value);
    expect(candidateInsertion.value.session.cache).toMatchObject({
      transformedModules: [],
      reusedModules: ["src/index.js"],
      droppedModules: ["node_modules/candidate-pkg/dep.mjs"],
      graphRebuilt: true,
      graphScannedModules: [],
      graphReusedModules: ["src/index.tsx"],
      packageGraphRebuilt: true,
    });
    expect(candidateInsertion.value.modules["node_modules/candidate-pkg/dep.js"]).toEqual({ js: expect.stringContaining("js dependency") });
    expect(candidateInsertion.value.modules["node_modules/candidate-pkg/dep.mjs"]).toBeUndefined();

    const candidateSummary = summarizeSessionMeasurementSteps({
      candidateInitial,
      candidateInsertion,
    });
    expect(candidateSummary.find((step) => step.label === "candidateInsertion")?.droppedModules).toEqual(["node_modules/candidate-pkg/dep.mjs"]);

    console.log("[session-cache-package-measurement]", JSON.stringify({
      package: packageSummary,
      candidate: candidateSummary,
    }));
  });
});
