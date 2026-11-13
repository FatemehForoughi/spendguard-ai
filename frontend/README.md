# SpendGuard frontend

Agents & Policies, Swaps, Activity Logs, Settings, and Help are functional workspace views. Review signed owner actions and exact swap approvals through these screens. See [the project workflow and setup](../README.md); the automated browser flow uses synthetic provider and wallet responses.

Install with `npm install` and start with `npm run dev`. Start the backend on port
3000 and open `http://localhost:5173`. The development proxy forwards `/api`;
`.env.example` describes deployment overrides. Production builds use `npm run build`.

The wallet dialog supports NEAR ownership verification through Meteor Wallet.
Enter your account ID, review the message, and select the same account in Meteor
when signing. The network comes from the backend's `NEAR_NETWORK_ID`. The interface
shows ownership as verified only after the backend establishes a session. Wallet
ownership verification creates no access key and authorizes no spending.

Run `npm test` for frontend behavior tests. `npm run test:browser` tests the actual
SDK path with mocked APIs and wallet responses in headless Microsoft Edge. See
[the wallet integration documentation](../backend/docs/wallet-verification.md)
for configuration, alternate browser channels, deployment, and testing limits.
