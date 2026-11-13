# Controlled Mainnet validation — not performed

The implementation and synthetic tests are ready for controlled validation. No real mainnet wallet signature, grant, deposit, swap, or spending validation was performed for the remaining phases. The earlier real Meteor web-account discovery failure remains unresolved.

1. Run backend/frontend tests, both builds, the browser flow, and isolated MongoDB validation. Verify public provider network status and the current API contract.
2. Use a separate development wallet in the same browser profile as SpendGuard. Confirm Mainnet and that Meteor lists the account before requesting its ownership signature. Never enter a seed/private key in SpendGuard.
3. Review the exact initial ownership message. Complete a real proof and confirm the session/account/network shown by the API and UI.
4. Create a named development agent with explicit assets and very small per-swap/daily limits. Inspect the generated standard and exact message, review its meaning, and obtain the owner's wallet signature. Record only public/local IDs and confirmed policy revision.
5. Prepare a short-lived grant, inspect its exact commitment/expiry, and obtain the owner's signature. Confirm remote grant validity. Never record its bearer token in this document.
6. Fund the agent separately using the provider's official deposit flow. Read actual available balance for the selected source. No deposit is sent automatically by SpendGuard.
7. Request a dry quote. Record input, minimum output, available estimate, fees, warnings, local review deadline, NEAR AI result, and exact operation digest. Reject if ownership, policy, balance, grant, or quote checks fail.
8. Present that concrete request for owner approval. Only after that approval should a development operator set `ENABLE_LIVE_EXECUTION=true` and restart the API. Enabling this setting does not itself authorize or execute any operation.
9. Execute the approved request through SpendGuard. If the provider requires an approval vote, inspect its held request and approve the exact wallet payload. Record the original correlation ID and final public transaction hash after settlement.
10. On timeout or `UNCERTAIN`, observe the original operation; never create a second execution. On `NEEDS_REVIEW`, resolve through the provider first, then explicitly observe with `refresh:true`.
11. Confirm received amounts and any refund against the provider/chain evidence. Revoke the development grant, disable live execution, and record the final outcome.

| Evidence | Current result |
| --- | --- |
| Mock/security/browser validation | Automated |
| Real MongoDB index/dispatch locking | Passed in isolated database |
| Public provider network inspection | Read-only, Mainnet supported |
| Real Meteor ownership proof | Unconfirmed; web wallet reported no local Mainnet account |
| Real signed agent and grant | Not performed |
| Funded development agent | Not performed |
| Real approved swap / settlement | Not performed |

The real test cannot be completed without the wallet holder's interactive signature and a concrete funded development operation. Automated synthetic proofs do not replace that evidence.
