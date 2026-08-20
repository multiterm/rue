# @multiterm/rue-sdk

Public TypeScript client for Rue.

```ts
import { createRueClient } from '@multiterm/rue-sdk'

const rue = createRueClient({
  baseUrl: 'https://api.rue.multiterm.dev',
  token: () => keynameSession.accessToken,
})

console.log(await rue.health())
```

Rue API calls use Keyname bearer tokens. Do not embed confidential Keyname client secrets in browser, mobile, or Electron bundles.
