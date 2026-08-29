import type { ReactNode } from 'react';

interface ShelfProps {
  title: string;
  /** Optional trailing control — the "ทั้งหมด >" link on /home's rails. */
  action?: ReactNode;
  children?: ReactNode;
  /** Rendered in place of the scrolling rail. For empty states and other
   *  non-card bodies, which must not sit inside a snap-scroll container. */
  body?: ReactNode;
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
 *
 * The heading deliberately takes `--text-title`'s own weight (600) rather
 * than `font-extrabold` (800). The bug this component fixes is headings
 * bypassing the token in favour of a raw size and weight; re-adding
 * `font-extrabold` here would reintroduce exactly that override.
 */
export function Shelf({ title, action, children, body }: ShelfProps) {
  return (
    <section className="flex flex-col gap-(--spacing-shelf-head)">
      <div className="flex items-center justify-between px-(--spacing-shelf-inset) md:px-8 lg:px-10">
        <h2 className="font-display text-title tracking-tight text-fg">{title}</h2>
        {action}
      </div>
      {body !== undefined ? (
        <div className="px-(--spacing-shelf-inset) md:px-8 lg:px-10">{body}</div>
      ) : (
        <div className="scrollbar-hide flex snap-x snap-mandatory gap-(--spacing-shelf-gap) overflow-x-auto px-(--spacing-shelf-inset) pb-2 md:px-8 lg:px-10 [-webkit-overflow-scrolling:touch]">
          {children}
        </div>
      )}
    </section>
  );
}
