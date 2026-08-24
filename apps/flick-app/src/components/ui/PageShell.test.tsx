import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageShell } from './PageShell';

describe('PageShell', () => {
  it('renders its children', () => {
    render(<PageShell><p>เนื้อหา</p></PageShell>);
    expect(screen.getByText('เนื้อหา')).toBeInTheDocument();
  });

  // The bottom-nav offset must disappear at lg, where BottomNav is hidden.
  // Without lg:pb-16 every desktop page carries 96px of dead space.
  it('drops the bottom-nav offset at lg', () => {
    const { container } = render(<PageShell><span /></PageShell>);
    const shell = container.firstElementChild as HTMLElement;
    expect(shell.className).toContain('pb-[calc(96px+env(safe-area-inset-bottom))]');
    expect(shell.className).toContain('lg:pb-16');
  });

  it('appends caller classes', () => {
    const { container } = render(<PageShell className="custom-x"><span /></PageShell>);
    expect((container.firstElementChild as HTMLElement).className).toContain('custom-x');
  });
});
