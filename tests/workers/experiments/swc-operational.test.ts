import { describe, expect, it } from "vitest";
import { compileDynamicWorker } from "../../../src/index";
import { experimentalParseTransformReactTsxWithSwc } from "../../../src/experiments/swc";
import type { ReactWorkerBuildInput, ReactWorkerBuildOutput } from "../../../src/types";
import { timed } from "./swc-operational-helpers";

const JSX_RUNTIME = `
export function jsx(type, props) { return { type, props }; }
export const jsxs = jsx;
export const Fragment = Symbol.for("react.fragment");
`;

const SMALL_TSX_SOURCE = `import type { ReactNode } from "react";

type Props<T extends string> = { title: T; children?: ReactNode };

export const Widget = <T extends string,>({ title }: Props<T>) => {
  return <section data-title={title}>{title}</section>;
};
`;

function largeTsxSource(componentCount: number): string {
  const components = Array.from({ length: componentCount }, (_, index) => `
export const Widget${index} = ({ title }: { title: string }) => {
  const attrs = { "data-index": "${index}" } satisfies Record<string, string>;
  return <section {...attrs}><h2>{title}</h2><p>Widget ${index}</p></section>;
};
`).join("\n");

  return `import type { ReactNode } from "react";

type DeckProps = { title: string; children?: ReactNode };

export const Deck = ({ title, children }: DeckProps) => <main aria-label={title}>{children}</main>;
${components}
`;
}

function oxcComparableInput(source: string): ReactWorkerBuildInput {
  return {
    entrypoint: "src/index.tsx",
    files: {
      "src/index.tsx": `${source}
export default {
  fetch() {
    return new Response(String(Boolean(Widget)));
  }
};
`
    },
    virtualModules: {
      "react/jsx-runtime": { js: JSX_RUNTIME }
    }
  };
}

function assertBuildOk(build: ReactWorkerBuildOutput): void {
  expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
  expect(build.mainModule).toBeDefined();
  expect(build.modules).toBeDefined();
}

function assertFiniteDuration(value: number): void {
  expect(Number.isFinite(value)).toBe(true);
  expect(value).toBeGreaterThanOrEqual(0);
}

describe("SWC operational comparison in workerd", () => {
  it("records local parse+transform timings and compares with the current Oxc compile path", async () => {
    const swcColdSource = await timed(() => experimentalParseTransformReactTsxWithSwc(SMALL_TSX_SOURCE, "small-cold.tsx"));
    expect(swcColdSource.result.ok, JSON.stringify(swcColdSource.result.diagnostics, null, 2)).toBe(true);

    const swcWarmSource = await timed(() => experimentalParseTransformReactTsxWithSwc(SMALL_TSX_SOURCE, "small-warm.tsx"));
    expect(swcWarmSource.result.ok, JSON.stringify(swcWarmSource.result.diagnostics, null, 2)).toBe(true);

    const swcWarmAst = await timed(() => experimentalParseTransformReactTsxWithSwc(SMALL_TSX_SOURCE, "small-ast.tsx", {
      transformFromAst: true
    }));
    expect(swcWarmAst.result.ok, JSON.stringify(swcWarmAst.result.diagnostics, null, 2)).toBe(true);

    const largeSource = largeTsxSource(40);
    const swcLargeSource = await timed(() => experimentalParseTransformReactTsxWithSwc(largeSource, "large.tsx"));
    expect(swcLargeSource.result.ok, JSON.stringify(swcLargeSource.result.diagnostics, null, 2)).toBe(true);

    const swcInvalid = await timed(() => experimentalParseTransformReactTsxWithSwc("export const Broken = <div>;", "broken.tsx"));
    expect(swcInvalid.result.ok).toBe(false);
    if (!swcInvalid.result.ok) {
      expect(swcInvalid.result.diagnostics[0]).toMatchObject({ tool: "swc-wasm-web", kind: "parse-failed" });
    }

    const swcRecovery = await timed(() => experimentalParseTransformReactTsxWithSwc(SMALL_TSX_SOURCE, "small-recovery.tsx"));
    expect(swcRecovery.result.ok, JSON.stringify(swcRecovery.result.diagnostics, null, 2)).toBe(true);

    const oxcSmallCompile = await timed(() => compileDynamicWorker(oxcComparableInput(SMALL_TSX_SOURCE)));
    assertBuildOk(oxcSmallCompile.result);

    const durations = {
      swcColdSourceMs: swcColdSource.durationMs,
      swcWarmSourceMs: swcWarmSource.durationMs,
      swcWarmAstMs: swcWarmAst.durationMs,
      swcLargeSourceMs: swcLargeSource.durationMs,
      swcInvalidMs: swcInvalid.durationMs,
      swcRecoveryMs: swcRecovery.durationMs,
      oxcSmallCompileMs: oxcSmallCompile.durationMs
    };

    for (const duration of Object.values(durations)) assertFiniteDuration(duration);

    const metrics = {
      ...durations,
      largeSourceLength: largeSource.length,
      swcColdEvidence: swcColdSource.result.evidence,
      swcWarmAstEvidence: swcWarmAst.result.evidence,
      swcInvalidEvidence: swcInvalid.result.evidence,
      oxcSmallEvidence: oxcSmallCompile.result.evidence.map((event) => ({
        tool: event.tool,
        stage: event.stage,
        ok: event.ok,
        durationMs: event.durationMs,
        detail: event.detail
      }))
    };

    console.log("[swc-operational-comparison]", JSON.stringify(metrics));
  });
});
