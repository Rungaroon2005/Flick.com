import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SearchClient from './SearchClient';
import { apiFetch } from '@/lib/apiClient';
import type { Movie } from '@/types';

vi.mock('@/lib/apiClient', () => ({
  apiFetch: vi.fn().mockResolvedValue([]),
}));

describe('SearchClient hydration', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
  });

  it('hydrates the server snapshot before revealing browser-only recent searches', async () => {
    window.localStorage.setItem('flick:recent-searches', JSON.stringify(['ดราม่าล่าสุด']));
    const container = document.createElement('div');
    container.innerHTML = renderToString(<SearchClient />);
    document.body.append(container);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const root = hydrateRoot(container, <SearchClient />);
    await waitFor(() => expect(screen.getByText('ดราม่าล่าสุด')).toBeInTheDocument());

    const messages = consoleError.mock.calls.flat().join(' ');
    expect(messages).not.toMatch(/hydration|did not match/i);
    act(() => root.unmount());
  });
});

describe('SearchClient search', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(apiFetch).mockClear();
  });

  it('fetches the server after a debounce instead of filtering in memory', async () => {
    vi.mocked(apiFetch).mockResolvedValue([
      { id: 'm1', title: 'ดราม่าเมือง', genres: [] } as unknown as Movie,
    ]);
    render(<SearchClient />);

    fireEvent.change(screen.getByPlaceholderText('ค้นหาภาพยนตร์จีน, ภาพยนตร์ไทย...'), {
      target: { value: 'ดราม่า' },
    });
    expect(apiFetch).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(250));

    expect(apiFetch).toHaveBeenCalledWith(`/movies?q=${encodeURIComponent('ดราม่า')}`);
    await waitFor(() => expect(screen.getByText('ดราม่าเมือง')).toBeInTheDocument());
  });
});
