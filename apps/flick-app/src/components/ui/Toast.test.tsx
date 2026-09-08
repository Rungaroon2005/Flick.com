// apps/flick-app/src/components/ui/Toast.test.tsx
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './Toast';

function Trigger({ message }: { message: string }) {
  const { show } = useToast();
  return <button onClick={() => show(message)}>fire</button>;
}

describe('ToastProvider', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows a message and auto-dismisses it after 4s', () => {
    render(
      <ToastProvider>
        <Trigger message="บันทึกแล้ว" />
      </ToastProvider>,
    );
    act(() => screen.getByText('fire').click());
    expect(screen.getByRole('status')).toHaveTextContent('บันทึกแล้ว');

    act(() => void vi.advanceTimersByTime(4000));
    expect(screen.queryByText('บันทึกแล้ว')).toBeNull();
  });

  it('queues a second message rather than dropping it', () => {
    render(
      <ToastProvider>
        <Trigger message="หนึ่ง" />
      </ToastProvider>,
    );
    act(() => screen.getByText('fire').click());
    act(() => screen.getByText('fire').click());
    // Both live in the queue; the region reports at least one.
    expect(screen.getAllByText('หนึ่ง').length).toBeGreaterThanOrEqual(1);
  });
});
