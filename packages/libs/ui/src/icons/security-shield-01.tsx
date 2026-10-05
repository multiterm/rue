import * as React from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  color?: string; // defaults to currentColor so Tailwind text-* applies
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
  tone?: 'original' | 'grayscale' | 'black' | 'white';
  /**
   * Controls how colors are applied:
   * - 'original': keep original inline fill/stroke from the SVG
   * - 'stripped': remove inline fill/stroke so className/text color can apply
   * - 'currentColor': like 'stripped', and also force svg fill/stroke to currentColor
   */
  colorMode?: 'original' | 'stripped' | 'currentColor';
  /** @deprecated Use colorMode instead */
  fillMode?: 'none' | 'currentColor';
}

const SecurityShield01 = React.forwardRef<SVGSVGElement, IconProps>(function SecurityShield01(
  {
    color = 'currentColor',
    size = 24,
    strokeWidth = 2,
    absoluteStrokeWidth,
    tone = 'original',
    colorMode,
    fillMode = 'none',
    className,
    style,
    ...rest
  },
  ref
) {
  const computedStrokeWidth = absoluteStrokeWidth
    ? (Number(strokeWidth) * 24) / Number(size)
    : strokeWidth;
  const filter =
    tone === 'grayscale'
      ? 'grayscale(1)'
      : tone === 'black'
        ? 'brightness(0)'
        : tone === 'white'
          ? 'brightness(0) invert(1)'
          : undefined;
  const effectiveColorMode =
    colorMode ?? (fillMode === 'currentColor' ? 'currentColor' : 'original');
  const DEFAULT_ORIGINAL_FILL = null as string | null;
  const DEFAULT_ORIGINAL_STROKE = null as string | null;
  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      // Force currentColor only when requested
      fill={effectiveColorMode === 'currentColor' ? 'currentColor' : undefined}
      stroke={effectiveColorMode === 'currentColor' ? 'currentColor' : undefined}
      strokeWidth={computedStrokeWidth as number}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={filter ? { ...(style || {}), filter } : style}
      data-default-fill={DEFAULT_ORIGINAL_FILL ?? undefined}
      data-default-stroke={DEFAULT_ORIGINAL_STROKE ?? undefined}
      {...rest}>
      <g
        dangerouslySetInnerHTML={{
          __html:
            effectiveColorMode === 'original'
              ? '<path d="M11.302 21.615c.221.13.332.194.488.227.122.026.298.026.42 0 .156-.033.267-.098.488-.227C14.646 20.479 20 16.909 20 12V7.218c0-.8 0-1.2-.13-1.543a2 2 0 0 0-.548-.79c-.275-.242-.65-.383-1.398-.664l-5.362-2.01c-.208-.078-.312-.117-.419-.133a1 1 0 0 0-.286 0c-.107.016-.21.055-.419.133L6.076 4.22c-.748.281-1.122.422-1.398.665a2 2 0 0 0-.547.789C4 6.018 4 6.418 4 7.218V12c0 4.909 5.354 8.479 7.302 9.615z" stroke-linecap="round" stroke-linejoin="round"/>'
              : '<path d="M11.302 21.615c.221.13.332.194.488.227.122.026.298.026.42 0 .156-.033.267-.098.488-.227C14.646 20.479 20 16.909 20 12V7.218c0-.8 0-1.2-.13-1.543a2 2 0 0 0-.548-.79c-.275-.242-.65-.383-1.398-.664l-5.362-2.01c-.208-.078-.312-.117-.419-.133a1 1 0 0 0-.286 0c-.107.016-.21.055-.419.133L6.076 4.22c-.748.281-1.122.422-1.398.665a2 2 0 0 0-.547.789C4 6.018 4 6.418 4 7.218V12c0 4.909 5.354 8.479 7.302 9.615z" stroke-linecap="round" stroke-linejoin="round"/>',
        }}
      />
    </svg>
  );
});

SecurityShield01.displayName = 'SecurityShield01';

export default SecurityShield01;
