# SpendGuard backend

The complete agent/policy/grant/swap workflow is documented in the [project README](../README.md), [API contracts](docs/workflow.md), and [phase status](docs/phase-status.md). Run `npm run setup:dev` once to generate the private grant-encryption key. Live execution is disabled by default; use the [controlled-mainnet runbook](docs/mainnet-validation.md) for real validation.

Run `npm install`, copy `.env.example` to `.env`, and configure NEAR AI and MongoDB for the transaction analysis API. Use `npm run dev` for development, `npm test` for offline tests, and `npm run build` for the production build.

## Backend domain models (Phase 2)

User, wallet, agent, versioned policy, and grant models now support the planned swap workflow. The existing transaction collection also stores owner-linked operations with exact token amounts, quote snapshots, approval metadata and execution status. See [the model contracts and implementation notes](docs/domain-models.md) for ownership, secure grant references, indexes, compatibility and the boundaries of this phase.

The User/Wallet portion preserves authenticated identity values, keeps owner and wallet identifiers immutable, and validates verification/revocation evidence. Unverified candidate wallets do not claim addresses globally; proven ownership is protected by a partial unique index. See [User and wallet persistence](docs/domain-models.md#user-and-wallet-persistence) for the contract and the index migration note if you already provisioned the earlier draft.

## Wallet ownership verification (Phase 3)

The frontend now connects through a reviewed NEP-413 message signed in Meteor Wallet. The backend verifies the signature and full-access key, links the wallet to the existing user model, and issues a revocable HttpOnly session. Set `NEAR_NETWORK_ID`, optionally `NEAR_RPC_URL`, and an exact `CLIENT_URL`; a configured MongoDB database is required. See [wallet setup, API, security rules, and validation](docs/wallet-verification.md). No access keys or transactions are created by this flow.

## Agents on Intents client

Set `AGENTS_ON_INTENTS_PARTNER_API_KEY` in **backend/.env** to the partner key issued by Agents on Intents. The base URL defaults to `https://api.agentsonintents.com`; overrides must be an HTTPS origin. `AGENTS_ON_INTENTS_TIMEOUT_MS` defaults to 35,000 milliseconds (maximum 120,000), allowing the provider's 30-second status wait.

Import `agentsOnIntentsClient` from `src/services/agents-on-intents.client.ts` in backend services. It sends the configured partner key as `X-API-Key` on every request. A missing key produces `INTENTS_NOT_CONFIGURED` when called; the key is optional for starting the existing analysis API.

```ts
import { agentsOnIntentsClient } from './services/agents-on-intents.client.js'

const result = await agentsOnIntentsClient.get('/v1/status', {
  query: { correlation_id: correlationId, wait_ms: 0 },
  signal: abortController.signal,
})
```

`get(path, options)` and `post(path, body, options)` accept relative `/v1/` paths. Pass query parameters through `options.query`. Responses retain the provider's JSON structure and snake_case names; endpoint services should validate the response shape before using it. An optional TypeScript type parameter describes the expected result and does not perform runtime validation.

For POST requests, pass a stable `options.idempotencyKey` for the logical operation and, for delegated agent actions, `options.grantToken` for `X-Grant-Token`. The client does not generate idempotency keys, retry requests, follow redirects, sign intents, or execute transactions automatically. An uncertain outcome must be checked using the original `correlation_id`; do not resubmit with a new idempotency key.

Upstream HTTP errors throw `AgentsOnIntentsApiError`, an `AppError` that works with the existing error handler. `upstreamStatus` and sanitized `providerCodes` retain the HTTP status and `errors[].code` values for backend decisions. Provider titles, details, headers, raw responses, and transport error causes are excluded from errors. Timeouts and caller cancellation produce `INTENTS_TIMEOUT` and `INTENTS_REQUEST_ABORTED` respectively.

Keep partner keys and grant tokens on the backend. Never put them in `VITE_` variables, browser requests, query strings, or logs. The existing transaction analysis flow does not call this client automatically.

Provider contract: [Agents on Intents OpenAPI specification](https://api.agentsonintents.com/openapi.json).
