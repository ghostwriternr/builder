import { experimentalParseReactTsxAst } from "../../../src/experiments/babel-ast";

const SOURCE = `type Props = { title: string };
export const Widget = ({ title }: Props) => <section data-title={title}>{title}</section>;
`;

export default {
  fetch() {
    const result = experimentalParseReactTsxAst(SOURCE, "bundle-shape-babel.tsx");
    return new Response(JSON.stringify({ toolchain: "babel", ok: result.ok }));
  }
};
