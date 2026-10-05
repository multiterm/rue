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

const CommunicationMessageCheckCircle = React.forwardRef<SVGSVGElement, IconProps>(
  function CommunicationMessageCheckCircle(
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
    const DEFAULT_ORIGINAL_STROKE = '#000' as string | null;
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
                ? '<path d="m9.5 11.5 2 2L16 9m-3.5 11a8.5 8.5 0 1 0-8.057-5.783c.108.32.162.481.172.604a.899.899 0 0 1-.028.326c-.03.12-.098.245-.232.494l-1.636 3.027c-.233.432-.35.648-.324.815a.5.5 0 0 0 .234.35c.144.087.388.062.876.011l5.121-.529c.155-.016.233-.024.303-.021.07.002.12.009.187.024.069.016.155.05.329.116A8.478 8.478 0 0 0 12.5 20z" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
                : '<path d="m9.5 11.5 2 2L16 9m-3.5 11a8.5 8.5 0 1 0-8.057-5.783c.108.32.162.481.172.604a.899.899 0 0 1-.028.326c-.03.12-.098.245-.232.494l-1.636 3.027c-.233.432-.35.648-.324.815a.5.5 0 0 0 .234.35c.144.087.388.062.876.011l5.121-.529c.155-.016.233-.024.303-.021.07.002.12.009.187.024.069.016.155.05.329.116A8.478 8.478 0 0 0 12.5 20z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
          }}
        />
      </svg>
    );
  }
);

CommunicationMessageCheckCircle.displayName = 'CommunicationMessageCheckCircle';

export default CommunicationMessageCheckCircle;
