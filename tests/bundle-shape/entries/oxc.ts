import { checkReactTsx } from "../../../src/index";

const SOURCE = `type Props = { title: string };
export const Widget = ({ title }: Props) => <section data-title={title}>{title}</section>;
`;

export default {
  async fetch() {
    const result = await checkReactTsx(SOURCE);
    return new Response(JSON.stringify({ toolchain: "oxc", ok: result.ok }));
  }
};
