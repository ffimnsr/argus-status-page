import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Provide an in-memory KV namespace for tests
          kvNamespaces: ["STATUS_KV"],
        },
      },
    },
  },
});
