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

const GeneralTrash01 = React.forwardRef<SVGSVGElement, IconProps>(function GeneralTrash01(
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
              ? '<path d="M16 6V5.2C16 4.0799 16 3.51984 15.782 3.09202C15.5903 2.71569 15.2843 2.40973 14.908 2.21799C14.4802 2 13.9201 2 12.8 2H11.2C10.0799 2 9.51984 2 9.09202 2.21799C8.71569 2.40973 8.40973 2.71569 8.21799 3.09202C8 3.51984 8 4.0799 8 5.2V6M10 11.5V16.5M14 11.5V16.5M3 6H21M19 6V17.2C19 18.8802 19 19.7202 18.673 20.362C18.3854 20.9265 17.9265 21.3854 17.362 21.673C16.7202 22 15.8802 22 14.2 22H9.8C8.11984 22 7.27976 22 6.63803 21.673C6.07354 21.3854 5.6146 20.9265 5.32698 20.362C5 19.7202 5 18.8802 5 17.2V6" stroke-linecap="round" stroke-linejoin="round"/>'
              : '<path d="M16 6V5.2C16 4.0799 16 3.51984 15.782 3.09202C15.5903 2.71569 15.2843 2.40973 14.908 2.21799C14.4802 2 13.9201 2 12.8 2H11.2C10.0799 2 9.51984 2 9.09202 2.21799C8.71569 2.40973 8.40973 2.71569 8.21799 3.09202C8 3.51984 8 4.0799 8 5.2V6M10 11.5V16.5M14 11.5V16.5M3 6H21M19 6V17.2C19 18.8802 19 19.7202 18.673 20.362C18.3854 20.9265 17.9265 21.3854 17.362 21.673C16.7202 22 15.8802 22 14.2 22H9.8C8.11984 22 7.27976 22 6.63803 21.673C6.07354 21.3854 5.6146 20.9265 5.32698 20.362C5 19.7202 5 18.8802 5 17.2V6" stroke-linecap="round" stroke-linejoin="round"/>',
        }}
      />
    </svg>
  );
});

GeneralTrash01.displayName = 'GeneralTrash01';

export default GeneralTrash01;
