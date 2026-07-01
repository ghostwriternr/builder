import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { compileDynamicWorker, loadDynamicWorker } from "../../../src/index";
import type { WorkerLoaderBinding } from "../../../src/types";
import reactProduction from "../../../node_modules/react/cjs/react.production.js?raw";
import reactJsxRuntimeProduction from "../../../node_modules/react/cjs/react-jsx-runtime.production.js?raw";
import reactDomProduction from "../../../node_modules/react-dom/cjs/react-dom.production.js?raw";
import reactDomServerEdgeProduction from "../../../node_modules/react-dom/cjs/react-dom-server.edge.production.js?raw";
import reactDomServerLegacyBrowserProduction from "../../../node_modules/react-dom/cjs/react-dom-server-legacy.browser.production.js?raw";

interface Env {
  LOADER: WorkerLoaderBinding;
}

const workerEnv = env as unknown as Env;

let id = 0;

function rewriteReactBareRequires(source: string): string {
  return source
    .replaceAll('require("react")', 'require("/node_modules/react/index.js")')
    .replaceAll('require("react-dom")', 'require("/node_modules/react-dom/index.js")');
}

describe("actual React package files in Worker Loader", () => {
  it("loads React 19 CJS production server-render files without bundling after explicit require rewrites", async () => {
    const worker = workerEnv.LOADER.get(`react-cjs-${id++}`, () => ({
      compatibilityDate: "2026-06-30",
      compatibilityFlags: ["nodejs_compat"],
      mainModule: "index.js",
      modules: {
        "index.js": {
          js: `import React from "/node_modules/react/index.js";
import ReactDOMServer from "/node_modules/react-dom/server.edge.js";

const { renderToReadableStream, renderToString } = ReactDOMServer;

export default {
  async fetch() {
    const element = React.createElement("div", null, "hello actual react");
    const stream = await renderToReadableStream(element);
    return Response.json({
      version: React.version,
      streamed: await new Response(stream).text(),
      legacy: renderToString(element)
    });
  }
};
`
        },
        "node_modules/react/index.js": { cjs: reactProduction },
        "node_modules/react/jsx-runtime.js": { cjs: reactJsxRuntimeProduction },
        "node_modules/react-dom/index.js": { cjs: rewriteReactBareRequires(reactDomProduction) },
        "node_modules/react-dom/server.edge.js": {
          cjs: `const edge = require("/node_modules/react-dom/cjs/react-dom-server.edge.production.js");
const legacy = require("/node_modules/react-dom/cjs/react-dom-server-legacy.browser.production.js");

exports.version = edge.version;
exports.renderToReadableStream = edge.renderToReadableStream;
exports.renderToString = legacy.renderToString;
exports.renderToStaticMarkup = legacy.renderToStaticMarkup;
exports.resume = edge.resume;
`
        },
        "node_modules/react-dom/cjs/react-dom-server.edge.production.js": { cjs: rewriteReactBareRequires(reactDomServerEdgeProduction) },
        "node_modules/react-dom/cjs/react-dom-server-legacy.browser.production.js": { cjs: rewriteReactBareRequires(reactDomServerLegacyBrowserProduction) }
      }
    }));

    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    await expect(response.json()).resolves.toEqual({
      version: "19.2.7",
      streamed: "<div>hello actual react</div>",
      legacy: "<div>hello actual react</div>"
    });
  });

  it("emits the React 19 production server-render package graph through the constrained resolver", async () => {
    const build = await compileDynamicWorker({
      entrypoint: "src/index.ts",
      files: {
        "src/index.ts": `import React from "react";
import ReactDOMServer from "react-dom/server";

const { renderToReadableStream, renderToString } = ReactDOMServer;

export default {
  async fetch() {
    const element = React.createElement("div", null, "hello resolver react");
    const stream = await renderToReadableStream(element);
    return Response.json({
      version: React.version,
      streamed: await new Response(stream).text(),
      legacy: renderToString(element)
    });
  }
};
`
      },
      packageFiles: {
        "node_modules/react/package.json": JSON.stringify({
          name: "react",
          exports: {
            ".": { default: "./index.js" }
          }
        }),
        "node_modules/react/index.js": reactProduction,
        "node_modules/react/jsx-runtime.js": reactJsxRuntimeProduction,
        "node_modules/react-dom/package.json": JSON.stringify({
          name: "react-dom",
          exports: {
            ".": { default: "./index.js" },
            "./server": { workerd: "./server.edge.js", default: "./server.node.js" }
          }
        }),
        "node_modules/react-dom/index.js": reactDomProduction,
        "node_modules/react-dom/server.edge.js": `const edge = require("./cjs/react-dom-server.edge.production.js");
const legacy = require("./cjs/react-dom-server-legacy.browser.production.js");

exports.version = edge.version;
exports.renderToReadableStream = edge.renderToReadableStream;
exports.renderToString = legacy.renderToString;
exports.renderToStaticMarkup = legacy.renderToStaticMarkup;
exports.resume = edge.resume;
`,
        "node_modules/react-dom/cjs/react-dom-server.edge.production.js": reactDomServerEdgeProduction,
        "node_modules/react-dom/cjs/react-dom-server-legacy.browser.production.js": reactDomServerLegacyBrowserProduction
      }
    });

    expect(build.ok, JSON.stringify(build.diagnostics, null, 2)).toBe(true);
    expect(build.modules?.["src/index.js"]).toContain("from \"/node_modules/react/index.js\"");
    expect(build.modules?.["src/index.js"]).toContain("from \"/node_modules/react-dom/server.edge.js\"");
    expect(build.modules?.["node_modules/react-dom/cjs/react-dom-server.edge.production.js"]).toMatchObject({
      cjs: expect.stringContaining('require("/node_modules/react/index.js")')
    });

    const worker = loadDynamicWorker(workerEnv.LOADER, `react-resolver-${id++}`, build, {
      compatibilityDate: "2026-06-30"
    });
    const response = await worker.getEntrypoint().fetch(new Request("http://worker/"));
    await expect(response.json()).resolves.toEqual({
      version: "19.2.7",
      streamed: "<div>hello resolver react</div>",
      legacy: "<div>hello resolver react</div>"
    });
  });
});
