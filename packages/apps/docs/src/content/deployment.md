# Deployment

Rue's Sandblocks v2 contract deploys API, webapp, docs, and site services.

## Sandblocks

```sh
pnpm exec rune sandblocks-validate
pnpm exec rune deploy
```

## Runway

The Expo application follows Fuel's development, preview, and production APK variants.

```sh
pnpm exec rune runway-push
```

A local Android build requires Java and the Android SDK before Runway can upload the APK.
