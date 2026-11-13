# Agent and swap API contracts

All workspace routes live under `/api/workspace`. They use the existing HttpOnly wallet session; the current wallet must own the agent. Mutations require an exact configured `Origin`, no-store responses, bounded request bodies, and per-process rate limits. IDs are validated before database access. Unknown errors expose sanitized application codes only.

| Method/path | Behavior |
| --- | --- |
| GET `/config` | Whether live execution is enabled; no credentials |
| GET `/summary` | Current wallet's agent and operation totals |
| GET `/tokens` | Validated provider asset catalog and decimals |
| GET `/agents` | Up to 100 current-wallet agents |
| POST `/agents` | `requestId`, `name`, complete `policy`; saves pending agent and owner creation intent |
| GET `/agents/:id` | Agent, policy versions, redacted grants, and owner authorizations |
| GET `/agents/:id/balances` | Available balances from the policy-selected provider source |
| POST `/agents/:id/policies` | Prepares a new signed policy version using the provider's expected revision |
| POST `/agents/:id/grants` | `label`, `expiresAt`; generates an encrypted credential and owner-signed commitment |
| POST `/agents/:id/grants/:grantId/revoke` | Immediately revokes locally and prepares provider revocation |
| POST `/intents/:id/submit` | Exact generated `payload`, registered `publicKey`, base64 `signature` |
| POST `/intents/:id/reconcile` | `{ refresh: false }`; checks the original correlation |
| POST `/intents/:id/retry-generation` | Explicitly retries uncertain preparation with the original body/key |
| POST `/intents/:id/retry-submission` | Observes original status and recovers the identical stored signature only if the provider still needs it |
| POST `/intents/:id/cancel` | Cancels unsigned local authorization; cannot cancel submitted/uncertain work |
| GET `/operations?page=1&limit=20` | Current-wallet operation history with pagination |
| POST `/operations` | `requestId`, `agentId`, `inputAssetId`, `outputAssetId`, decimal `amount`, decimal `minimumOutputAmount` |
| GET `/operations/:id` | One owned swap; `id` is its UUID |
| POST `/operations/:id/decision` | `reference`, `digest`, `verdict: approve/reject`; atomically binds one decision |
| POST `/operations/:id/refresh` | Fresh quote/risk/approval before any dispatch; does not change operation identity |
| POST `/operations/:id/execute` | Revalidates controls and commits at most one dispatch |
| POST `/operations/:id/reconcile` | `{ refresh: false }`; observes original submitted swap |
| POST `/operations/:id/provider-approval` | `verdict`; reviews and prepares a wallet vote for the exact provider-held request |

Policies contain source/destination lists, one exact atomic limit per source asset, `requiresUserApproval`, and `balanceSource: public/confidential`. The UI currently configures one asset pair per proposal. Provider policies permit only swaps, explicitly cap per-transaction and daily amounts, and keep withdrawals/transfers/native signing disabled. Provider grants identify a grantee; they do not narrow its policy. SpendGuard separately records a scope and requires the grant to match the current local policy version, owner, expiry, and remote grant commitment.

## Quotes and approvals

The deployed OpenAPI intentionally leaves the provider `quote` object untyped. SpendGuard recognizes the documented `amount_out` estimate when present and a usable `expires_at` when present; absent fields are displayed as unavailable. The server sets a separate two-minute **review** deadline. It never represents that local deadline as a guaranteed provider quote expiry.

The execution endpoint does not accept a quote reference. Approval therefore binds the exact executable request: asset IDs, atomic input amount, positive minimum output, balance source, local operation ID, policy version, grant, and normalized quote/risk context. The backend requests another dry quote immediately before dispatch. Changed estimated output, fees, USD spend, approval requirement, or warnings require a new review. The provider must enforce the signed/requested minimum output; received output below the minimum enters `NEEDS_REVIEW` even if upstream reports success.

Wallet approval at the provider may follow the local preview approval. The provider-held request is checked against the exact execution body before generating `approval_vote`. That wallet signature is reviewed separately and submitted unchanged. Successful approval is followed by settlement reconciliation; it is not itself evidence of received funds.

## Concurrency and uncertainty

An atomic MongoDB guard serializes dispatch and owner-policy changes per agent across API processes. Once dispatch is committed, the guard does not expire automatically. It stays held through provider approval, pending, uncertainty, and review states. Settled operations release the guard; proven non-execution releases spending usage. Successful, failed without non-execution evidence, and partially refunded operations conservatively count their full input for 24 hours from settlement observation. Unknown work remains reserved indefinitely.

Pending policy changes also have a durable owner-intent guard. A terminal intent clears it. Cancelling cannot clear a submitted intent's guard through a stale read. Policy activation is repeatable and may temporarily leave no active policy after a persistence failure; that state fails closed and is repaired by reconciliation.

Each logical owner-generation and swap request keeps its original idempotency key. Signed intent re-submissions are treated as reconciliation by this API. An ambiguous swap response with a valid correlation retains it even if later response fields are invalid. Without a correlation, automatic resubmission is refused: an operator must recover with the original provider key/body under the provider's documented procedure, establish the outcome, and reconcile persistence. Never clear a guard or manufacture a new key because a request timed out.

The current adapter supports NEP-413 intents only. Other documented wallet standards are refused; no signature is fabricated and no transaction is broadcast as a substitute.

## Credentials and operations

Ordinary repeated owner submissions observe the original status. The explicit `retry-submission` recovery route observes it first and sends the identical stored signature only if the provider still reports `PENDING_SIGNATURE` and the intent/key remain valid.

`createGrantCredential` and `grantCommitment` come from the pinned official provider SDK. A token is `ngt_` plus 32 random base64url bytes; the owner signs its SHA-256 commitment. The token is encrypted with AES-256-GCM, a random 12-byte IV, and the record locator as authenticated associated data. The model keeps only a hidden locator; ciphertext/tag/IV are hidden and never returned by the API.

Preserve `GRANT_ENCRYPTION_KEY` across restarts and replicas. Rotation requires decrypting and re-encrypting every record under a reviewed procedure. Loss of the key requires revoking/reissuing affected grants; storing only a new key cannot repair them.

Only `/execute` and owner-intent submission call real provider mutations. `ENABLE_LIVE_EXECUTION=false` denies swap dispatch server-side, regardless of frontend state. The initial wallet ownership endpoint authorizes no funds. Gateway rate limits are required for production deployments with multiple API processes.
