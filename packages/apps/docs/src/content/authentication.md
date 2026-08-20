# Authentication

All Rue surfaces authenticate with Keyname. Browser and Electron clients use Keyname `auth.js`; native clients use Authorization Code with PKCE. The API verifies Keyname bearer tokens.

## Register clients

Register native OAuth clients and exact callback URLs in Keyname. Browser applications use the origin-aware `auth.js` modal and do not require `VITE_KEYNAME_CLIENT_ID`. Never place a confidential client secret in browser, Expo, or Electron bundles.

## Browser flow

```ts
const keyname = await loadKeyname('https://api.keyname.dev')
await keyname.ready
await keyname.signIn({ mode: 'modal', callbackUri: `${location.origin}/login` })
```

## API verification

Set `KEYNAME_AUTH_ENABLED=true` and `KEYNAME_API_URL` in managed deployment configuration. `KEYNAME_CLIENT_ID` is optional and adds an audience restriction when supplied.
