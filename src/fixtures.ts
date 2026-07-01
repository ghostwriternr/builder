export const TSX_COMPONENT_FIXTURE = `export function Widget() {
  const items = ["Fast", "Native", "Validated"]
  return (
    <section className="component">
      <h1>Hello</h1>
      {items.map((item) => <p key={item}>{item}</p>)}
    </section>
  )
}
`;

export const WORKER_ENTRY_FIXTURE = `export default {
  async fetch() {
    return new Response("hello from compiled worker")
  }
}
`;

export const REACT_WORKER_FIXTURE = `import { Widget } from "./Widget";

export default {
  async fetch() {
    return new Response("hello from compiled worker")
  }
}
`;
