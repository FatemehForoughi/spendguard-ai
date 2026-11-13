# Phase 2: backend domain models

Phase 2 adds persistence contracts for the swap workflow. The existing NEAR AI
analysis service, response types, provider client, and frontend remain compatible.
These schemas do not authenticate a caller, verify a signature, resolve secrets,
call provider endpoints, or authorize execution. Those services belong to the
subsequent implementation phases.

Import models and their inferred TypeScript types from `src/models/index.ts`.
All top-level models use MongoDB ObjectIds, timestamps, and optimistic concurrency
for document saves.

## Records and relationships

| Model | Association and purpose |
| --- | --- |
| `User` | Minimal association to an authenticated identity via unique `(authIssuer, authSubject)`. Identity values are preserved exactly and immutable. No password or session system is introduced. The future authentication service supplies both fields from a verified identity, never an untrusted request body. |
| `Wallet` | Required immutable `ownerUserId`, network and address. Unique `(ownerUserId, network, address)` prevents duplicate owner records. A partial unique `(network, address)` index claims an address globally only after proof is recorded. Defaults to `UNVERIFIED`; verification requires method, proof reference, and timestamp. Revocation is retained for auditing. |
| `Agent` | Required owner and wallet references, name and `SWAP` operation type. Starts `PENDING`; `ACTIVE` requires `externalAgentId`. Provider IDs are unique when present. |
| `Policy` | Required owner, agent, explicit version, allowed assets, spending limits and approval preference. Each version is a separate record; policy contents are immutable once saved. The unique indexes allow one version number per agent and one `ACTIVE` policy per agent. |
| `Grant` | Required owner, agent, provider grant ID, policy reference/version, scope, expiry and protected token reference. Defaults to `PENDING`; active records cannot already be expired or revoked when validated. |
| `Transaction` | The existing history collection, extended with owner, agent, and optional `operation`. A swap requires both owner and agent. Anonymous legacy analyses remain valid. |

References are associations, not foreign-key or authorization checks. Future
services must load records under the authenticated owner's ID and verify that
the wallet, agent, policy, grant and operation all belong together. Wallet
verification metadata must only be written after successful backend verification;
an address and metadata supplied by a client are not proof of ownership. Do not
let arbitrary unverified submissions reserve another user's wallet address.

## User and wallet persistence

User identities are opaque provider values: they must be nonblank strings and
are never trimmed or lowercased. Users default to `ACTIVE` and may be `DISABLED`.
The issuer/subject pair cannot be reassigned after persistence. Authentication
must check the user's current state before allowing protected operations.

Wallet network/address strings reject whitespace and preserve casing. This phase
does not validate chain-specific account syntax; the Phase 3 verifier must supply
canonical addresses using the supported chain's documented rules. No default
network, balance, or verified state is inferred. Strict schemas reject private
keys, seed phrases, passwords, and extra fields.

An `UNVERIFIED` record must have no proof or revocation fields, including explicit
null values. A `VERIFIED` record requires all three of `verifiedAt`,
`verificationMethod`, and `verificationReference`, and cannot have `revokedAt`.
`REVOKED` requires `revokedAt`; previously verified records retain the complete
proof tuple, and revocation cannot precede verification. An unverified record can
also be revoked without fabricating proof.

The global address index applies only to records with a date-valued `verifiedAt`,
including verified wallets subsequently revoked. Multiple users can hold an
unverified candidate for the same address; only one can persist a successful
ownership claim. Proof references are server-side audit identifiers, not raw
signatures or client assertions. The future verification service must verify the
signature before storing proof, enforce owner checks and transitions, and handle
duplicate-key races. Model validation alone does not establish control.

## Exact amounts and policy versions

Token amounts use canonical positive integer **strings in base units**, with at
most 256 digits. Numbers, decimals, exponent notation, whitespace, leading zeros
and negative amounts are rejected. Fee amounts additionally allow `"0"`.
Conversion from a user-entered amount using trusted asset decimals is Phase 6 work.

Each allowed source asset must have exactly one entry in `spendingLimits`:

```ts
{
  assetId: 'nep141:usdc.near', // illustrative; resolve actual IDs from a trusted registry
  maxPerOperationBaseUnits: '10000000',
  dailyLimitBaseUnits: '30000000',
}
```

Both values are denominated in that source asset. A daily limit must be at least
the per-operation limit. Distinct assets have independent limits; the schema
does not add unrelated token units together or imply a USD conversion. Spending
amounts and `requiresUserApproval` have no silent defaults.

Policy updates create a new version, rather than changing a historical decision's
limits. A future policy activation service must switch the old and new active
versions atomically. Operations record the exact `policyId` and `policyVersion`
together when a policy decision is made.

## Grant protection

`Grant.tokenSecretRef` is a required `{ store, key }` locator for a token held in a
secure server-side secret store. MongoDB never receives the grant token itself.
No secret-store implementation is selected or configured in this phase; Phase 5
must write the token securely and obtain a locator before creating a grant.

The reference is excluded from queries by default, including `lean()` queries,
and removed by document `toJSON()`, `toObject()` and ordinary inspection. Internal
services may explicitly select `+tokenSecretRef` to resolve it. Such explicitly
selected lean objects are internal data and must not be returned as API responses.
The strict grant and scope schemas reject fields such as `grantToken`, `token`,
or arbitrary provider payloads.

Scope records the supported operation and allowed assets, with a policy version
reference for local spending restrictions. It is an internal representation, not
an assertion about a provider authorization payload. The later integration must
map and verify actual provider scope using current official documentation.

There are no TTL indexes. Expired/revoked grants and their history are retained.
Saving an active grant validates its expiry, but time passing does not update a
document automatically: services must recheck expiry and revocation on every use.

## Transaction compatibility and operation lifecycle

`Transaction.status` remains the NEAR AI risk decision (`ALLOW`, `WARN`, `BLOCK`).
`score`, `message`, `reasons`, `details`, and the analysis API keep their existing
meaning. Legacy records still require an analysis result.

An operation may be saved before an AI result exists, so its risk fields can be
absent. A risk status requires the accompanying score/message; no `ALLOW` result
is synthesized. The existing unique `analysisId` is allocated at creation as the
correlation ID for eventual analysis, not evidence that analysis has completed.

`operation` contains:

- Stable, automatically allocated `operationId` and `idempotencyKey`. They must be
  persisted before calling an execution API and reused from that record on retries.
- Immutable input/output asset IDs and exact input amount.
- An optional quote snapshot with request amounts/assets, estimated output, fees,
  warnings, receipt time, provider reference and optional expiry. Request fields
  must match the operation. No raw response or signing payload is stored here.
- Policy reference/version and grant reference, populated by later checks.
- Approval state, reference, operation digest, owner decision and timestamps.
- Provider operation ID, correlation ID, transaction hash, sanitized error code,
  and submission/completion/reconciliation timestamps.

`operation.executionStatus` defaults to `DRAFT` and supports `PENDING_APPROVAL`,
`PENDING`, `SUCCESS`, `FAILED`, `REFUNDED`, `NEEDS_REVIEW`, `UNCERTAIN`, `BLOCKED`,
and `REJECTED`. These are internal states; provider status mapping is later work.
A quote alone leaves an operation in `DRAFT`. A missing quote expiry is not
permission to use it indefinitely; the quote service must establish freshness.

Approval defaults to `NOT_REQUESTED`. A review requires a quote, reference,
digest and expiry; a decision additionally requires its owner and timestamp.
An approved decision must precede its expiry. The legacy `approved` boolean
remains independent and must never authorize a swap. Phase 9 computes and verifies
the exact review digest; storing a digest here does not verify its content.

These models validate stored data, not the entire transition/security system.
The Phase 8/10 services must enforce policy, grants, risk, quote freshness and
approval before advancing execution. A valid `SUCCESS` field alone is not proof
of provider success.

## Writes, indexes and existing records

Use `Model.create()` or load a document under its owner, modify it, and `save()`.
Use `await document.validate()` for offline validation. Multi-field checks run in
document validation middleware, including protection against nested policy edits.
`validateSync()`, query updates, replacement writes, bulk writes and raw collection
writes do not run all these checks. Future services must not use those write paths
without equivalent validation and concurrency controls; `runValidators: true`
alone is insufficient for document middleware.

MongoDB unique indexes protect identity associations, policy versions and active
policy selection, provider identifiers, operation IDs, and idempotency keys.
Partial indexes exclude missing optional identifiers, allowing multiple legacy
analyses and multiple agents pending provider creation.

Database startup registers all models and waits for `Model.init()` before serving
requests. With the existing Mongoose automatic-index configuration, this creates
the additive indexes and reports conflicts before startup completes. No index is
dropped, and the existing `analysisId` index is unchanged. No backfill, deletion,
or reassignment of anonymous legacy records is required. An environment that
disables automatic indexing must provision these indexes before deployment.

If a database already has the earlier draft's unconditional unique wallet index
on `(network, address)`, replace it with the partial index during an explicit
index migration. Provision the owner-specific index too. Startup does not drop
or replace existing indexes; the earlier index would continue to let unverified
records reserve addresses. Inspect existing records and index names before any
migration. No live migration is performed as part of this model change.

The anonymous list, count and detail endpoints now select only records with no
owner, agent, or operation fields. Existing public analyses remain available.
Owned analyses and swap records require future authenticated endpoints and cannot
be read through the public history routes, even when their IDs are known.

## Verification

The pre-change baseline was 104 passing backend tests and a successful build.
Model tests cover required ownership, states, exact amounts, policy version
protection, grant-reference protection, quote/approval consistency and index
declarations. HTTP regression tests exercise the legacy analysis save path and
public-history filtering through the actual Mongoose query layer with mocked
collection methods.

Run `npm test` and `npm run build` from `backend` (`npm.cmd` in PowerShell when
script execution is disabled). Tests are offline: no MongoDB server, provider
request, wallet signature or transaction execution is used. Live database index
creation and server-side uniqueness still need verification against a configured
development database before the later persistence workflows are deployed.

`tests/user-wallet-models.test.mjs` additionally checks exact authenticated
identities, immutable owner/address associations, invalid and incomplete proof
metadata, revocation chronology, candidate-versus-verified index declarations,
credential rejection, and validation through the real Mongoose save path with
mocked collection writes. These tests do not verify wallet signatures or live
MongoDB uniqueness; those checks belong to the subsequent integration work.
