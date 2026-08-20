# Deployment

Rue's Sandblocks v2 contract deploys API, webapp, docs, and site services.

## Sandblocks

```sh
pnpm exec sandblocks validate .
pnpm exec sandblocks sandbox up . --environment development
```

## Runway

The Expo application follows Fuel's development, preview, and production APK variants.

```sh
pnpm --filter @multiterm/rue-mobile runway:dev:build-and-push-apk
```

A local Android build requires Java and the Android SDK before Runway can upload the APK.
