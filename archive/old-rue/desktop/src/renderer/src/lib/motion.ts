/**
 * Shared motion tokens — every animation in Rue should reference one of
 * these. Keeps the feel consistent: micro-interactions snappy, content
 * transitions floaty, shell-level mounts springy.
 *
 * Replaces the prior ad-hoc mix of {stiffness:360, damping:28, mass:0.9},
 * {stiffness:400, damping:30}, {stiffness:460, damping:32}, etc.
 */

import type { Transition } from 'framer-motion'

/** Window-level mount / unmount (shell entrance, mode swap). */
export const SHELL: Transition = {
  type: 'spring',
  stiffness: 280,
  damping: 26,
  mass: 0.85
}

/** Popovers, dropdowns, attachment chips entering/leaving. */
export const POP: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 32
}

/** Inline content (message bubbles, status text). Eased, not springed,
 *  so streaming token re-renders don't bounce. */
export const INLINE: Transition = {
  duration: 0.2,
  ease: [0.22, 1, 0.36, 1]
}

/** Fast micro-interactions: button taps, hovers, status fades. */
export const SNAP: Transition = {
  duration: 0.14,
  ease: [0.22, 1, 0.36, 1]
}

/** Layout-shift transitions when the container resizes. */
export const RESIZE: Transition = {
  duration: 0.22,
  ease: [0.22, 1, 0.36, 1]
}
