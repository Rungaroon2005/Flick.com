import type { ReactNode } from 'react';

interface ShelfProps {
  title: string;
  /** Optional trailing control — the "ทั้งหมด >" link on /home's rails. */
  action?: ReactNode;
  children: ReactNode;
}

/**
 * A titled horizontal rail. Exists so the shelf rhythm is stated once
 * rather than at six call sites: before this, HomeClient repeated
 * `px-5 md:px-8 lg:px-10` verbatim for every heading row and every rail,
 * and used the same gap-3 to separate a heading from its content as to
 * separate two cards.
 *
 * The rail keeps its own horizontal padding rather than inheriting it from
 * a parent, because the scroll container must run edge to edge — padding on
 * an ancestor would clip the first and last card's overhang instead of
 * letting them scroll past.
 */
export function Shelf({ title, action, children }: ShelfProps) {
  return (
    <section className="flex flex-col gap-(--spacing-shelf-head)">
      <div className="flex items-center justify-between px-(--spacing-shelf-inset) md:px-8 lg:px-10">
        <h2 className="font-display text-title tracking-tight text-fg">{title}</h2>
        {action}
      </div>
      <div className="scrollbar-hide flex snap-x snap-mandatory gap-(--spacing-shelf-gap) overflow-x-auto px-(--spacing-shelf-inset) pb-2 md:px-8 lg:px-10 [-webkit-overflow-scrolling:touch]">
        {children}
      </div>
    </section>
  );
}
