# Detection Rules

## Amount Analysis

- Flag if amount is unusually large relative to typical retail usage
- Flag round numbers that look like testing or structuring
- Consider asset type (stablecoins vs volatile tokens)

## Destination Analysis

- Unknown / new address → increase risk
- Address that looks like a mixer, tumbler, or high-risk service → high risk
- Contract address without verified purpose → medium to high risk
- Named NEAR account vs long implicit account → note the difference

## Behavioral Signals

- Urgency language in the request
- Attempts to hide or obfuscate the real recipient
- Multiple hops mentioned
- Request to "skip checks" or "approve quickly"

## Scoring Guidance

- Start from a base score
- Add points for each independent risk signal
- Cap at 100
- If critical signal exists (known scam address, clear social engineering), score should be ≥ 80

