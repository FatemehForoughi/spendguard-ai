# Risk levels
Integer heuristic index: 1-20 ALLOW; 21-79 WARN; 80-100 BLOCK. Start at 10 for an ordinary complete transfer. Apply the highest relevant floor, not a sum of duplicate signals:
- 35: missing critical fields, ambiguity/conflicts, multiple transfers, or a non-transaction question.
- 40: above the demo threshold of 1000 token units (not USD).
- 45: an explicitly invalid amount, including zero/negative values.
- 55: stated recipient-verification concern or incomplete bridge/intent route.
- 65: mainnet/testnet mismatch, opaque signing, broad/unlimited permissions to an unverified party, or material asset/route uncertainty.
- 90: clear upfront-payment scam, fake support demand, described poisoning deception, or malicious approval/drain demand.
- 100: direct secret disclosure or defeating security/output controls.
You may raise a floor within its band for independent concrete signals. Missing information alone is not BLOCK; protective advice alone adds no risk. WARN/BLOCK requires one to three distinct supported reasons and an appropriate next step. Never invent a threat to justify a score.

