# Lumora

Open-source x402 payment gateway for AI agents on Stellar. Service providers wrap any REST API with a per-request USDC paywall. AI agents discover and pay autonomously — no sign-up, no API keys, just a Stellar wallet.

```
AI Agent (Claude Code)
    │ MCP: list_services / call_service
    ▼
Lumora MCP Server  ─────────────────────────────────┐
    │ HTTP 402 → pay USDC → retry with proof         │
    ▼                                                 │
Lumora Router (:3001) ──proxy──▶ Services (PDF, etc) │
    │ Horizon verify + SQLite dedup                   │
    ▼                                                 │
Stellar Network + Soroban Spending Policy ◀──────────┘
```

**Demo vertical:** PDF text extraction and structured JSON output, paid per-request in USDC.

---

## What problem does this solve?

- **Agents can't pay for APIs.** Every external service requires API keys, OAuth, or a credit card. Agents hit a wall for anything outside their context window.
- **Providers can't monetize per-call.** Building billing infrastructure for a single endpoint is expensive and slow.
- **x402 has no self-hostable reference.** The protocol works; the open-source gateway doesn't exist yet.

Lumora is that gateway.

---

## Monorepo Structure

```
lumora/
├── apps/
│   ├── router/         Express 5 — x402 gateway, SQLite registry, payment verifier
│   ├── mcp/            MCP server — AI agent interface (stdio, Claude Code compatible)
│   └── marketplace/    Next.js 15 — browse services, register providers
├── services/
│   └── pdf/            Fastify 5 — PDF text extraction (pdfjs-dist, no native deps)
├── packages/
│   └── types/          Shared TypeScript interfaces
├── contracts/
│   └── spending-policy/ Soroban Rust contract — agent daily budget management
├── docs/
│   ├── PRD.md
│   └── ARCHITECTURE.md
├── docker-compose.yml
├── .env.example
└── package.json
```

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Router | Express 5 | Async error handling, familiar |
| PDF service | Fastify 5 | Lighter, faster |
| Database | SQLite (better-sqlite3) | Zero setup, runs anywhere, no Postgres/Redis |
| PDF parsing | pdfjs-dist | Pure JS, no native binaries |
| MCP | @modelcontextprotocol/sdk | Official Anthropic SDK |
| Stellar | @stellar/stellar-sdk 14.6.1 | Payment submission + Horizon verification |
| Frontend | Next.js 16 | SSR marketplace |
| Contracts | Soroban SDK 25 | On-chain spending policy |
| Monorepo | pnpm + Turborepo | Fast builds, workspace dependencies |

**No Redis. No Postgres. No message queues.**

---

## Prerequisites

- Node.js 22+
- pnpm 10+
- Docker + Docker Compose (for full stack)
- Rust + `wasm32-unknown-unknown` target (for Soroban contracts only)
- Stellar CLI 25+ (for contract deploy only)
- A funded Stellar testnet wallet (use [Stellar Lab](https://lab.stellar.org) to generate + fund)

---

## Quick Start (Docker)

```bash
git clone https://github.com/harystyleseze/lumora
cd lumora

# Copy and fill in your Stellar wallet keys
cp .env.example .env
# Edit ROUTER_WALLET_PUBLIC, ROUTER_WALLET_SECRET, ADMIN_API_KEY

docker compose up --build
```

Services:
- Marketplace: http://localhost:3000
- Router API: http://localhost:3001
- PDF Service: http://localhost:3002

---

## Quick Start (Local Dev)

```bash
pnpm install

# Terminal 1 — Router
cd apps/router
cp .env.example .env  # fill in your keys
pnpm dev

# Terminal 2 — PDF service
cd services/pdf
pnpm dev

# Terminal 3 — Marketplace
cd apps/marketplace
pnpm dev
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ROUTER_WALLET_PUBLIC` | Yes | Router hot wallet public key (receives payments). Must be a valid Stellar Ed25519 public key ("G...") |
| `ROUTER_WALLET_SECRET` | Yes | Router hot wallet secret key. Must be a valid Stellar secret seed ("S...") that derives `ROUTER_WALLET_PUBLIC` |
| `ADMIN_API_KEY` | Yes | Key for `X-Admin-Key` header on admin routes. On `STELLAR_NETWORK=mainnet`, must not be the default `change-me` and must be at least 24 characters |
| `STELLAR_NETWORK` | No | `testnet` (default) or `mainnet` |
| `STELLAR_HORIZON_URL` | No | Default: Horizon testnet |
| `USDC_ISSUER` | No | Default: testnet USDC issuer. Must be a valid Stellar Ed25519 public key ("G...") |
| `PAYMENT_EXPIRY_SECONDS` | No | Default: 300 |
| `DATABASE_PATH` | No | Default: `./lumora.db` |
| `AGENT_WALLET_SECRET` | MCP only | Agent's Stellar secret key |
| `SPENDING_POLICY_CONTRACT_ID` | Optional | Soroban contract address |
| `ROUTER_INTERNAL_URL` | Docker only | Internal router URL for server-side Next.js fetches (set automatically by docker-compose to `http://router:3001`) |

---

## MCP Setup (Claude Code)

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "lumora": {
      "command": "node",
      "args": ["/path/to/lumora/apps/mcp/dist/index.js"],
      "env": {
        "ROUTER_URL": "http://localhost:3001",
        "AGENT_WALLET_SECRET": "SAGENT...",
        "STELLAR_NETWORK": "testnet",
        "STELLAR_HORIZON_URL": "https://horizon-testnet.stellar.org"
      }
    }
  }
}
```

Then build the MCP server:

```bash
cd apps/mcp && pnpm build
```

In Claude Code:
```
"Extract text from https://example.com/sample.pdf"
```

Claude calls `list_services` → selects `pdf-extract-text` → calls `call_service` → auto-pays 0.05 USDC → returns extracted text.

---

## Router API Reference

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | — | Health check |
| `GET` | `/services` | — | List all enabled services |
| `GET` | `/services/:id` | — | Service detail + stats |
| `POST` | `/services/:id` | — | Call service (x402 gateway) |
| `POST` | `/admin/services` | X-Admin-Key | Register a new service |
| `DELETE` | `/admin/services/:id` | X-Admin-Key | Remove a service |
| `GET` | `/admin/services` | X-Admin-Key | List all services (incl. disabled) |

### Register a service

```bash
curl -X POST http://localhost:3001/admin/services \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: your-admin-key" \
  -d '{
    "id": "my-api",
    "name": "My API",
    "description": "Does something useful",
    "upstreamUrl": "http://my-service:8080/endpoint",
    "priceUsdc": "0.10",
    "tags": ["api", "useful"]
  }'
```

### Manual x402 flow

```bash
# Step 1: Get 402 challenge
curl -X POST http://localhost:3001/services/pdf-extract-text \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/sample.pdf"}'
# → HTTP 402 with requestId + payTo address

# Step 2: Pay on Stellar (memo = requestId), get txHash

# Step 3: Retry with proof
curl -X POST http://localhost:3001/services/pdf-extract-text \
  -H "Content-Type: application/json" \
  -H "X-Payment: <base64-proof>" \
  -H "X-Request-ID: req_abc123" \
  -d '{"url": "https://example.com/sample.pdf"}'
```

---

## Soroban Spending Policy

```bash
cd contracts/spending-policy

# Build
make build

# Test
make test

# Deploy to testnet
export STELLAR_SECRET=SROUTER...
make deploy
```

Functions:

```
set_limit(agent, daily_limit_stroops)   — agent signs; set 0.05 USDC = 500000
get_limit(agent) → i128
is_within_limit(agent, amount) → bool   — free simulation, no auth
record_spend(agent, amount, service_id) — agent signs after success
get_daily_spent(agent) → i128
get_remaining(agent) → i128
```

Day number = `ledger_sequence / 17280` ≈ 24h on Stellar mainnet.

---

## Production Deployment

**1. Generate a Stellar hot wallet for the router**
```bash
stellar keys generate router --network testnet
stellar keys address router
# Fund it: https://lab.stellar.org/account/fund
```

**2. Set environment variables**
```bash
cp .env.example .env
# Fill: ROUTER_WALLET_PUBLIC, ROUTER_WALLET_SECRET, ADMIN_API_KEY
```

**3. Deploy with Docker Compose**
```bash
docker compose up -d --build
```

**4. Verify services are healthy**
```bash
curl http://localhost:3001/health   # {"status":"ok"}
curl http://localhost:3001/services # lists pdf-extract-text + pdf-to-json
```

**5. Configure MCP server for agents**
```bash
cd apps/mcp && pnpm build
# Add to ~/.claude.json (see MCP Setup above)
```

---

## Workspace Scripts

From the repo root:

| Script | Description |
|---|---|
| `pnpm dev` | Start all packages in dev mode (turbo) |
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests |
| `pnpm type-check` | TypeScript type check across all packages |
| `pnpm clean` | Remove all `dist/` and `.next/` artifacts |

---

## Further Reading

- [PRD](docs/PRD.md) — Full product requirements, x402 flow, anti-replay design
- [Architecture](docs/ARCHITECTURE.md) — Component map, DB schema, key file reference
- [Contributing](CONTRIBUTING.md) — Dev setup, conventions, PR checklist
- [Security Policy](SECURITY.md) — How to report vulnerabilities, threat model and known gaps
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [x402 Protocol Spec](https://x402.org)
- [Stellar Horizon API](https://developers.stellar.org/docs/data/horizon)
- [Soroban SDK](https://developers.stellar.org/docs/tools/developer-tools/soroban-sdk)
- [MCP SDK](https://github.com/modelcontextprotocol/sdk)

---

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first and follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately as described in [SECURITY.md](SECURITY.md).

---

## License

Lumora is released under the [MIT License](LICENSE).
