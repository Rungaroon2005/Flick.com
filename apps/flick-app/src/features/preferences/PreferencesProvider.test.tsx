import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesProvider, usePreferences } from './PreferencesProvider';
import { PREFS_STORAGE_KEY } from './prefs';

// Cleared in both beforeEach and afterEach: this is ambient, global DOM
// and storage state, and depending solely on the PREVIOUS test's cleanup
// having already run leaves this suite fragile to run order across files.
beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-night');
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-night');
});

function Consumer() {
  const { prefs, setNight, setAutoplayNext, setAutoSkip } = usePreferences();
  return (
    <div>
      <span data-testid="night">{String(prefs.night)}</span>
      <span data-testid="autoplay">{String(prefs.autoplayNext)}</span>
      <span data-testid="autoskip">{String(prefs.autoSkip)}</span>
      <button onClick={() => setNight(true)}>night on</button>
      <button onClick={() => setNight(false)}>night off</button>
      <button onClick={() => setAutoplayNext(false)}>autoplay off</button>
      <button onClick={() => setAutoSkip(true)}>autoskip on</button>
    </div>
  );
}

describe('usePreferences', () => {
  it('throws outside a PreferencesProvider', () => {
    // Suppress the expected React error-boundary console.error noise.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow(
      'usePreferences must be used inside a PreferencesProvider',
    );
    spy.mockRestore();
  });

  it('loads a stored preference after mount', async () => {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ night: true }));
    render(
      <PreferencesProvider>
        <Consumer />
      </PreferencesProvider>,
    );
    expect(await screen.findByTestId('night')).toHaveTextContent('true');
  });

  it('mirrors night: true to documentElement as data-night="on"', async () => {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ night: true }));
    render(
      <PreferencesProvider>
        <Consumer />
      </PreferencesProvider>,
    );
    // Waiting on the text content as a proxy for the DOM-mirror effect
    // having ALSO run is unsound: they are two independent reactions to
    // the same state update (one a DOM commit, the other a passive effect
    // React schedules separately), and nothing orders one before the
    // other is externally observable. waitFor polls the actual condition
    // instead of a stand-in for it.
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-night')).toBe('on');
    });
  });

  it('removes data-night rather than setting it to "off"', async () => {
    document.documentElement.setAttribute('data-night', 'on');
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ night: false }));
    render(
      <PreferencesProvider>
        <Consumer />
      </PreferencesProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('night')).toHaveTextContent('false');
      expect(document.documentElement.hasAttribute('data-night')).toBe(false);
    });
  });

  it('a boot-script value that agrees with storage survives settling, unchanged', async () => {
    // Simulates what the inline pre-paint script already did before React
    // ever mounted. The end state must still be 'on' -- not proof that no
    // frame flickered, but it does catch the boolean being backwards.
    document.documentElement.setAttribute('data-night', 'on');
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ night: true }));
    render(
      <PreferencesProvider>
        <Consumer />
      </PreferencesProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('night')).toHaveTextContent('true');
      expect(document.documentElement.getAttribute('data-night')).toBe('on');
    });
  });

  it('setNight updates state, persists, and mirrors to the DOM', async () => {
    render(
      <PreferencesProvider>
        <Consumer />
      </PreferencesProvider>,
    );
    await screen.findByTestId('night');

    await act(async () => {
      screen.getByText('night on').click();
    });

    expect(screen.getByTestId('night')).toHaveTextContent('true');
    expect(document.documentElement.getAttribute('data-night')).toBe('on');
    expect(JSON.parse(window.localStorage.getItem(PREFS_STORAGE_KEY) as string)).toMatchObject({
      night: true,
    });

    await act(async () => {
      screen.getByText('night off').click();
    });
    expect(document.documentElement.hasAttribute('data-night')).toBe(false);
  });

  it('setAutoplayNext and setAutoSkip persist independently of night', async () => {
    render(
      <PreferencesProvider>
        <Consumer />
      </PreferencesProvider>,
    );
    await screen.findByTestId('night');

    await act(async () => {
      screen.getByText('autoplay off').click();
    });
    await act(async () => {
      screen.getByText('autoskip on').click();
    });

    expect(screen.getByTestId('autoplay')).toHaveTextContent('false');
    expect(screen.getByTestId('autoskip')).toHaveTextContent('true');
    expect(JSON.parse(window.localStorage.getItem(PREFS_STORAGE_KEY) as string)).toMatchObject({
      autoplayNext: false,
      autoSkip: true,
    });
  });

  it('turning night on forces autoplayNext off, coupled in one write', async () => {
    // Spec: Night Mode's side effects are Prefs writes, not separate state.
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ autoplayNext: true }));
    render(
      <PreferencesProvider>
        <Consumer />
      </PreferencesProvider>,
    );
    await screen.findByTestId('night');

    await act(async () => {
      screen.getByText('night on').click();
    });

    expect(screen.getByTestId('autoplay')).toHaveTextContent('false');
    expect(JSON.parse(window.localStorage.getItem(PREFS_STORAGE_KEY) as string)).toMatchObject({
      night: true,
      autoplayNext: false,
    });
  });
});
