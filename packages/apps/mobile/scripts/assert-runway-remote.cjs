const config = require('../runway.config.json')
const canonical = 'https://runway.honeycluster.xyz'
const configured = process.env.RUNWAY_SERVER_URL || config.serverUrl
let origin
try { origin = new URL(configured).origin } catch { console.error(`Invalid Runway URL: ${configured}`); process.exit(1) }
if (origin !== canonical) { console.error(`Runway publish blocked: ${origin} is not ${canonical}`); process.exit(1) }
console.log(`Runway target verified: ${canonical}`)
