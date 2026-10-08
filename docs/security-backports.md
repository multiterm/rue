# Temporary security backports — 2026-10-05

The owner authorized reviewed downstream backports to unblock preview without unconditional audit exceptions. These are **not official fixed releases**. Raw `pnpm audit --prod` still reports both findings. Rue's gate permits only the exact mitigations below, with installed-code verification and bounded regression tests, through **2026-10-19**. Expiration requires a new review, not an automatic extension.

## Provenance and scope

- `node-forge@1.4.0`, GHSA-86w9-cpqp-85rv: only `lib/rsa.js` from [upstream PR 1152](https://github.com/digitalbazaar/forge/pull/1152), head `ceba34402e329f0365134f23fe19898756527d65`. The PR is open/unmerged. The patch rejects extra children in the nested DigestAlgorithm sequence, preserving OID-only and OID-plus-NULL encodings. It retains the existing outer DigestInfo validation.
- `braces@3.0.3`, GHSA-vfj7-8cjw-p6xm: only the five `lib/` changes from [proposal PR 72](https://github.com/micromatch/braces/pull/72), head `28d440b5dd449dbf1fe6f3506cf94ecca4d02660`. This PR was closed **without merging**. The downstream backport caps brace/parenthesis parsing and AST traversal depth at 100, honors stricter fractional limits, preserves stringify parent semantics, and rejects cyclic parent chains during expansion. It does not import unrelated unreleased parser changes.

The braces guard deliberately throws on rejected input. **Callers must catch validation errors.** It is a bounded-recursion mitigation, not a guarantee against uncaught exceptions, expansion cardinality, arbitrary AST width, or every resource-exhaustion attack. Do not expose these APIs directly to untrusted requests without error handling and application limits.

Original package licenses remain in the installed distributions. No package is renamed or assigned a fictitious fixed version.

## Enforcement and evidence

`pnpm-workspace.yaml` declares exact-version `patchedDependencies`; the lockfile records patch hashes. `quality/security-backports.json` pins patch SHA-256, modified installed-file hashes, advisory identity, exact package version, upstream commit and expiry.

The audit gate enumerates all installed instances through pnpm, rejects missing/unpatched/mismatched instances, checks each reviewed file, and runs security regressions in separate processes with timeouts. Unknown advisories remain failures. The gate prints both retained findings and their mitigation status rather than claiming a zero-advisory report.

Regressions cover valid RSA signatures for SHA-1/256/384/512, optional NULL parameters, wrong digests, and nested/outer extra ASN.1 elements. The malformed-block tests use a disposable generated private key; they demonstrate parser rejection, not an independent low-exponent public-key forgery. Braces tests cover 100/101 boundaries, 1,000/4,000 nesting levels, direct ASTs, fractional/infinite configuration, cyclic parents, ordinary expansions, and stringify compatibility. The same security checks failed against the original installed packages before applying the patches and passed afterward.

Tests also reject altered patch bytes, missing or altered installed files, unpatched duplicate instances, wrong advisory/version and expiration. Run:

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run --config quality/vitest.config.ts
node quality/check-audit.mjs
```

Replace these backports with genuine published fixes when available, then remove the corresponding patch, manifest entry and conditional allowance after regression verification. Never remove the failing audit finding merely to obtain a green release.
