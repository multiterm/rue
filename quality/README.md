# Rue quality gates

Rue quality lifecycle is local and Sandblocks-owned; GitHub Actions is not required.

- `rune quality-unit`: app/theme/viewport/locale permutation and deployment-review runner tests. The 100% V8 coverage threshold covers **only `quality/app-contract.ts`**, not product source or feature completeness.
- `rune quality-crap`: CRAP score gate for that same contract (`MAX_CRAP=30` by default), not a repository-wide product complexity gate.
- `rune quality-static`: format, typecheck, unit tests, build, audit, permutations, and CRAP.
- `rune quality-playwright`: runtime browser contracts for every deployed service.
- `rune quality`: all static and existing application Playwright suites.
- `rune quality-deployed`: browser smoke contracts against URLs supplied by Sandblocks; API checks additionally require authentication and accept the SSE reconnect cursor header.
- `rune review-develop` / `rune review-preview`: explicit live readiness reports, including blocked authenticated prerequisites. See [feature readiness](../docs/feature-readiness.md). These are deliberately not aliases for passing browser smoke tests.

The pre-commit hook runs the fast permutation/CRAP gate. The pre-push hook runs the complete static gateway. Sandblocks runs service-specific browser checks after deployment and stores traces/screenshots as deployment artifacts.
