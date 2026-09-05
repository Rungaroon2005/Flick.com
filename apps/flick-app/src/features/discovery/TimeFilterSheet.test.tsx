import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimeFilterSheet } from './TimeFilterSheet';
import { apiFetch } from '@/lib/apiClient';

vi.mock('@/lib/apiClient', () => ({
  apiFetch: vi.fn().mockResolvedValue([]),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe('TimeFilterSheet mood filter', () => {
  afterEach(() => {
    vi.mocked(apiFetch).mockClear();
  });

  it('fetches with the maxMinutes-only path when no mood is selected', async () => {
    render(<TimeFilterSheet open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '30 นาที' }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/discovery/fits?maxMinutes=30'));
  });

  it('includes the mood slug once a mood is chosen after a time', async () => {
    render(<TimeFilterSheet open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '30 นาที' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/discovery/fits?maxMinutes=30'));

    fireEvent.click(screen.getByRole('button', { name: /อยากลุ้น/ }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenLastCalledWith('/discovery/fits?maxMinutes=30&mood=thrill'),
    );
  });

  it('re-fetches without the mood when the same mood button is toggled off', async () => {
    render(<TimeFilterSheet open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '30 นาที' }));
    fireEvent.click(screen.getByRole('button', { name: /อยากลุ้น/ }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenLastCalledWith('/discovery/fits?maxMinutes=30&mood=thrill'),
    );

    fireEvent.click(screen.getByRole('button', { name: /อยากลุ้น/ }));

    await waitFor(() => expect(apiFetch).toHaveBeenLastCalledWith('/discovery/fits?maxMinutes=30'));
  });

  it('does not fetch when only a mood is picked and no time has been chosen yet', () => {
    render(<TimeFilterSheet open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /อยากลุ้น/ }));

    expect(apiFetch).not.toHaveBeenCalled();
  });
});
