# AGENTS.md — OrderRestro

## Integrating OrderRestro into a website or app
Read [`prompts/AI_INTEGRATION_PROMPT.md`](prompts/AI_INTEGRATION_PROMPT.md). Essentials:
- Websites use the **Integration API** (`/api/v1/integrations`, `ordr_ext_…` scoped keys), called **server-side only**.
- MCP (`/api/v1/mcp`) uses **personal staff keys** that inherit a person's permissions; never ship one in a website.
- OrderRestro is self-hosted: ask for the instance URL and key; never invent them or commit them.
- The API places orders but does not capture payment. Show "paid" only if the API says so.
- Exact schemas: [`docs/integrations-api.md`](docs/integrations-api.md), [`docs/website-integration.md`](docs/website-integration.md).

## Working on this repo
See `README.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`. Default branch is `master`. No Co-Authored-By trailers.
