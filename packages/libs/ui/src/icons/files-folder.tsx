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

const FilesFolder = React.forwardRef<SVGSVGElement, IconProps>(function FilesFolder(
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
              ? '<path d="m13 7-1.116-2.231c-.32-.642-.481-.963-.72-1.198a2 2 0 0 0-.748-.462C10.1 3 9.74 3 9.022 3H5.2c-1.12 0-1.68 0-2.108.218a2 2 0 0 0-.874.874C2 4.52 2 5.08 2 6.2V7m0 0h15.2c1.68 0 2.52 0 3.162.327a3 3 0 0 1 1.311 1.311C22 9.28 22 10.12 22 11.8v4.4c0 1.68 0 2.52-.327 3.162a3 3 0 0 1-1.311 1.311C19.72 21 18.88 21 17.2 21H6.8c-1.68 0-2.52 0-3.162-.327a3 3 0 0 1-1.311-1.311C2 18.72 2 17.88 2 16.2V7z" stroke-linecap="round" stroke-linejoin="round"/>'
              : '<path d="m13 7-1.116-2.231c-.32-.642-.481-.963-.72-1.198a2 2 0 0 0-.748-.462C10.1 3 9.74 3 9.022 3H5.2c-1.12 0-1.68 0-2.108.218a2 2 0 0 0-.874.874C2 4.52 2 5.08 2 6.2V7m0 0h15.2c1.68 0 2.52 0 3.162.327a3 3 0 0 1 1.311 1.311C22 9.28 22 10.12 22 11.8v4.4c0 1.68 0 2.52-.327 3.162a3 3 0 0 1-1.311 1.311C19.72 21 18.88 21 17.2 21H6.8c-1.68 0-2.52 0-3.162-.327a3 3 0 0 1-1.311-1.311C2 18.72 2 17.88 2 16.2V7z" stroke-linecap="round" stroke-linejoin="round"/>',
        }}
      />
    </svg>
  );
});

FilesFolder.displayName = 'FilesFolder';

export default FilesFolder;
