# Deployment

Rue's Sandblocks v2 contract deploys API, webapp, docs, and site services.

## Sandblocks

```sh
pnpm exec rune sandblocks-validate
pnpm exec rune deploy
```

## Runway

The Expo application follows Fuel's development, preview, and production APK variants. Add `RUNWAY_PUSH_KEY` and the canonical `RUNWAY_SERVER_URL=https://runway.honeycluster.xyz` to the ignored `.runway/config.env`, then install the repository hooks.

```sh
pnpm exec rune runway-push
pnpm exec rune runway-push-preview
pnpm exec rune runway-push-production
pnpm exec rune runway-dry-run
```

Mobile-affecting commits automatically build and upload in the background: `develop` publishes a development APK, `pre` a preview APK, and `prod` a production APK. Protected logs are written under `.runway/logs`. A local Android build requires Java and the Android SDK.
