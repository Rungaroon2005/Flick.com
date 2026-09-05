import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MovieCard from './MovieCard';
import type { Movie } from '@/types';

const movie = {
  id: 'm1',
  title: 'เรื่องทดสอบ',
  posterUrl: '/posters/sathu.jpg',
  year: 2026,
  genres: [],
  seasons: [],
} as unknown as Movie;

describe('MovieCard', () => {
  // The blurriness regression: growing the rendered card without growing the
  // sizes hint makes the browser pick the old narrow rendition and upscale
  // it, so desktop ends up visibly worse than before the responsive pass.
  it('declares a sizes hint that covers desktop widths', () => {
    const { container } = render(<MovieCard movie={movie} size="medium" />);
    const sizes = (container.querySelector('img') as HTMLImageElement).getAttribute('sizes') ?? '';
    expect(sizes).toContain('min-width: 1280px');
    expect(sizes).toMatch(/2[0-9]{2}px/);
  });

  it('grows the medium card at md and xl', () => {
    const { container } = render(<MovieCard movie={movie} size="medium" />);
    const className = (container.firstElementChild as HTMLElement).className;
    expect(className).toContain('md:w-[160px]');
    expect(className).toContain('xl:w-[180px]');
  });

  it('leaves fill cards to their grid', () => {
    const { container } = render(<MovieCard movie={movie} size="fill" />);
    expect((container.firstElementChild as HTMLElement).className).toContain('w-full');
  });

  it('shows nothing extra when watchStatus is omitted', () => {
    const { container } = render(<MovieCard movie={movie} />);
    expect(container.querySelectorAll('svg').length).toBe(0);
  });

  it('shows a checkmark badge for a fully watched movie', () => {
    const { container } = render(
      <MovieCard movie={movie} watchStatus={{ state: 'watched', percent: 100, lastWatchedAt: null }} />,
    );
    expect(container.querySelectorAll('svg').length).toBe(1);
  });

  it('shows a progress bar sized to the percent for a partially watched movie', () => {
    const { container } = render(
      <MovieCard movie={movie} watchStatus={{ state: 'partial', percent: 45, lastWatchedAt: null }} />,
    );
    const bar = container.querySelector('[data-testid="watch-progress"]') as HTMLElement;
    expect(bar.style.width).toBe('45%');
  });

  it('shows nothing for a never-watched movie', () => {
    const { container } = render(
      <MovieCard movie={movie} watchStatus={{ state: 'none', percent: 0, lastWatchedAt: null }} />,
    );
    expect(container.querySelectorAll('svg').length).toBe(0);
  });
});
