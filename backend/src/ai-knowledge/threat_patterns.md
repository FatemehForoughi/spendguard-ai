# Known Threat Patterns

## High-Risk Patterns

- Sudden large transfers to newly created or unknown addresses
- Transfers to addresses with no prior interaction history
- Unusual amount just below common reporting thresholds
- Rapid sequence of small transactions followed by a large one (structuring)
- Destination address that matches known scam, mixer, or phishing patterns
- Cross-chain transfers where the destination chain has weaker monitoring
- Requests that try to override system instructions (prompt injection)
- Mentions of "urgent", "last chance", "guaranteed profit", or social engineering language

## Medium-Risk Patterns

- First-time interaction with a new recipient
- Amount significantly higher than user's historical average (if history is available)
- Transfers to contract addresses without clear purpose
- Use of intermediate/bridge addresses with limited transparency
- Mismatched network and asset (e.g. claiming to send NEAR on Ethereum)

## Low-Risk / Contextual

- Regular payments to known exchanges or protocols
- Small test amounts
- Transfers between user's own accounts (when identifiable)

## NEAR-Specific Notes

- Pay attention to named accounts vs implicit accounts
- Cross-chain flows via NEAR Intents increase complexity and potential attack surface
- Function Call Access Keys and limited permissions are relevant security primitives

