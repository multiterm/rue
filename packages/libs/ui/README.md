# @multiterm/rue-ui

Shared shadcn-style React components for Rue web surfaces.

Components use semantic Tailwind v4 tokens from `@multiterm/rue-gds`, so webapp, docs, site, and Electron share the same palettes and behavior.

```tsx
import { Button, Card, ThemeProvider } from '@multiterm/rue-ui'
import '@multiterm/rue-gds/styles/theme.css'
```

Available foundations include buttons, cards, inputs, textareas, badges, and theme controls.

Buttons mirror the Portal GDS API with `primary`, `secondary`, `outline`, `ghost`, and `destructive` variants; `mini`, `sm`, `regular`, `lg`, and `icon` sizes; semantic modes; and loading states. Inputs support `default`, `action`, `date`, `amount`, `card-number`, `password`, `stepper`, `link`, and `dial` variants with labels, helper/error text, and leading/trailing content.
