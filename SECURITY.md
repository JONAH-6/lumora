# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately using GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue, pull request or discussion for a suspected vulnerability.

Include what you found, the affected file or endpoint, steps to reproduce, and the impact you expect. We will acknowledge the report and keep you updated in the private advisory thread.

## Supported versions

Lumora has no tagged releases yet. Only the latest commit on `main` is supported.

## Threat model

This section describes what the code does today. Items under "Known gaps" are not protected and are listed so operators can plan around them. Lumora is early software and has not been audited; run it on testnet unless you accept these gaps.

### What the router does

The paid path is `apps/router/src/routes/gateway.ts` with checks in `apps/router/src/x402/verify.ts` and `apps/router/src/stellar/horizon.ts`.

- **Challenge and request ID.** An unpaid call gets an HTTP 402 with a generated `requestId`. The router keeps it in an in-memory map with an expiry of `PAYMENT_EXPIRY_SECONDS` (default 300). A paid retry must send `X-Request-ID`, and it must be a known, unexpired ID issued for the same service.
- **Replay.** The `payments` table uses `tx_hash` as primary key and `request_id` as UNIQUE. A transaction hash that is already recorded is rejected, and a concurrent double-submit that passes verification is stopped by the UNIQUE constraint on insert.
- **Memo spoofing.** The transaction memo fetched from Horizon must equal the `requestId` for this request.
- **Amount.** The paid amount is compared with the service price as integer stroops parsed from strings. Underpayment is rejected; overpayment is accepted.
- **Destination, sender and asset.** The payment must go to `ROUTER_WALLET_PUBLIC`, the sender must match the `from` in the proof, and the asset must be `USDC` from `USDC_ISSUER`.
- **Age.** The Horizon transaction timestamp must be no older than `PAYMENT_EXPIRY_SECONDS`.
- **Admin routes.** `/admin/*` requires an `X-Admin-Key` header equal to `ADMIN_API_KEY`. The comparison is a plain string comparison, not constant time.
- **Rate limiting.** An in-memory limiter allows 60 requests per minute per client IP. It resets on restart and is per process.
- **Header stripping.** `X-Payment` and `X-Request-ID` are removed before the request is proxied upstream.

### Known gaps

- **SSRF via `upstreamUrl`.** A registered service's `upstreamUrl` is only validated as a URL (`apps/router/src/routes/admin.ts`). There is no allowlist and no block on loopback, private or link-local addresses, so a holder of the admin key can point the router at internal hosts. Treat the admin key as fully trusted until this is fixed. The registration API is admin-only, so this is not reachable by anonymous callers.
- **Unauthenticated PDF service.** `services/pdf` has no authentication and is published on port 3002 by `docker-compose.yml`. Anyone who can reach it bypasses the paywall. In addition, its `url` input is fetched server-side with no address restrictions (also SSRF), and the request body limit is 50 MB. Do not expose port 3002 publicly; keep it on an internal network.
- **Agent spend limits.** The MCP server (`apps/mcp`) does not enforce a per-call or daily spending cap. The Soroban spending-policy contract exists in `contracts/`, but the router's `notifySpend` call is currently a stub that does nothing beyond a debug log, so no on-chain limit is applied. A compromised or misled agent can spend everything its wallet holds.
- **Default admin key.** `docker-compose.yml` falls back to `ADMIN_API_KEY=change-me` when the variable is unset. Always set a strong key.
- **Payment verification scope.** Verification uses the first `payment` operation of the transaction. The code does not explicitly check the transaction's success flag, and path payments are not handled. Multi-operation transactions are not specifically considered.
- **Pending state is in memory.** Issued request IDs are lost on restart, and the rate limiter and pending map are per process, so running multiple router instances is not supported as-is.
- **Amount checked from Horizon, not the proof.** The proof's `amount` field is recorded but the verification uses the on-chain amount. The recorded `amount_raw` may therefore differ from what was actually paid.
- **Secrets in environment.** The router hot wallet secret is read from an environment variable. Use a dedicated low-balance wallet.

If you find something not listed here, please report it as described above.
