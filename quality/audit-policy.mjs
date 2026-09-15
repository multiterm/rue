export function parseAuditResult(result) {
  if (result.error || ![0, 1].includes(result.status)) throw new Error('Dependency audit could not complete')
  let report
  try { report = JSON.parse(result.stdout) } catch { throw new Error('Dependency audit returned invalid JSON') }
  if (!report || typeof report !== 'object' || report.error || !report.advisories || Array.isArray(report.advisories) || typeof report.advisories !== 'object') throw new Error('Dependency audit returned an error or unsupported report')
  const counts = report.metadata?.vulnerabilities
  const severities = ['info', 'low', 'moderate', 'high', 'critical']
  if (!counts || !severities.every((key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0)) throw new Error('Dependency audit vulnerability counts are missing or invalid')
  const total = severities.reduce((sum, key) => sum + counts[key], 0)
  if (counts.total !== undefined && counts.total !== total) throw new Error('Dependency audit total contradicts its severity counts')
  const advisories = Object.entries(report.advisories)
  if (advisories.length === 0 && (result.status !== 0 || total !== 0)) throw new Error('Dependency audit report contradicts its exit status or vulnerability counts')
  for (const [id, advisory] of advisories) {
    if (!/^\d+$/.test(id) || !advisory || typeof advisory.module_name !== 'string' || !['info', 'low', 'moderate', 'high', 'critical'].includes(advisory.severity) || typeof advisory.title !== 'string') throw new Error('Dependency audit contains a malformed advisory')
  }
  return advisories
}
