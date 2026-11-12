# SpendGuard backend

Run `npm install`, copy `.env.example` to `.env`, and configure NEAR AI and MongoDB for the transaction analysis API. Use `npm run dev` for development, `npm test` for offline tests, and `npm run build` for the production build.

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
