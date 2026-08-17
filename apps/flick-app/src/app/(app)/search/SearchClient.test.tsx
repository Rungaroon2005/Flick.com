import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SearchClient from './SearchClient';

describe('SearchClient hydration', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
  });

  it('hydrates the server snapshot before revealing browser-only recent searches', async () => {
    window.localStorage.setItem('flick:recent-searches', JSON.stringify(['ดราม่าล่าสุด']));
    const container = document.createElement('div');
    container.innerHTML = renderToString(<SearchClient initialMovies={[]} />);
    document.body.append(container);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const root = hydrateRoot(container, <SearchClient initialMovies={[]} />);
    await waitFor(() => expect(screen.getByText('ดราม่าล่าสุด')).toBeInTheDocument());

    const messages = consoleError.mock.calls.flat().join(' ');
    expect(messages).not.toMatch(/hydration|did not match/i);
    act(() => root.unmount());
  });
});
