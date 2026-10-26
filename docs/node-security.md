# Node.js security baseline

Use Node.js **22.23.4** from `.nvmrc`. It includes the October 21, 2026 fixes, including CVE-2026-111497 (Brotli decoder). Source: https://nodejs.org/en/blog/vulnerability/october-2026-security-releases

For local work, run `nvm install` and `nvm use`, then `node scripts/check-node-version.cjs`. CI verifies this version before running application scripts. The GitHub actions themselves use their maintained Node 24 runtime; this is separate from the application runtime selected by setup-node.

Docker images pin the reviewed Node release and image digest; deployment builds use `--pull`. To update the baseline, review the official advisory, update `.nvmrc`, the Docker tag/digest where applicable, and the EAS build profiles for the mobile project. Test before deploying and verify the actual version in the container/private startup logs. Do not rely only on a floating `node:22` tag.

The version change is a patch within Node 22. It does not modify Stripe SDK versions, API keys, prices, or subscriptions. Patching does not prove whether a past exposure occurred.
