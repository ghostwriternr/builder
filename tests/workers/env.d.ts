import type { WorkerLoaderBinding } from "../../src/types";

declare global {
  namespace Cloudflare {
    interface Env {
      LOADER: WorkerLoaderBinding;
    }
  }
}

export {};
