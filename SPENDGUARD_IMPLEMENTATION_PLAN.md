# SpendGuard --- Step-by-Step Implementation Plan

## Purpose

**Current acceptance record:** See `backend/docs/phase-status.md`. Phases 4–12 are implemented and automated for the supported NEP-413 wallet flow. Phase 3 real Meteor verification and Phase 13 real signing/spending remain unconfirmed; Phase 14 packaging is prepared, with public demo/submission still pending. Do not represent mock settlement as real Mainnet validation.

This document turns the SpendGuard product scenario into an ordered
engineering plan.

The implementation must preserve the existing backend and its current
NEAR AI risk-analysis integration. **Do not add Claude or replace the
existing AI provider.**

The repository already contains an Agents on Intents API client and
environment configuration. Treat that client as an existing foundation,
not as proof that the complete integration is finished.

Work through the phases in order. For each phase, implement the changes,
run the relevant tests, and confirm the acceptance criteria before
moving on.

------------------------------------------------------------------------

## Phase 0 --- Inspect and Baseline the Existing Repository

### Tasks

1.  Inspect the repository structure and identify the frontend and
    backend roots.
2.  Read the backend `package.json`, environment configuration, server
    entry point, routes, models, and services.
3.  Inspect the existing NEAR AI service and its Zod schema.
4.  Inspect the existing `agents-on-intents.client.ts` and its tests.
5.  Review the current transaction model and transaction-analysis
    routes.
6.  Check the current Git status and create a safe working branch or
    checkpoint before making changes.
7.  Install dependencies and run the existing build and test commands.

### Acceptance Criteria

-   The existing backend builds successfully, or any pre-existing
    failures are documented.
-   Existing tests have been run and their results recorded.
-   The current NEAR AI analysis flow is understood and preserved.
-   No secrets are printed, committed, or copied into frontend code.

------------------------------------------------------------------------

## Phase 1 --- Stabilize Configuration and Provider Client

### Tasks

1.  Keep the existing Agents on Intents configuration in the backend
    environment module.
2.  Keep the partner API key server-side.
3.  Review the existing API client behavior for:
    -   Base URL handling.
    -   API-key authentication.
    -   Grant-token support.
    -   Idempotency-key support.
    -   Request timeout and cancellation.
    -   Safe error handling.
    -   Redirect behavior and POST retry behavior.
4.  Add or update unit tests for the client without changing its
    existing public behavior unnecessarily.
5.  Confirm the provider's current API documentation before adding
    endpoint-specific methods.

### Acceptance Criteria

-   The API client can make authenticated requests to the configured
    base URL.
-   Credentials are not exposed to the frontend or logs.
-   Timeouts and provider errors are handled safely.
-   No undocumented endpoint or request payload has been invented.

------------------------------------------------------------------------

## Phase 2 --- Design the Backend Domain Models

### Tasks

Create or extend the data models needed for the workflow.

#### User / Wallet

Store the authenticated user association and verified wallet address.
Use the project's existing authentication model if one already exists;
do not create a duplicate user system unnecessarily.

#### Agent

Suggested fields: - Local agent record ID. - Owner user ID. - Verified
wallet address or wallet reference. - External Agents on Intents agent
ID. - Agent name and supported operation type. - Agent status. - Created
and updated timestamps.

#### Policy

Suggested fields: - Owner user ID. - Agent ID. - Maximum amount per
operation. - Daily spending limit. - Allowed source assets. - Allowed
destination assets. - Whether user approval is required. - Policy status
and version.

#### Grant

Suggested fields: - Owner user ID. - Agent ID. - Provider grant
reference. - Protected grant token or secure secret reference. - Granted
scope. - Expiry and revocation status. - Created and updated timestamps.

Do not store sensitive tokens as ordinary plaintext fields unless the
project's security design explicitly protects them. Prefer encryption or
a secure secret store.

#### Transaction / Operation

Extend the existing transaction model where practical. Avoid creating a
second competing transaction history.

Suggested fields: - Owner user ID and agent ID. - Local operation ID. -
Provider operation ID. - Idempotency key. - Input and output asset
identifiers. - Input amount in exact token units. - Quote reference,
quote data needed for review, and expiry. - NEAR AI risk status and
analysis reference. - Policy version used for the decision. - Approval
status and approval reference. - Execution status. - Transaction hash
and correlation ID, when returned. - Safe provider error code and
timestamps.

### Acceptance Criteria

-   Models enforce required fields and valid state values.
-   Records are associated with their owner.
-   Sensitive grant material is protected.
-   Existing transaction-analysis behavior remains compatible.

------------------------------------------------------------------------

## Phase 3 --- Implement Wallet Ownership Verification

**Implementation status:** Backend challenge/signature/full-access-key verification,
user/wallet association, revocable server sessions, and frontend Meteor Wallet
connection are implemented with automated security and browser tests. Live MongoDB
index enforcement and a real development-wallet proof remain manual integration
validation; no real-wallet signing or transaction is performed by the tests. See
`backend/docs/wallet-verification.md` for setup and validation details.

### Tasks

1.  Identify the wallet connection approach already used by the
    frontend.
2.  Implement the documented ownership-verification flow.
3.  Have the backend issue or validate a challenge where appropriate.
4.  Verify the signature and the wallet address on the backend.
5.  Associate the verified wallet with the authenticated user.
6.  Reject attempts to attach another user's wallet or reuse an invalid
    challenge.
7.  Add tests for valid signatures, invalid signatures, expired
    challenges, and cross-user access.

### Acceptance Criteria

-   A wallet address is not considered verified merely because the
    client submitted it.
-   The backend can verify the required proof of control.
-   Private keys never leave the wallet.
-   User-to-wallet ownership is enforced by the backend.

------------------------------------------------------------------------

## Phase 4 --- Create and Manage Agents

### Tasks

1.  Add backend service methods that call the documented Agents on
    Intents agent-creation flow.
2.  Add an authenticated endpoint to create an agent.
3.  Validate the requested agent configuration.
4.  Create the external agent using the provider's documented request
    format.
5.  Save the external agent ID and local owner association.
6.  Add endpoints to list and retrieve only the current user's agents.
7.  Add frontend screens to create and display agents.
8.  Add tests for provider errors and cross-user access attempts.

### Acceptance Criteria

-   An authenticated user can create an agent.
-   The external agent ID is stored against the correct local owner.
-   A user cannot read or modify another user's agent.
-   Provider failures do not leave misleading active agent records.

------------------------------------------------------------------------

## Phase 5 --- Define Policies and Authorize Agents

### Tasks

1.  Implement policy creation and update endpoints.
2.  Validate amounts, token identifiers, and allowed-asset lists.
3.  Store policy versions so an operation can record which policy was
    applied.
4.  Prepare the authorization intent or payload using the provider's
    current documented flow.
5.  Return the exact payload that the user's wallet must sign.
6.  Have the frontend display the authorization details and request the
    wallet signature.
7.  Submit the signature through the documented provider endpoint.
8.  Store the resulting grant reference and protect any grant token.
9.  Implement grant expiry, revocation, and validity checks.
10. Add tests for invalid scopes, expired grants, revoked grants, and
    owner mismatch.

### Acceptance Criteria

-   The user explicitly authorizes the agent.
-   The backend does not fabricate signatures or modify a payload that
    must be signed exactly.
-   The stored grant belongs to the correct user and agent.
-   Agent permissions are no broader than the policy and provider
    capabilities allow.
-   The backend checks grant validity before protected operations.

------------------------------------------------------------------------

## Phase 6 --- Implement Swap Request Validation and Dry-Run Quote

### Tasks

1.  Define a typed swap request contract.
2.  Validate the authenticated user, agent ownership, source asset,
    destination asset, and amount.
3.  Resolve token identifiers and decimals from a trusted token registry
    or provider source.
4.  Convert amounts using exact integer or decimal-safe arithmetic; do
    not use floating-point arithmetic for token base units.
5.  Check the policy's per-operation and daily limits.
6.  Check available balance using a trusted source, where supported.
7.  Check the grant and its scope.
8.  Request a quote using the documented provider flow with `dry: true`,
    where supported.
9.  Store the quote reference, relevant quote details, and expiry.
10. Return a reviewable preview to the frontend.

### Acceptance Criteria

-   A request outside policy is rejected before execution.
-   Token amounts are represented safely and accurately.
-   The quote is clearly identified as a preview, not an executed
    transaction.
-   Quote freshness can be checked later.
-   The exact provider payload follows current documentation.

------------------------------------------------------------------------

## Phase 7 --- Integrate the Existing NEAR AI Risk Analysis

### Tasks

1.  Reuse the current NEAR AI client and analysis service.
2.  Keep the existing `ALLOW`, `WARN`, and `BLOCK` decision values.
3.  Provide the model with the relevant swap request, quote details, and
    context supported by the current analysis design.
4.  Preserve the existing response schema and validation.
5.  Extend the schema compatibly only if the product genuinely requires
    additional fields.
6.  Store the analysis result and its reference with the operation.
7.  Treat timeouts, invalid JSON, and schema failures as a safe
    review/error state such as `NEEDS_REVIEW`.
8.  Add tests for all three decisions and AI service failures.

### Acceptance Criteria

-   No Claude dependency or Claude API key is introduced.
-   Existing NEAR AI transaction analysis still works.
-   Swap analysis uses the existing NEAR AI integration.
-   An AI `ALLOW` result does not bypass backend policy or authorization
    checks.
-   An AI failure never becomes an implicit approval.

------------------------------------------------------------------------

## Phase 8 --- Build the SpendGuard Security Decision Layer

### Tasks

Implement a backend decision service that evaluates all mandatory checks
in a predictable order.

Checks should include: 1. Authenticated user. 2. Wallet verification and
ownership. 3. Agent ownership and status. 4. Grant validity, scope, and
expiry. 5. Policy status and version. 6. Allowed source and destination
assets. 7. Per-operation spending limit. 8. Daily spending limit. 9.
Balance and other available constraints. 10. Quote freshness and
operation consistency. 11. NEAR AI decision.

Define explicit outcomes: - Deny for a `BLOCK` result or failed
mandatory control. - Require review/approval for `WARN` or other
configured review conditions. - Continue only when all mandatory
controls pass and the policy permits it.

Do not rely on frontend checks. Do not allow an AI response to override
a failed mandatory check.

### Acceptance Criteria

-   Security decisions are made on the backend.
-   Every decision can be traced to the relevant operation and policy
    version.
-   Invalid ownership, grant, policy, or quote conditions prevent
    execution.
-   `WARN`, `BLOCK`, and AI failure have explicit handling.

------------------------------------------------------------------------

## Phase 9 --- Implement Operation-Specific User Approval

### Tasks

1.  Create an approval record for operations that require user approval.
2.  Bind the approval to the exact operation, quote, amount, asset pair,
    and relevant transaction payload or digest.
3.  Display the preview, fees, warnings, and risk result in the
    frontend.
4.  Let the user approve or reject the operation.
5.  Verify the approval belongs to the authenticated owner.
6.  Verify that the reviewed operation has not changed.
7.  Expire approvals when the quote or approval window expires.
8.  Add tests for changed amounts, changed assets, stale quotes,
    replayed approvals, and another user's approval attempt.

### Acceptance Criteria

-   Approval is explicit and operation-specific.
-   A user cannot approve one operation and accidentally authorize a
    different one.
-   Rejected or expired approvals cannot be executed.

------------------------------------------------------------------------

## Phase 10 --- Execute Swaps Safely

### Tasks

1.  Revalidate ownership, policy, grant, approval, and quote immediately
    before execution.
2.  Build the execution request using the documented Agents on Intents
    API contract.
3.  Send the partner API key and grant token only from the backend.
4.  Generate and persist a stable idempotency key for the logical
    operation.
5.  Submit the execution request.
6.  Store the provider operation ID and any correlation information
    returned.
7.  Handle network timeouts and ambiguous responses by reconciling the
    original operation.
8.  Never blindly submit a second execution request after an uncertain
    response.

### Acceptance Criteria

-   Real execution happens only after all required checks and approvals.
-   The same logical operation uses the same idempotency key on safe
    retries.
-   An ambiguous response enters an uncertainty/reconciliation path.
-   Secrets are never exposed in frontend responses or logs.

------------------------------------------------------------------------

## Phase 11 --- Track Operations and Build the Dashboard

### Tasks

1.  Implement status retrieval using the documented provider status
    endpoint.
2.  Map provider statuses to the application's internal status model.
3.  Persist status changes and transaction hashes.
4.  Reconcile `UNCERTAIN` operations by checking the original provider
    operation.
5.  Avoid routine re-execution of operations in `NEEDS_REVIEW`.
6.  Build a dashboard showing:
    -   Agents and their status.
    -   Policies and spending limits.
    -   Pending approvals.
    -   Swap previews.
    -   Risk decisions and reasons.
    -   Transaction history.
    -   Execution status and transaction hash, when available.
7.  Add loading, empty, error, and retry states.

### Acceptance Criteria

-   Users can see only their own agents and operations.
-   Statuses reflect provider responses accurately.
-   Uncertain operations are reconciled rather than duplicated.
-   The dashboard clearly distinguishes a quote from an executed
    transaction.

------------------------------------------------------------------------

## Phase 12 --- Security, Integration, and End-to-End Testing

### Test Cases

-   Valid wallet ownership proof.
-   Invalid or expired wallet challenge.
-   Cross-user agent access.
-   Cross-user transaction access.
-   Missing, expired, or revoked grant.
-   Disallowed source or destination asset.
-   Amount above the per-operation limit.
-   Daily limit exceeded.
-   Insufficient balance.
-   Expired or changed quote.
-   NEAR AI returns `ALLOW`.
-   NEAR AI returns `WARN`.
-   NEAR AI returns `BLOCK`.
-   NEAR AI times out or returns invalid output.
-   User rejects approval.
-   Approval is replayed or belongs to another operation.
-   Duplicate execution request.
-   Network interruption after submission.
-   Provider reports success, failure, or refund.

### Acceptance Criteria

-   All mandatory security checks have automated tests.
-   No test can execute a real transaction unintentionally.
-   Mock and dry-run tests are used before any real execution test.
-   End-to-end flow works from wallet connection through status display.

------------------------------------------------------------------------

## Phase 13 --- Controlled Mainnet Validation

The hackathon project notes state that NEAR Intents does not provide a
testnet for this integration. Use separate development accounts and very
small amounts for any required mainnet execution validation. Use
`dry: true` for quote previews where supported.

### Tasks

1.  Complete mock-based tests first.
2.  Verify quote and preview behavior without execution.
3.  Review the exact execution payload and user approval flow.
4.  Obtain explicit user approval before any real signing or spending.
5.  Use a separate development wallet and a very small amount.
6.  Record the operation ID and reconcile the final status.
7.  Never commit keys, tokens, or wallet secrets.

### Acceptance Criteria

-   No mainnet transaction is sent without explicit authorization.
-   Development funds and wallets are separated from personal funds.
-   Results are recorded and reproducible.

------------------------------------------------------------------------

## Phase 14 --- Hackathon Packaging and Demo

### Tasks

1.  Update the README with:
    -   The problem SpendGuard solves.
    -   Product architecture.
    -   How NEAR and NEAR Intents are used.
    -   What was built during the hackathon versus what existed
        beforehand.
    -   Setup instructions and environment variables.
    -   Reproducible steps for trying the demo.
2.  Add a suitable open-source `LICENSE`.
3.  Ensure secrets and local environment files are excluded from Git.
4.  Prepare a short end-to-end demo.
5.  Show a real user action and a visible result.
6.  Make the repository public before the deadline.
7.  Publish the required public demo post and complete the submission
    only after reviewing and confirming the exact submission details.

### Suggested Demo Sequence

1.  Connect and verify a wallet.
2.  Create an agent.
3.  Set spending limits and allowed assets.
4.  Authorize the agent.
5.  Request a small swap.
6.  Show policy checks and the dry-run quote.
7.  Show the existing NEAR AI risk result.
8.  Show the approval screen.
9.  Execute only if explicitly approved and safe to do so.
10. Show the resulting status and transaction record.

### Acceptance Criteria

-   A reviewer can understand the product and reproduce the documented
    flow.
-   The repository clearly distinguishes pre-existing work from
    hackathon work.
-   The demo demonstrates the complete security workflow, not just an
    isolated API call.

------------------------------------------------------------------------

## Recommended Implementation Order

  Order   Phase          Main deliverable
  ------- -------------- ------------------------------------------
  1       Phase 0        Verified baseline
  2       Phase 1        Stable provider client
  3       Phase 2        Domain models
  4       Phase 3        Verified wallet ownership
  5       Phase 4        Agent creation and ownership
  6       Phase 5        Policy and grant authorization
  7       Phase 6        Swap validation and dry-run quote
  8       Phase 7        Existing NEAR AI risk analysis for swaps
  9       Phase 8        Backend security decision layer
  10      Phase 9        Operation-specific approval
  11      Phase 10       Safe execution
  12      Phase 11       Status tracking and dashboard
  13      Phase 12--13   Testing and controlled validation
  14      Phase 14       Hackathon packaging and demo

## Implementation Rules

-   Do not add Claude.
-   Do not replace the existing NEAR AI integration.
-   Do not rewrite working transaction-analysis code without a clear
    need.
-   Do not assume provider endpoints or payload formats; verify them
    against current official documentation.
-   Do not store private keys.
-   Do not expose partner API keys or grant tokens to the frontend.
-   Do not trust frontend policy checks.
-   Do not let AI `ALLOW` override mandatory security checks.
-   Do not execute a swap merely because a dry-run quote succeeded.
-   Do not blindly retry an execution with a new idempotency key after
    an uncertain result.
-   Complete and test one phase before moving to the next.
