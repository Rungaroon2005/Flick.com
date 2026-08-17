import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Container } from './Container';

describe('Container', () => {
  it('defaults to page width with the responsive gutter scale', () => {
    const { container } = render(<Container><span /></Container>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('max-w-page');
    expect(el.className).toContain('px-5');
    expect(el.className).toContain('md:px-8');
    expect(el.className).toContain('lg:px-10');
  });

  // Settings lists and forms must not stretch to 1400px.
  it('uses reading width when asked', () => {
    const { container } = render(<Container width="reading"><span /></Container>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('max-w-reading');
    expect(el.className).not.toContain('max-w-page');
  });
});
