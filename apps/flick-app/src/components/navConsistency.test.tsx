import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HeaderNav } from './ui/HeaderNav';
import BottomNav from './BottomNav';
import { NAV_ITEMS } from './navItems';

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname }));

/**
 * The two renderers must never disagree about what the tabs are. Adding a
 * fifth tab to one and not the other is a silent failure: it only shows up
 * on one class of device.
 */
describe('navigation sources', () => {
  it('renders the same destinations in both regimes', () => {
    usePathname.mockReturnValue('/home');
    const expected = NAV_ITEMS.map((item) => item.path).sort();

    const header = render(<HeaderNav />);
    const headerPaths = [...header.container.querySelectorAll('a')]
      .map((a) => a.getAttribute('href'))
      .sort();
    header.unmount();

    const bottom = render(<BottomNav />);
    const bottomPaths = [...bottom.container.querySelectorAll('a')]
      .map((a) => a.getAttribute('href'))
      .sort();
    bottom.unmount();

    expect(headerPaths).toEqual(expected);
    expect(bottomPaths).toEqual(expected);
  });

  it('hides the bottom pill at lg', () => {
    usePathname.mockReturnValue('/home');
    const { container } = render(<BottomNav />);
    expect((container.querySelector('nav') as HTMLElement).className).toContain('lg:hidden');
  });
});
