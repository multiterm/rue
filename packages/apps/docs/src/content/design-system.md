# Design system

Rue GDS is the common visual language for every application. It mirrors the composable Keyname GDS pattern while keeping Rue-specific palettes and tokens.

## Tailwind v4

Import the shared theme once in each web entry stylesheet:

```css
@import "@multiterm/rue-gds/styles/theme.css";
@source "../../../../libs/ui/src";
```

## Components

`@multiterm/rue-ui` provides shadcn-style Button, Card, Input, Textarea, Badge, Dialog, RueLogo, form, and theme components. Components use semantic utilities such as `bg-surface`, `text-foreground`, and `border-border`.

Buttons match the Honeycluster Portal contract: primary, secondary, outline, ghost, and destructive presentation; five sizes; semantic Primary, Secondary, Warning, Danger, and Success modes; and loading states. Inputs include default, action, date, amount, card-number, password, stepper, link, and dial variants with labels, helper/error text, and icon/add-on slots.

## Themes

Rue, Grove, Midnight, Paper, Mono, Sunset, and Ocean each support light and dark modes. Rue is the neutral default built around the current black, white, green, orange, and violet product palette.

Use Tailwind v4 semantic colors (`background`, `surface`, `elevated`, `foreground`, `muted`, `primary`, `inverse`, status colors, and `bot-1` through `bot-6`) rather than literal colors. Native clients consume the default `rueNativeThemes` palette or the complete `rueNativeThemePalettes` map from `@multiterm/rue-gds`.
