import type {
  AnalyzeInput,
  AnalyzeOutput,
  Oxc,
  OxcResult,
  ParseInput,
  ParseOutput,
  TransformInput,
  TransformOutput,
} from "./types.ts";

let defaultOxcPromise: Promise<Oxc> | undefined;

export async function createOxc(): Promise<Oxc> {
  if (arguments.length > 0) {
    throw new TypeError("createOxc() does not accept options.");
  }

  const [{ createParserRuntime }, { createTransformRuntime }, { createAnalyzeRuntime }] =
    await Promise.all([import("./parser.ts"), import("./transform.ts"), import("./analyze.ts")]);

  const parser = createParserRuntime();
  const transformer = createTransformRuntime();
  const analyzer = createAnalyzeRuntime();

  return {
    parse(input: ParseInput): OxcResult<ParseOutput> {
      return parser.parse(input);
    },
    transform(input: TransformInput): OxcResult<TransformOutput> {
      return transformer.transform(input);
    },
    experimentalAnalyze(input: AnalyzeInput): OxcResult<AnalyzeOutput> {
      return analyzer.analyze(input);
    },
  };
}

export async function parse(input: ParseInput): Promise<OxcResult<ParseOutput>> {
  const oxc = await defaultOxc();
  return oxc.parse(input);
}

export async function transform(input: TransformInput): Promise<OxcResult<TransformOutput>> {
  const oxc = await defaultOxc();
  return oxc.transform(input);
}

export async function experimentalAnalyze(input: AnalyzeInput): Promise<OxcResult<AnalyzeOutput>> {
  const oxc = await defaultOxc();
  return oxc.experimentalAnalyze(input);
}

function defaultOxc(): Promise<Oxc> {
  defaultOxcPromise ??= createOxc();
  return defaultOxcPromise;
}
