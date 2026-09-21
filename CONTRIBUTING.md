# Contributing to Lumora

Thanks for helping out. This guide covers local setup, how to run each service, and what we expect in a pull request. Please also read the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through the process in [SECURITY.md](SECURITY.md), not public issues.

## Prerequisites

- Node.js 22 or newer (`engines.node` is `>=22`)
- pnpm 10 (the repo pins `pnpm@10.33.0` via `packageManager`; `corepack enable` will pick it up)
- Docker and Docker Compose, only if you want the full containerised stack
- Rust with the `wasm32-unknown-unknown` target and the Stellar CLI, only for work on `contracts/spending-policy`
- A funded Stellar testnet wallet for the router, and one for the agent if you run the MCP server (see [Stellar Lab](https://lab.stellar.org))

## Setup

```bash
git clone https://github.com/<your-fork>/lumora
cd lumora
pnpm install
cp apps/router/.env.example apps/router/.env   # fill in the values below
```

## Environment variables

The full table is in the [README](README.md#environment-variables). The ones you need to get running:

| Variable | Used by | Notes |
|---|---|---|
| `ROUTER_WALLET_PUBLIC` / `ROUTER_WALLET_SECRET` | router | Testnet hot wallet that receives payments |
| `ADMIN_API_KEY` | router | Sent as `X-Admin-Key` on `/admin/*` |
| `STELLAR_HORIZON_URL`, `STELLAR_RPC_URL`, `USDC_ISSUER` | router | Required by the router config; the values in `.env.example` target testnet |
| `PDF_SERVICE_URL`, `PDF_SERVICE_URL_JSON` | router | Where the seeded PDF services are proxied to (defaults in `.env.example` point at `localhost:3002`) |
| `PDF_SERVICE_PORT` | pdf | Defaults to `3002` |
| `AGENT_WALLET_SECRET`, `ROUTER_URL` | mcp | Agent wallet and router address |
| `NEXT_PUBLIC_ROUTER_URL` | marketplace | Router URL as seen by the browser |

Never commit `.env` files or real secret keys. Use testnet keys only while developing.

## Running the services

Each service runs from its own directory with `pnpm dev`.

```bash
# Router (Express, :3001)
cd apps/router && pnpm dev

# PDF service (Fastify, :3002)
cd services/pdf && pnpm dev

# MCP server (stdio; needs AGENT_WALLET_SECRET and ROUTER_URL)
cd apps/mcp && pnpm dev

# Marketplace (Next.js, :3000)
cd apps/marketplace && pnpm dev
```

To use the MCP server from an agent, build it with `cd apps/mcp && pnpm build` and follow [MCP Setup](README.md#mcp-setup-claude-code) in the README.

For the whole stack in containers: `cp .env.example .env`, fill in the wallet keys and `ADMIN_API_KEY`, then `docker compose up --build`.

Smart contract work lives in `contracts/spending-policy`; use `make build` and `make test` from that directory.

## Checks

From the repo root:

```bash
pnpm type-check
pnpm build
pnpm test
```

Run `pnpm type-check` and `pnpm build` before opening a PR. `pnpm test` and `pnpm lint` run through Turborepo and only execute in packages that define those scripts, so most packages currently have nothing to run. If you add tests, wire them into the package's `test` script.

## Branches and commits

- Fork the repo and branch from `main`. Use a short prefix: `feat/`, `fix/`, `docs/`, `chore/`.
- Keep one logical change per pull request.
- Write commits in [Conventional Commits](https://www.conventionalcommits.org/) style, scoped where it helps: `fix(router): forward request bodies on paid POSTs`, `docs: add security policy`.
- Update your branch with `git rebase main`, not merge commits.

## Pull request checklist

- [ ] The PR is focused and links its issue with `Resolves #<number>`
- [ ] `pnpm type-check` and `pnpm build` pass locally
- [ ] Behaviour changes are covered by tests where a test setup exists, or the PR explains how you checked them
- [ ] Docs (README, `docs/`) are updated if setup, env vars or API behaviour changed
- [ ] No secrets, `.env` files, `.db` files or build output are committed
- [ ] Changes touching payment verification (`apps/router/src/x402`, `apps/router/src/stellar`) explain how replay, memo and amount checks are affected

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
