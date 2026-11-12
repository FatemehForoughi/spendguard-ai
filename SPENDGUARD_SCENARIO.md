# SpendGuard --- Product Scenario and End-to-End Workflow

## 1. Product Overview

SpendGuard is a security and policy-control layer for AI agents that
perform digital-asset operations on behalf of users.

An AI agent can interpret a user's request and prepare an operation, but
it must not receive unrestricted control over the user's funds.
SpendGuard sits between the agent and transaction execution. It checks
ownership, permissions, spending policies, transaction details, and risk
signals before an operation can proceed.

The project will continue using the existing NEAR AI risk-analysis
integration. **Claude will not be added.** The existing risk-analysis
flow and its `ALLOW`, `WARN`, and `BLOCK` outcomes will be preserved and
extended only when required for the new workflow.

The Agents on Intents integration will be used for agent-related
operations and the supported transaction workflow. The existing Agents
on Intents API client is a starting point; it does not, by itself, mean
that the complete agent lifecycle or swap execution is already
integrated.

## 2. Main Actors and Responsibilities

### User

-   Connects a wallet.
-   Proves control of the wallet when required.
-   Creates and configures an agent.
-   Defines spending limits and allowed assets.
-   Signs the required authorization intents.
-   Reviews and approves operations when approval is required.
-   Views operation status and transaction history.

### SpendGuard Backend

-   Authenticates users and checks resource ownership.
-   Stores agent, policy, grant, and transaction records.
-   Communicates with Agents on Intents.
-   Enforces policies independently of AI output.
-   Calls the existing NEAR AI risk-analysis service.
-   Controls whether an operation may proceed.
-   Stores operation identifiers, idempotency keys, statuses, and
    transaction hashes.

### Existing NEAR AI Risk Analysis

-   Analyzes transaction and quote information.
-   Returns the existing risk decision: `ALLOW`, `WARN`, or `BLOCK`.
-   Provides reasons and recommendations according to the current
    project schema.
-   Is one input to the security decision, not the only security
    control.

### Agents on Intents / NEAR Intents

-   Provides the supported agent and intent-related API operations.
-   Supports the relevant authorization and transaction workflow.
-   Provides quote/preview and execution/status capabilities according
    to its current API contract.

### User Wallet

-   Remains under the user's control.
-   Signs the required ownership or authorization payloads.
-   Must never expose its private key to the backend or the AI agent.

## 3. End-to-End User Scenario

### Step 1 --- Connect a Wallet

The user opens SpendGuard and connects a supported wallet.

SpendGuard receives the wallet address and performs the required
ownership-verification flow. Receiving an address alone is not proof
that the user controls it.

Example: - Wallet: `user.near` - Example balance: `100 USDC` - Intended
destination asset: `NEAR`

The backend associates the verified wallet with the authenticated user.

### Step 2 --- Create an Agent

The user creates an agent in SpendGuard.

Example configuration: - Agent name: `My Trading Agent` - Supported
operation: token swap - Source asset: USDC - Destination asset: NEAR

The backend creates the agent through the supported Agents on Intents
API flow and stores the external agent identifier together with the
local owner association.

### Step 3 --- Define a Spending Policy

The user defines the limits within which the agent may operate.

Example policy:

  Policy                      Example value
  --------------------------- ---------------
  Maximum amount per swap     10 USDC
  Maximum daily spending      30 USDC
  Allowed source asset        USDC
  Allowed destination asset   NEAR
  User approval required      Yes
  Operations outside policy   Denied

These values are examples, not defaults that should be silently imposed.

The backend stores the policy and checks it before every relevant
operation. Frontend-only checks are not sufficient. Any external agent
permission or grant must be compatible with the policy enforced by
SpendGuard.

### Step 4 --- Authorize the Agent

The agent needs a valid permission to perform the supported operations.

The intended flow is:

1.  The backend prepares the authorization intent or payload using the
    documented Agents on Intents flow.
2.  SpendGuard presents the exact payload and its meaning to the user.
3.  The user's wallet signs the required payload.
4.  The backend submits the signed result to the appropriate API
    endpoint.
5.  The backend receives the resulting grant or authorization
    information.
6.  The grant is stored securely and associated with the correct user
    and agent.

The user's private key is never sent to SpendGuard or Agents on Intents.
The exact payload must be signed as required by the provider's
documentation; the application must not modify a payload before signing
it.

### Step 5 --- Submit a Swap Request

The user asks the agent:

> Swap 5 USDC to NEAR.

The agent interprets the request and produces the structured operation
details needed by the backend.

Before requesting a quote, SpendGuard checks: - The authenticated user
owns the agent. - The source and destination assets are allowed. - The
requested amount is within the per-operation limit. - The daily spending
limit will not be exceeded. - The grant exists and is valid. - The
available balance is sufficient, where balance data is available and
reliable.

If a mandatory check fails, the operation is rejected or held for
review. It must not proceed to execution.

### Step 6 --- Request a Dry-Run Quote

If the preliminary checks pass, the backend requests a swap preview
using the provider's documented quote flow with `dry: true`, where
supported.

The preview may contain information such as: - Input amount and asset. -
Estimated output amount and asset. - Exchange rate or route
information. - Fees. - Warnings. - Quote identifier and expiry
information, if supplied.

A dry-run quote is a preview. It is not proof that a real swap has
executed and must not be represented as a completed transaction.

### Step 7 --- Analyze the Operation with the Existing NEAR AI

SpendGuard sends the relevant request and quote information to the
existing NEAR AI risk-analysis service.

The existing decision values remain:

-   `ALLOW`: the AI analysis did not identify a blocking risk.
-   `WARN`: the operation requires additional attention or review.
-   `BLOCK`: the operation must not proceed.

The current analysis schema and integration should be preserved. If
additional swap-specific context is needed, extend the existing flow
compatibly rather than replacing it with a new AI provider.

NEAR AI is not the final security authority. An `ALLOW` result cannot
override a failed ownership, policy, grant, balance, or quote-validity
check.

If the AI service fails, times out, or returns invalid output, the
operation must fail safely and enter a review state such as
`NEEDS_REVIEW`; it must not be treated as approved.

### Step 8 --- Apply SpendGuard Security Decisions

Before asking for approval or executing, the backend evaluates all
required controls:

-   User and agent ownership.
-   Wallet ownership verification.
-   Grant validity and scope.
-   Per-operation spending limit.
-   Daily spending limit.
-   Allowed source and destination assets.
-   Balance and other available financial constraints.
-   NEAR AI risk result.
-   Quote validity and consistency.

A `BLOCK` result denies the operation. A `WARN` result requires the
configured review or approval path. A failed mandatory security check
denies or holds the operation regardless of the AI result.

### Step 9 --- Present the Operation for User Approval

When the policy requires user approval, SpendGuard presents a review
screen containing the operation details, such as:

-   Input amount and asset.
-   Estimated output amount and asset.
-   Rate and fees.
-   Quote expiry or freshness information.
-   NEAR AI risk decision.
-   Risk reasons and warnings.
-   The action the user is being asked to authorize.

The approval must be bound to the exact reviewed operation. It must not
be possible to approve one quote and then execute a different amount,
asset pair, or transaction payload under that approval.

The user can approve or reject the operation.

### Step 10 --- Revalidate and Execute

After approval, the backend rechecks the critical conditions: - The
approval belongs to the authenticated owner and the exact operation. -
The grant remains valid. - The policy still permits the operation. - The
quote is still valid and has not materially changed. - The operation has
not already been submitted.

The backend then sends the real execution request using the documented
Agents on Intents API flow. It uses a stable idempotency key for that
logical operation so retries do not accidentally create duplicate swaps.

If the network response is ambiguous, the backend must check the status
of the original operation. It must not blindly submit a second execution
request.

### Step 11 --- Track and Display the Result

SpendGuard stores and tracks the provider's operation status and any
transaction hash or correlation identifier returned by the API.

Application-level statuses may include:

  -----------------------------------------------------------------------
  Status                              Meaning
  ----------------------------------- -----------------------------------
  `PENDING_APPROVAL`                  Waiting for required user approval

  `PENDING`                           Submitted and awaiting completion

  `SUCCESS`                           Confirmed successful

  `FAILED`                            Execution failed

  `REFUNDED`                          Funds were returned, where
                                      applicable

  `NEEDS_REVIEW`                      A risk, validation, or provider
                                      issue requires review

  `UNCERTAIN`                         The result is not yet known;
                                      reconcile the original operation
  -----------------------------------------------------------------------

The dashboard displays the operation details, risk analysis, current
status, and transaction hash when available.

## 4. Security Principles

1.  **The user owns the wallet.** Private keys must never be stored by
    SpendGuard or given to an agent.
2.  **The backend enforces policy.** Frontend controls and AI responses
    cannot replace backend authorization checks.
3.  **AI is advisory within the security system.** NEAR AI contributes
    risk analysis but cannot override mandatory controls.
4.  **Fail safely.** Invalid AI output, unavailable services, invalid
    grants, stale quotes, or failed mandatory checks must not lead to
    execution.
5.  **Approval is operation-specific.** Approval must be bound to the
    exact operation and reviewed details.
6.  **Prevent duplicate execution.** Use idempotency keys and reconcile
    uncertain operations.
7.  **Protect user data and credentials.** API keys and grant tokens
    belong in secure server-side configuration or protected storage,
    never in source control or frontend code.
8.  **Verify provider behavior.** Implement endpoint paths, payloads,
    signing rules, token units, status values, and quote-expiry handling
    from the current official API documentation. Do not guess
    undocumented behavior.

## 5. Final Demonstration Flow

A complete product demonstration should show:

1.  The user connects and verifies a wallet.
2.  The user creates an agent.
3.  The user configures spending limits and allowed assets.
4.  The user signs the required authorization.
5.  The user requests a swap, for example, 5 USDC to NEAR.
6.  SpendGuard checks ownership, policy, grant, and balance.
7.  SpendGuard requests a dry-run quote.
8.  The existing NEAR AI analyzes the operation.
9.  SpendGuard applies its security rules.
10. The user reviews and approves the exact operation.
11. The backend submits the execution request.
12. SpendGuard tracks and displays the final result.

The central product message is:

**SpendGuard lets users benefit from AI-driven onchain actions without
giving an AI agent unrestricted control over their funds.**

## 6. Scope Boundaries

The initial implementation should focus on one complete, reliable
token-swap workflow.

Do not make these prerequisites for the first working version: -
Unattended trading without user approval. - Limit orders or complex
trading strategies. - Multiple agents coordinating with one another. -
Confidential balance features. - Custom wallet signing or custody. -
Broad support for every possible transaction type.

These can be considered later, after the core workflow is secure and
demonstrable.
