import { expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import { assertBackportEvidence, backports, installedBackports, verifySecurityBackport } from './security-backports.mjs'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const spec = { module: 'fixture', version: '1.0.0', ghsa: 'GHSA-fixture', expires: '2026-10-19', sha256: digest('patch'), files: { 'lib/check.js': digest('fixed') } }
const advisory = { module_name: 'fixture', url: 'https://github.com/advisories/GHSA-fixture', findings: [{ version: '1.0.0' }] }
const evidence = { patch: 'patch', packages: [{ name: 'fixture', version: '1.0.0', patchHash: digest('patch'), files: { 'lib/check.js': 'fixed' } }] }

test('backport allowance requires exact reviewed patch and installed code', () => {
  expect(() => assertBackportEvidence(spec, advisory, evidence, '2026-10-05')).not.toThrow()
  for (const bad of [
    { ...evidence, patch: 'tampered' }, { ...evidence, packages: [] },
    ...[{ name: 'other' }, { version: '1.0.1' }, { patchHash: undefined }, { files: {} }, { files: { 'lib/check.js': 'unpatched' } }]
      .map(patch => ({ ...evidence, packages: [{ ...evidence.packages[0], ...patch }] })),
    { ...evidence, packages: [...evidence.packages, { ...evidence.packages[0], patchHash: undefined }] },
  ]) expect(() => assertBackportEvidence(spec, advisory, bad, '2026-10-05')).toThrow()
})

test('backport allowance cannot cover another finding/version or silently outlive review', () => {
  for (const patch of [{ module_name: 'other' }, { url: 'https://github.com/advisories/GHSA-other' }, { findings: [] }, { findings: [{ version: '0.9.0' }] }]) {
    expect(() => assertBackportEvidence(spec, { ...advisory, ...patch }, evidence, '2026-10-05')).toThrow()
  }
  expect(() => assertBackportEvidence(spec, advisory, evidence, '2026-10-20')).toThrow()
  for (const patch of [{ expires: undefined }, { expires: 'never' }, { expires: '2026-02-30' }, { files: {} }]) {
    expect(() => assertBackportEvidence({ ...spec, ...patch }, advisory, evidence, '2026-10-05')).toThrow()
  }
})

test('every installed backport matches its pin and passes bounded security regressions', () => {
  const installed = installedBackports()
  for (const [id, value] of Object.entries(backports) as [string, typeof spec][]) {
    verifySecurityBackport(id, { module_name: value.module, url: `https://github.com/advisories/${value.ghsa}`, findings: [{ version: value.version }] }, installed)
  }
}, 45_000)
