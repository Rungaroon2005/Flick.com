import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NightSuggestion } from './NightSuggestion';
import { PreferencesProvider, usePreferences } from './PreferencesProvider';
import { NIGHT_SUGGESTION_KEY } from './nightSuggestionStorage';
import { PREFS_STORAGE_KEY } from './prefs';

function setHour(hour: number) {
  const now = new Date();
  now.setHours(hour, 0, 0, 0);
  vi.setSystemTime(now);
}

function NightReadout() {
  const { prefs } = usePreferences();
  return <span data-testid="night">{String(prefs.night)}</span>;
}

function renderSuggestion() {
  return render(
    <PreferencesProvider>
      <NightReadout />
      <NightSuggestion />
    </PreferencesProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-night');
  // Only Date is faked: findByRole/waitFor poll via real setTimeout, and
  // faking that too would freeze their own polling loop right alongside
  // the clock, timing out every await.
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-night');
});

describe('NightSuggestion', () => {
  it('offers itself at 23:00 when never suggested before', async () => {
    setHour(23);
    renderSuggestion();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('does not offer itself during the day', async () => {
    setHour(14);
    renderSuggestion();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks itself suggested the instant it displays, not on the answer', async () => {
    setHour(23);
    renderSuggestion();
    await screen.findByRole('dialog');
    // Never clicked anything -- the write must already have happened.
    expect(window.localStorage.getItem(NIGHT_SUGGESTION_KEY)).not.toBeNull();
  });

  it('never offers itself again once already suggested', async () => {
    setHour(23);
    window.localStorage.setItem(NIGHT_SUGGESTION_KEY, new Date().toISOString());
    renderSuggestion();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not offer itself when Night Mode is already on', async () => {
    setHour(23);
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ night: true }));
    renderSuggestion();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('accepting turns Night Mode on and dismisses the offer', async () => {
    setHour(23);
    renderSuggestion();
    await screen.findByRole('dialog');

    await act(async () => {
      screen.getByText('เปิดโหมดกลางคืน').click();
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('night')).toHaveTextContent('true');
    });
  });

  it('dismissing leaves Night Mode off and never shows again this session', async () => {
    setHour(23);
    renderSuggestion();
    await screen.findByRole('dialog');

    await act(async () => {
      screen.getByText('ไม่เป็นไร').click();
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('night')).toHaveTextContent('false');
  });
});
