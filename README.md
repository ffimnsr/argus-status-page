# Argus Status Page

Monorepo for the Argus Status Page project. Contains two packages:

- `argus-frontend` — Vite + TypeScript frontend intended for Cloudflare Pages.
- `argus-worker` — Cloudflare Workers backend logic and KV helpers.

## Quick start

Prerequisites:

- Node.js (recommended LTS)
- npm
- Wrangler CLI configured with your Cloudflare account (`npm i -g wrangler`)

From the repo root:

1. Install dependencies in each package:

   - `cd argus-frontend && npm install`
   - `cd ../argus-worker && npm install`

2. Run locally:

   - Frontend (dev server): `cd argus-frontend && npm run dev`
   - Worker (local dev): `cd argus-worker && npm run dev`

## Frontend (argus-frontend)

Location: [argus-frontend](argus-frontend)

Key scripts (see `package.json`):

- `npm run dev` — start Vite dev server
- `npm run build` — run TypeScript typecheck and build
- `npm run preview` — preview production build locally
- `npm run deploy` — deploy built site to Cloudflare Pages (runs `wrangler pages deploy dist`)

Environment:

- The frontend expects a `VITE_WORKER_URL` variable (configured in `wrangler.jsonc` or in your Pages project settings). For local development create a `.env` from `.env.example` if present and set `VITE_WORKER_URL` to your worker URL.

Deploying to Cloudflare Pages:

1. Build the frontend: `cd argus-frontend && npm run build`
2. Deploy: `npm run deploy` (this calls `wrangler pages deploy dist`)

Alternatively, configure the Cloudflare Pages project to build using the repo and set the `VITE_WORKER_URL` secret in the Pages UI (or via API) to point to your deployed worker.

## Backend (argus-worker)

Location: [argus-worker](argus-worker)

Key scripts (see `package.json`):

- `npm run dev` or `npm start` — run `wrangler dev` for local Worker testing
- `npm run generate-config` — helper that generates the runtime config used by the Worker
- `npm run deploy` — deploy the Worker: runs `wrangler deploy`
- `npm run cf-typegen` — generate Wrangler types (`wrangler types`)

Deploying the Worker:

1. Ensure your `wrangler.toml`/`wrangler.jsonc` and any binding configs are set up (see `argus-worker/wrangler.jsonc` and `config.toml.template`).
2. Run the predeploy step to generate config: `cd argus-worker && npm run predeploy`
3. Deploy: `npm run deploy`

Notes:

- The Worker uses a `generate-config` script before dev/deploy to produce `_config.generated.ts` from templates. Keep the generated file in source control only as configured by the project.
- Use `wrangler secret put NAME` to add secrets required by your Worker.

## Testing & linting

- Frontend: `cd argus-frontend && npm run typecheck` and `npm run lint`
- Worker: `cd argus-worker && npm run test`

## Contributing

- Follow the existing code style. Run the format/lint tasks before submitting PRs.

## License

This repository is available under the MIT License. See [LICENSE](LICENSE).
