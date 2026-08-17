const WIDTHS = {
  page: 'max-w-page',
  reading: 'max-w-reading',
} as const;

/**
 * Centers content and owns the gutter scale.
 *
 * IMPORTANT: never wrap a horizontal shelf in this. A shelf scroller carries
 * its own gutter as padding so cards bleed to the viewport edge and the next
 * card peeks — containing it clips that and turns a carousel into a boxed
 * row. For shelves, wrap the section heading only and give the scroller a
 * matching `px-5 md:px-8 lg:px-10`. See HomeClient for the shape.
 */
export function Container({
  children,
  width = 'page',
  className = '',
}: {
  children: React.ReactNode;
  width?: keyof typeof WIDTHS;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full ${WIDTHS[width]} px-5 md:px-8 lg:px-10 ${className}`}>
      {children}
    </div>
  );
}
