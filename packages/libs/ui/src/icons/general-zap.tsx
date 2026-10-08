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

const GeneralZap = React.forwardRef<SVGSVGElement, IconProps>(function GeneralZap(
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
              ? '<path d="M12.9999 2L4.09332 12.6879C3.74451 13.1064 3.57011 13.3157 3.56744 13.4925C3.56512 13.6461 3.63359 13.7923 3.75312 13.8889C3.89061 14 4.16304 14 4.7079 14H11.9999L10.9999 22L19.9064 11.3121C20.2552 10.8936 20.4296 10.6843 20.4323 10.5075C20.4346 10.3539 20.3661 10.2077 20.2466 10.1111C20.1091 10 19.8367 10 19.2918 10H11.9999L12.9999 2Z" stroke-linecap="round" stroke-linejoin="round"/>'
              : '<path d="M12.9999 2L4.09332 12.6879C3.74451 13.1064 3.57011 13.3157 3.56744 13.4925C3.56512 13.6461 3.63359 13.7923 3.75312 13.8889C3.89061 14 4.16304 14 4.7079 14H11.9999L10.9999 22L19.9064 11.3121C20.2552 10.8936 20.4296 10.6843 20.4323 10.5075C20.4346 10.3539 20.3661 10.2077 20.2466 10.1111C20.1091 10 19.8367 10 19.2918 10H11.9999L12.9999 2Z" stroke-linecap="round" stroke-linejoin="round"/>',
        }}
      />
    </svg>
  );
});

GeneralZap.displayName = 'GeneralZap';

export default GeneralZap;
