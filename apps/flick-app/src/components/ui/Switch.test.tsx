import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch';

describe('Switch', () => {
  it('exposes its state via role=switch and aria-checked', () => {
    render(<Switch checked={true} onChange={() => {}} label="โหมดกลางคืน" />);
    const el = screen.getByRole('switch', { name: 'โหมดกลางคืน' });
    expect(el).toHaveAttribute('aria-checked', 'true');
  });

  it('reports aria-checked=false when unchecked', () => {
    render(<Switch checked={false} onChange={() => {}} label="โหมดกลางคืน" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onChange with the flipped value on click', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="โหมดกลางคืน" />);
    await screen.getByRole('switch').click();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('carries the focus ring', () => {
    render(<Switch checked={false} onChange={() => {}} label="โหมดกลางคืน" />);
    expect(screen.getByRole('switch').className).toContain('focus-ring');
  });

  it('is a real <button>, not a div with a click handler', () => {
    render(<Switch checked={false} onChange={() => {}} label="โหมดกลางคืน" />);
    expect(screen.getByRole('switch').tagName).toBe('BUTTON');
  });
});
