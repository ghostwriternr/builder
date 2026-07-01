import { describe, expect, it } from "vitest";
import { checkReactTsx } from "../../../src/index";
import { experimentalParseReactTsxAst } from "../../../src/experiments/babel-ast";
import { experimentalParseTransformReactTsxWithSwc } from "../../../src/experiments/swc";
import { timed } from "../experiments/swc-operational-helpers";

type NumericRecord = Record<string, number>;

type MemorySource = Record<string, unknown> | NodeJS.MemoryUsage;

interface MemorySnapshot {
  label: string;
  available: boolean;
  performanceMemory?: NumericRecord;
  processMemory?: NumericRecord;
}

function largeTsxSource(componentCount: number): string {
  const components = Array.from({ length: componentCount }, (_, index) => `
export const Widget${index} = ({ title, active }: { title: string; active?: boolean }) => {
  const attrs = { "data-index": "${index}", "data-active": String(Boolean(active)) } satisfies Record<string, string>;
  return (
    <section {...attrs}>
      <h2>{title}</h2>
      <ul>{Array.from({ length: 3 }, (_, item) => <li key={item}>Widget ${index} item {item}</li>)}</ul>
    </section>
  );
};
`).join("\n");

  return `import type { ReactNode } from "react";

type DeckProps = { title: string; children?: ReactNode };

export const Deck = ({ title, children }: DeckProps) => <main aria-label={title}>{children}</main>;
${components}
`;
}

function memorySnapshot(label: string): MemorySnapshot {
  const runtime = globalThis as typeof globalThis & {
    performance?: Performance & { memory?: NumericRecord };
    process?: { memoryUsage?: () => NumericRecord };
  };
  const performanceMemory = runtime.performance?.memory;
  const processMemory = typeof runtime.process?.memoryUsage === "function" ? runtime.process.memoryUsage() : undefined;
  return {
    label,
    available: Boolean(performanceMemory || processMemory),
    performanceMemory: performanceMemory ? finiteNumericRecord(performanceMemory) : undefined,
    processMemory: processMemory ? finiteNumericRecord(processMemory) : undefined
  };
}

function finiteNumericRecord(record: MemorySource): NumericRecord {
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
  );
}

function assertFiniteNonNegative(value: number): void {
  expect(Number.isFinite(value)).toBe(true);
  expect(value).toBeGreaterThanOrEqual(0);
}

describe("toolchain memory-risk surface in workerd", () => {
  it("records memory API availability and repeated large-input parser behavior", async () => {
    const source = largeTsxSource(60);
    const snapshots: MemorySnapshot[] = [memorySnapshot("before")];

    const babel = await timed(() => {
      for (let index = 0; index < 3; index++) {
        const result = experimentalParseReactTsxAst(source, `large-babel-${index}.tsx`);
        expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
      }
    });
    snapshots.push(memorySnapshot("after-babel"));

    const swc = await timed(() => {
      for (let index = 0; index < 3; index++) {
        const result = experimentalParseTransformReactTsxWithSwc(source, `large-swc-${index}.tsx`, {
          transformFromAst: index % 2 === 1
        });
        expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
      }
    });
    snapshots.push(memorySnapshot("after-swc"));

    const oxc = await timed(async () => {
      for (let index = 0; index < 3; index++) {
        const result = await checkReactTsx(source);
        expect(result.ok, JSON.stringify(result.diagnostics, null, 2)).toBe(true);
      }
    });
    snapshots.push(memorySnapshot("after-oxc"));

    for (const duration of [babel.durationMs, swc.durationMs, oxc.durationMs]) assertFiniteNonNegative(duration);

    for (const snapshot of snapshots) {
      for (const value of Object.values(snapshot.performanceMemory ?? {})) assertFiniteNonNegative(value);
      for (const value of Object.values(snapshot.processMemory ?? {})) assertFiniteNonNegative(value);
    }

    console.log("[toolchain-memory-risk]", JSON.stringify({
      sourceLength: source.length,
      durations: {
        babelRepeatedLargeParseMs: babel.durationMs,
        swcRepeatedLargeParseTransformMs: swc.durationMs,
        oxcRepeatedLargeCheckMs: oxc.durationMs
      },
      snapshots,
      memoryApiAvailable: snapshots.some((snapshot) => snapshot.available)
    }));
  });
});
