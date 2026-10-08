import { useState } from 'react'
import { Platform, Pressable, StyleSheet, type PressableProps, type ViewStyle } from 'react-native'

export type NativeButtonProps = PressableProps & { isLoading?: boolean; focusColor?: string }

/** Native entry point: deliberately imports no DOM, Radix or web CSS modules. */
export function NativeButton({ disabled, isLoading = false, focusColor = '#6366f1', accessibilityState,
  onFocus, onBlur, onHoverIn, onHoverOut, style, ...props }: NativeButtonProps) {
  const [focused, setFocused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const blocked = Boolean(disabled || isLoading || accessibilityState?.disabled)
  return <Pressable {...props}
    accessibilityRole={props.accessibilityRole ?? 'button'}
    accessibilityState={{ ...accessibilityState, disabled: blocked, busy: isLoading || accessibilityState?.busy }}
    disabled={blocked} focusable={!blocked && props.focusable !== false}
    onPress={blocked ? undefined : props.onPress}
    onLongPress={blocked ? undefined : props.onLongPress}
    onFocus={event => { if (!blocked) { setFocused(true); onFocus?.(event) } }}
    onBlur={event => { setFocused(false); onBlur?.(event) }}
    onHoverIn={event => { if (!blocked) { setHovered(true); onHoverIn?.(event) } }}
    onHoverOut={event => { setHovered(false); onHoverOut?.(event) }}
    style={state => {
      const custom = typeof style === 'function' ? style(state) : style
      const baseOpacity = StyleSheet.flatten(custom)?.opacity
      const opacity = typeof baseOpacity === 'number' ? baseOpacity : 1
      return [custom,
        { opacity: opacity * (blocked ? 0.45 : state.pressed ? 0.72 : hovered ? 0.88 : 1) },
        focused && !blocked ? { outlineColor: focusColor, outlineStyle: 'solid', outlineWidth: 2, outlineOffset: 2 } : undefined,
        Platform.OS === 'web' ? { cursor: blocked ? 'not-allowed' : 'pointer' } as ViewStyle : undefined,
      ]
    }} />
}
