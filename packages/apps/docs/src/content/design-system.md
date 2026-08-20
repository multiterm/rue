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

Buttons match the Honeycluster Portal contract: primary, secondary, outline, ghost, and destructive presentation; five sizes; semantic Primary, Secondary, Warning, Danger, and Success modes; and loading states. Inputs include default, action, date, amount, card-number, password, stepper, link, and dial variants with labels, helper/error text, and icon/add-on slots.

## Themes

Grove, Midnight, Paper, and Mono each support light and dark modes. Native clients consume `rueNativeThemes` from `@multiterm/rue-gds`.
