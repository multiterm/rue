# Design system

Rue GDS is the common visual language for every application. It mirrors the composable Keyname GDS pattern while keeping Rue-specific palettes and tokens.

## Tailwind v4

Import the shared theme once in each web entry stylesheet:

```css
@import "@multiterm/rue-gds/styles/theme.css";
@source "../../../../libs/ui/src";
```

## Components

`@multiterm/rue-ui` provides shadcn-style Button, Card, Input, Badge, and theme components. Components use semantic utilities such as `bg-surface`, `text-foreground`, and `border-border`.

## Themes

Grove, Midnight, Paper, and Mono each support light and dark modes. Native clients consume `rueNativeThemes` from `@multiterm/rue-gds`.
