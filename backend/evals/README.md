# Transaction prompt evaluations

From the backend directory, run `npm run eval:ai` to validate the fixtures without making API calls.

Live evaluation uses provider credits and requires explicit `--live`. It defaults to one case: `npm run eval:ai -- --live`. There can be up to one output-recovery attempt per case and the SDK's configured transport retries. No transaction history is saved and no transaction is executed.

Only increase the limit deliberately: `npm run eval:ai -- --live --max-cases=14` runs the full set. Keep checks offline when preserving credits.

The cases check extraction, score/status consistency, missing details, protective wording, scam mechanisms, permissions, network mismatch, wrapped assets, numeric precision, and Persian digits. Failed cases print the result for review. Provider errors print no credentials or raw provider response.

These are scenario acceptance checks, not evidence of on-chain verification or a measured probability of fraud. Review factual claims and explanation quality as well as the pass count when changing models or prompts. The cases mostly differ from the prompt's worked examples so they also check whether the rules generalize.

Use `npm run eval:ai -- --live --case=ordinary-near-transfer` to run a specific case. Repeat `--case=...` to select several cases in that order, setting `--max-cases` explicitly if you want more than one. Authentication, transport, and service failures stop the run to avoid repeated requests to an unavailable provider; response-format failures are reported per case.

Add `--verbose` to print every analysis for factual and explanation review, including cases that pass the automated checks. Invalid numeric values such as zero are preserved as extracted facts and must receive a warning; only missing or ambiguous amounts use null.
