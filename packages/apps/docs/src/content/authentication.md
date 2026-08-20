# Authentication

All Rue surfaces authenticate with Keyname. Browser, mobile, and desktop clients use Authorization Code with PKCE. The API verifies Keyname bearer tokens.

## Register clients

Create a public Keyname client for each user-facing surface and register exact callback URLs. Never place a confidential client secret in browser, Expo, or Electron bundles.

## Browser flow

```ts
const auth = createKeynameAuth(config, browserAuthStorage)
location.assign(await auth.authorizeUrl())
```

## API verification

Set `KEYNAME_CLIENT_ID` and `KEYNAME_API_URL` in managed deployment secrets. Rue uses the client ID as the token audience.
