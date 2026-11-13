# Phase 3: wallet connection and ownership verification

SpendGuard uses NEAR NEP-413 ownership messages and Meteor Wallet through NEAR
Wallet Selector. The frontend's connect button now opens a wallet dialog. The user
enters a NEAR account ID, reviews the backend-issued message, and approves that
exact message in Meteor. The backend verifies the signature and checks that the
public key is a full-access key on the claimed account at finality `final`.

No ordinary wallet SDK `signIn`, access-key creation, account import, or transaction
signing method is called. Ordinary Meteor SDK sign-in creates a browser access
key, so SpendGuard deliberately uses the documented `signMessage` method directly.
Meteor chooses the signing account in its own interface; the returned account
must match the address in the reviewed challenge. SpendGuard stores no private
keys, and verification neither authorizes an agent nor spends funds.

## Configuration and local setup

From `backend`, install dependencies and configure `.env`:

```dotenv
CLIENT_URL=http://localhost:5173
MONGODB_URI=<your development MongoDB connection string>
NEAR_NETWORK_ID=mainnet
NEAR_RPC_URL=
NEAR_RPC_TIMEOUT_MS=8000
```

`NEAR_NETWORK_ID` accepts `mainnet` or `testnet`. The backend sends this value to
the frontend, so there is no second frontend network setting to keep synchronized.
The RPC URL defaults to `https://rpc.<network>.near.org`; configure a trusted HTTPS
RPC for the selected network if the public endpoint is unavailable or restricted.
RPC redirects, malformed responses, missing accounts/keys, function-call keys,
timeouts, and transport failures cannot authenticate a user.

Start `npm run dev` in both `backend` and `frontend`, then open exactly
`http://localhost:5173`. The Vite development proxy forwards `/api` to port 3000.
The browser origin must match `CLIENT_URL`, including the port. If you open the
frontend using a different hostname, update `CLIENT_URL` accordingly and restart
the backend. The signing recipient is that website's host, including its port.

For production, configure an HTTPS `CLIENT_URL` and serve the API through the same
origin or a same-site HTTPS host. Browser requests include credentials; cookies
are HttpOnly and SameSite Strict, and Secure on HTTPS or in production. An HTTP
production client URL cannot start authentication. Unrelated frontend/API sites
will not work with these cookies; deploy a same-site API or reverse proxy.

## Backend API

| Method and path | Behavior |
| --- | --- |
| `GET /api/wallet/config` | Public network and supported wallet provider configuration. |
| `POST /api/wallet/challenges` | Accepts only `{ accountId }`; issues a five-minute challenge and a browser-binding HttpOnly cookie. |
| `POST /api/wallet/verify` | Accepts only `{ challengeId, accountId, publicKey, signature }`; verifies ownership and establishes a new authenticated session. |
| `GET /api/auth/session` | Returns safe user/wallet information and session expiry, or `null` when unauthenticated. |
| `POST /api/auth/logout` | Revokes the server session and clears the session and challenge cookies. |
| `GET /api/wallet` | Lists only the authenticated user's wallets. |
| `GET /api/wallet/:id` | Retrieves a wallet under the authenticated owner; another owner's ID returns 404. |

Mutation endpoints require the configured browser `Origin`. Challenge/proof bodies
use strict validation, so client ownership IDs, verification flags, timestamps,
extra payload fields, and unsupported keys are rejected. Current support is
Ed25519 NEP-413 signatures returned as canonical base64.

Responses exclude raw signatures, public keys, cookie values, token hashes, and
browser-binding hashes. Wallet and authentication responses use `Cache-Control:
no-store`. Sanitized service errors do not carry database, RPC, or transport
payloads into logs or responses. The existing anonymous transaction-analysis API
and NEAR AI integration remain compatible.

## Challenges, identity association, and sessions

Challenges use a random 32-byte nonce and a separate random 32-byte browser token.
MongoDB stores only the SHA-256 hash of the browser token. Each challenge includes
the account, network, recipient, exact message, expiry, and optional owner/session
references. A new challenge replaces the browser's flow cookie; earlier attempts
in another tab must start again. Signature results remain in memory and are sent
only in the verification request body, never in URLs or browser storage.

Proof verification checks the browser binding, account, network, expiry, and
current authenticated owner/session before cryptographic verification and RPC.
Linking a wallet rechecks the session and its verified wallet after the RPC lookup.
A conditional atomic update consumes a valid challenge exactly once and checks
expiry again. A challenge expiring during RPC cannot succeed. Once consumed, any
later failure requires a new challenge; no proof is automatically replayed.
Challenges are deleted by a TTL index one day after expiry, leaving a short audit
window. Wallets retain the verification method and challenge reference.

On first successful verification, the existing `User` model associates
`authIssuer = near:<network>` and `authSubject = <accountId>`. A returning verified
wallet resolves its existing owner, including wallets previously linked as a
second wallet. This extends the existing identity model without adding passwords
or a second user collection. An already authenticated user may verify another
unclaimed wallet; a wallet proven by another owner cannot be attached to that user.
Unverified candidates do not reserve addresses globally. Revoked wallet claims
are retained and cannot be reactivated through ordinary sign-in.

Sessions last twelve hours and contain owner/wallet references, expiry, revocation,
and a SHA-256 token hash. The random session token exists only in the HttpOnly
cookie. Successful verification rotates the current session. Authentication
checks session expiry/revocation, the user's `ACTIVE` state, and the wallet's
verified state/network on every protected request. Disconnect revokes the session
while retaining wallet ownership history. The frontend restores sessions through
the backend and refreshes them on focus/visibility changes and once per minute.

Challenge creation and verification have per-process, per-IP fixed-window limits
of ten requests per minute. Distributed deployments should additionally enforce
limits at the API gateway. Forwarded IP headers are not trusted by default; set
up a deliberately scoped proxy configuration at deployment if required.

## Database indexes and verification

Startup registers and initializes the session and wallet-challenge indexes along
with the Phase 2 models. Existing wallet indexes must match the partial verified
claim index described in [domain-models.md](domain-models.md). If a database has
the earlier unconditional draft index, perform its explicit migration before
deploying this flow; startup never drops indexes automatically.

Automated validation:

- Backend tests use actual Ed25519 signatures, a fixed canonical Borsh fixture,
  the real Express routes and Mongoose save/query paths, mocked MongoDB collection
  methods, and mocked NEAR RPC. They cover invalid signatures, expired/replayed
  challenges, browser/account mismatches, concurrent consumption, unauthorized
  keys, RPC failures, cross-user reads/linking, disabled users, revoked wallets,
  session rotation/logout, rate limits, and expiry/revocation during verification.
- Frontend tests cover exact reviewed payloads, cancellation, wrong accounts/state,
  expired challenges, backend failure, session restoration, network mismatches,
  disconnect, and repeated clicks.
- Playwright runs the actual Meteor SDK's extension and web-popup message paths
  in headless Edge with synthetic wallet responses and mocked APIs. It checks review-before-sign,
  UI verification, disconnect, error recovery, and absence of browser signing keys.
  Run `npm run test:browser` from `frontend`. Set `PLAYWRIGHT_CHANNEL=chrome` if
  Chrome is available instead of Edge. For the built app, build first and set
  `SPENDGUARD_BROWSER_BUILD=1` before the browser command.

Tests do not contact a live wallet or database, create chain keys, or send
transactions. Live MongoDB index enforcement and a real Meteor/RPC ownership proof
still need manual integration validation using a development account. This phase
does not require a mainnet spending test.

Two high-severity transitive advisories introduced by the wallet SDK are addressed
with compatible overrides for `nanoid` and `decode-uri-component`. Remaining
low-severity upstream advisories and wallet bundle warnings are documented by the
dependency audit/build output; no forced SDK downgrade is applied.

## Official contracts reviewed

- [NEP-413 specification](https://github.com/near/NEPs/blob/master/neps/nep-0413.md)
- [Wallet Selector API](https://github.com/near/wallet-selector/blob/main/packages/core/docs/api/wallet.md)
- [Official signature and full-access-key verification helper](https://github.com/near/wallet-selector/blob/main/packages/core/src/lib/helpers/verify-signature/verify-signature.ts)
- [Official Borsh payload schema](https://github.com/near/wallet-selector/blob/main/packages/core/src/lib/helpers/verify-signature/payload.ts)
- [Meteor Wallet module](https://github.com/near/wallet-selector/blob/main/packages/meteor-wallet/src/lib/meteor-wallet.ts)

Wallet Selector/Meteor packages are pinned by the lockfile to 10.1.4. The backend
uses the official NEAR cryptography package and Borsh 2 serializer. Agents on
Intents endpoint integration belongs to the subsequent phases.
