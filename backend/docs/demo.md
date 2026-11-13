# Demo and submission preparation

## Reproducible offline demo

Build the frontend, then run `workspace.spec.mjs` with the production browser-test setting described in the root README. This exercises the real Meteor SDK transport with synthetic wallet replies, creates an agent/policy, issues authorization, reviews a swap, approves it locally, signs a provider vote, and displays synthetic settlement. The test also demonstrates blocked execution and preview-only mode. It sends no real wallet signature or funds.

For a live demonstration, use the controlled-mainnet runbook and show actual provider/chain evidence. Do not describe a synthetic SUCCESS response as a mainnet transaction.

## Suggested recording script

The browser test saves preview and synthetic-settlement screenshots under its ignored `frontend/test-results/` output directory. These illustrate the UI; they are not evidence of a real transaction.

1. Introduce the problem: an AI assistant should not have unrestricted wallet control.
2. Connect and verify a development NEAR wallet.
3. Create one trading agent, select the asset pair, and show its per-swap and daily policy.
4. Review/sign the agent policy and a time-limited grant.
5. Request a small swap and show exact amounts, minimum output, fees, and NEAR AI analysis.
6. Demonstrate a request refused by a deterministic policy check even with an AI `ALLOW` result.
7. Approve the exact permitted request and complete any provider wallet vote.
8. Display the original correlation ID and final status/hash. Explicitly label mocked versus live footage.

## Draft public description

SpendGuard AI is a policy and approval layer for AI agents using NEAR Intents. Users verify a NEAR wallet, create an agent, sign its spending policy, and authorize a time-limited grant. SpendGuard checks ownership, exact token amounts, spending limits, available balance, grant validity, NEAR AI risk analysis, quote freshness, and operation-specific approval before dispatch. Stable idempotency keys and reconciliation prevent uncertain requests from creating duplicate swaps.

The existing NEAR AI integration remains in use. The new workflow adds owner-scoped models, Meteor wallet verification, signed agent/policy/grant reviews, dry quotes, bound approvals, encrypted credentials, and operation tracking. Live mainnet validation is pending; automated tests use synthetic responses and send no funds.

## Publication status

The local README, license, setup instructions, architecture, test workflow, demo sequence, provenance, and draft description are prepared. No social message, public demo post, hackathon submission, or change to repository visibility has been sent. Actual submission requires the specific event/form, deadline, account, demo URL, and final claims to be reviewable before publication. Replace the pending live-validation claims only when supported by recorded evidence.
