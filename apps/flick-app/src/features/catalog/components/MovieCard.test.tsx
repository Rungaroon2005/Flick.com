import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MovieCard from './MovieCard';
import { HOLD_MS } from '../hooks/usePosterPreview';
import type { Movie } from '@/types';

const movie = {
  id: 'm1',
  title: 'เรื่องทดสอบ',
  posterUrl: '/posters/sathu.jpg',
  year: 2026,
  genres: [],
  seasons: [],
} as unknown as Movie;

const movieWithTrailer = {
  ...movie,
  id: 'm2',
  trailerUrl: '/videos/movie1-preview.m4v',
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

describe('MovieCard poster preview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never renders a video for a movie with no trailerUrl, even after a long touch hold', () => {
    const { container } = render(<MovieCard movie={movie} />);
    const link = container.querySelector('a') as HTMLElement;
    fireEvent.pointerDown(link, { pointerType: 'touch', clientX: 0, clientY: 0 });
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(container.querySelector('video')).toBeNull();
  });

  it('swaps to a muted, playsInline video after a touch hold past the threshold', () => {
    const { container } = render(<MovieCard movie={movieWithTrailer} />);
    const link = container.querySelector('a') as HTMLElement;
    fireEvent.pointerDown(link, { pointerType: 'touch', clientX: 0, clientY: 0 });
    act(() => vi.advanceTimersByTime(HOLD_MS));

    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
  });

  it('does not show a video before the hold threshold elapses', () => {
    const { container } = render(<MovieCard movie={movieWithTrailer} />);
    const link = container.querySelector('a') as HTMLElement;
    fireEvent.pointerDown(link, { pointerType: 'touch', clientX: 0, clientY: 0 });
    expect(container.querySelector('video')).toBeNull();
  });

  it('cancels the hold if the touch moves past 10px, leaving the poster alone', () => {
    const { container } = render(<MovieCard movie={movieWithTrailer} />);
    const link = container.querySelector('a') as HTMLElement;
    fireEvent.pointerDown(link, { pointerType: 'touch', clientX: 0, clientY: 0 });
    fireEvent.pointerMove(link, { pointerType: 'touch', clientX: 30, clientY: 0 });
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(container.querySelector('video')).toBeNull();
  });

  it('shows the preview on desktop hover-intent, without requiring a press', () => {
    const { container } = render(<MovieCard movie={movieWithTrailer} />);
    const link = container.querySelector('a') as HTMLElement;
    fireEvent.pointerEnter(link, { pointerType: 'mouse', clientX: 0, clientY: 0 });
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(container.querySelector('video')).not.toBeNull();
  });

  it('stops the preview and lets the poster show again on pointer leave', () => {
    const { container } = render(<MovieCard movie={movieWithTrailer} />);
    const link = container.querySelector('a') as HTMLElement;
    fireEvent.pointerEnter(link, { pointerType: 'mouse', clientX: 0, clientY: 0 });
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(container.querySelector('video')).not.toBeNull();

    fireEvent.pointerLeave(link, { pointerType: 'mouse', clientX: 0, clientY: 0 });
    expect(container.querySelector('video')).toBeNull();
  });

  it('suppresses navigation for the click that follows a completed touch hold', () => {
    const { container } = render(<MovieCard movie={movieWithTrailer} />);
    const link = container.querySelector('a') as HTMLElement;
    fireEvent.pointerDown(link, { pointerType: 'touch', clientX: 0, clientY: 0 });
    act(() => vi.advanceTimersByTime(HOLD_MS));
    fireEvent.pointerUp(link, { pointerType: 'touch', clientX: 0, clientY: 0 });

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    const prevented = !link.dispatchEvent(clickEvent);
    expect(prevented).toBe(true);
  });

  it('does not suppress navigation for a plain tap that never held long enough', () => {
    const { container } = render(<MovieCard movie={movieWithTrailer} />);
    const link = container.querySelector('a') as HTMLElement;
    fireEvent.pointerDown(link, { pointerType: 'touch', clientX: 0, clientY: 0 });
    fireEvent.pointerUp(link, { pointerType: 'touch', clientX: 0, clientY: 0 });

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    const prevented = !link.dispatchEvent(clickEvent);
    expect(prevented).toBe(false);
  });
});
