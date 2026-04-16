# Argus Frontend

Minimal notes for local development and deploy.

Development

- Install: `npm install`
- Start dev server: `npm run dev`
- Build: `npm run build`

Deploy

- Build then deploy to Pages: `npm run deploy` (runs `wrangler pages deploy dist`)
- Ensure `VITE_WORKER_URL` is set in `wrangler.jsonc` or in the Pages project settings.

See the repository root README for full details: [README.md](../README.md)
