# Rue quality gates

Rue quality lifecycle is local and Sandblocks-owned; GitHub Actions is not required.

- `rune quality-unit`: exhaustive app/theme/viewport/locale permutation contract with 100% V8 coverage.
- `rune quality-crap`: CRAP score gate (`MAX_CRAP=30` by default).
- `rune quality-static`: format, typecheck, unit tests, build, audit, permutations, and CRAP.
- `rune quality-playwright`: runtime browser contracts for every deployed service.
- `rune quality`: all static and existing application Playwright suites.
- `rune quality-deployed`: browser contracts against URLs supplied by Sandblocks.

The pre-commit hook runs the fast permutation/CRAP gate. The pre-push hook runs the complete static gateway. Sandblocks runs service-specific browser checks after deployment and stores traces/screenshots as deployment artifacts.
