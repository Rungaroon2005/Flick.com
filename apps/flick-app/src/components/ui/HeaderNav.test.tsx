import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HeaderNav } from './HeaderNav';

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname }));

describe('HeaderNav', () => {
  it('marks the current route with aria-current', () => {
    usePathname.mockReturnValue('/discover');
    render(<HeaderNav />);
    expect(screen.getByRole('link', { name: /แนะนำ/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /หน้าหลัก/ })).not.toHaveAttribute('aria-current');
  });

  // Hidden below lg: the bottom pill owns navigation on phone and
  // iPad-portrait, and two navs on one screen is a bug, not a fallback.
  it('is hidden below lg', () => {
    usePathname.mockReturnValue('/home');
    const { container } = render(<HeaderNav />);
    const nav = container.querySelector('nav') as HTMLElement;
    expect(nav.className).toContain('hidden');
    expect(nav.className).toContain('lg:flex');
  });
});
