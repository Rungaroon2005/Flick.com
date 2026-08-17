/**
 * The app ground for every full screen. Replaces the wrapper div that was
 * copy-pasted across nine files, each carrying its own bottom-nav offset.
 *
 * The offset exists because BottomNav is position:fixed and would otherwise
 * cover the last row of content. At lg the bottom nav is replaced by the
 * header bar (see HeaderNav), so the offset shrinks to ordinary page padding.
 */
export function PageShell({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`min-h-dvh bg-ink pb-[calc(96px+env(safe-area-inset-bottom))] lg:pb-16 ${className}`}
    >
      {children}
    </div>
  );
}
