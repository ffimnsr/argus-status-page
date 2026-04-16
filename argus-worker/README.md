# Argus Worker

Quick notes for local development and deployment.

Development

- Install: `npm install`
- Generate runtime config: `npm run generate-config`
- Start local Worker: `npm run dev`

Deploy

- Generate config and deploy: `npm run predeploy && npm run deploy`
- Use `wrangler secret put NAME` to add any required secrets.

See the repository root README for full details: [README.md](../README.md)
