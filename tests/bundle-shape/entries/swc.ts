import { experimentalParseTransformReactTsxWithSwc } from "../../../src/experiments/swc";

const SOURCE = `type Props = { title: string };
export const Widget = ({ title }: Props) => <section data-title={title}>{title}</section>;
`;

export default {
  fetch() {
    const result = experimentalParseTransformReactTsxWithSwc(SOURCE, "bundle-shape-swc.tsx");
    return new Response(JSON.stringify({
      toolchain: "swc",
      ok: result.ok,
      codeLength: result.ok ? result.code.length : 0
    }));
  }
};
