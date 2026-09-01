# Authentication

All Rue surfaces authenticate with Keyname. Browser and Electron clients use Keyname `auth.js`; native clients use Authorization Code with PKCE. The API verifies Keyname bearer tokens.

## Register clients

Register native OAuth clients and exact callback URLs in Keyname. Browser applications use the origin-aware `auth.js` modal and do not require `VITE_KEYNAME_CLIENT_ID`. Never place a confidential client secret in browser, Expo, or Electron bundles.

## Sign-in form

The web and desktop form uses the shared Rue `FormContainer`, `Input`, `Button`, and `FormSeparator` components. TanStack Form runs the shared Zod credential contract in the browser, while the typed `auth.login` and `auth.verifyMfa` tRPC mutations validate the same contract on the server before calling Keyname. Set the server-only `KEYNAME_CLIENT_ID` and `KEYNAME_CLIENT_SECRET`; never expose the secret through Vite or Expo variables.

## Browser flow

```ts
const keyname = await loadKeyname('https://api.keyname.dev')
await keyname.ready
await keyname.signIn({ mode: 'modal', callbackUri: `${location.origin}/login` })
```

## Link devices

From the web or desktop workspace, choose **Link device** to create a five-minute, single-use pairing. Rue displays a QR code, a `rue://link` deep link, and an eight-digit fallback code. Rue Mobile can scan the QR or accept either value manually; the terminal exposes the same flow with `/link`.

Both devices must authenticate as the same Keyname subject. The API stores only SHA-256 hashes of pairing secrets, rejects expired or reused pairings, and lets users review or revoke linked devices. Sessions are account-scoped and update through the Rue event stream; appearance preferences use optimistic versions to prevent silent overwrite conflicts.

## API verification

Set `KEYNAME_AUTH_ENABLED=true` and `KEYNAME_API_URL` in managed deployment configuration. `KEYNAME_CLIENT_ID` is optional and adds an audience restriction when supplied.
