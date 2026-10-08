# Portal icons

Selected source from `@honeycluster/icons-base` 0.0.10, used by Honeycluster Portal.
The package's extensionless declaration barrel is incompatible with this library's
NodeNext build, so these selected sources and their MIT license are retained here.

Follow Portal's Tailwind v4 outline-icon pattern:

```tsx
<MenuSettingsIcon
  colorMode="stripped"
  className="size-4 fill-none stroke-current stroke-2"
  aria-hidden
/>
```

`stroke-current` inherits the containing control's text colour, including theme,
hover, destructive and disabled presentation. Do not force a separate icon colour
or use `colorMode="currentColor"`/deprecated `fillMode` for these outline icons:
that can fill their paths instead of drawing the intended outlines.
