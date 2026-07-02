# Worker Loader example

Transforms a TypeScript module with `workerd-oxc` and runs the output as a
[Dynamic Worker](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/)
via the Worker Loader binding.

The Worker:

1. calls `createOxc()` and transforms an inline TS source string,
2. builds a Worker Loader definition by hand,
3. loads it with `env.LOADER.get(...)` and forwards the request to it.

Loader wiring lives entirely in this example — `workerd-oxc` does not ship
Worker Loader helpers.

```sh
wrangler dev --config examples/worker-loader/wrangler.jsonc
```
