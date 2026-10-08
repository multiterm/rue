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

const ArrowsRefreshCw01 = React.forwardRef<SVGSVGElement, IconProps>(function ArrowsRefreshCw01(
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
              ? '<path d="M21 10C21 10 18.995 7.26822 17.3662 5.63824C15.7373 4.00827 13.4864 3 11 3C6.02944 3 2 7.02944 2 12C2 16.9706 6.02944 21 11 21C15.1031 21 18.5649 18.2543 19.6482 14.5M21 10V4M21 10H15" stroke-linecap="round" stroke-linejoin="round"/>'
              : '<path d="M21 10C21 10 18.995 7.26822 17.3662 5.63824C15.7373 4.00827 13.4864 3 11 3C6.02944 3 2 7.02944 2 12C2 16.9706 6.02944 21 11 21C15.1031 21 18.5649 18.2543 19.6482 14.5M21 10V4M21 10H15" stroke-linecap="round" stroke-linejoin="round"/>',
        }}
      />
    </svg>
  );
});

ArrowsRefreshCw01.displayName = 'ArrowsRefreshCw01';

export default ArrowsRefreshCw01;
