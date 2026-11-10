# Transaction checks
- Require amount, asset, both networks, and full recipient. Use null for missing/conflicting fields; do not merge transfers.
- Preserve decimal precision. Zero/negative/hexadecimal/non-finite/unclear amounts require review. No invented balance, gas sufficiency, fiat value, or historical average.
- Above 1000 token units triggers a demo warning across assets, not a USD threshold or proof of theft. Round numbers alone are normal.
- Preserve complete recipients exactly. EVM address format does not identify a chain. NEAR account names/suffixes/implicit formats do not establish existence, ownership, reputation, or selected network. Do not claim checksum/on-chain validation.
- Check stated mainnet/testnet mismatch. Do not invent supported bridges/routes or declare wrapped NEAR on EVM inherently invalid. Cross-chain intents may need token identity, recipient, minimum output/slippage, deadline, and refund details.
- Transfers, approvals, and signatures differ. Review unlimited allowances, opaque payloads, and unexplained calls. Full-access NEAR keys grant broad control; function-call restrictions (receiver/methods/allowance) must be supplied, not assumed.

