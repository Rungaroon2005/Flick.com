'use client';

/**
 * A single accessible on/off control, shared between the player's Night
 * Mode row and the profile page's — extracted rather than duplicated
 * because role="switch" semantics (aria-checked, keyboard activation via
 * a real <button>) are exactly the kind of detail that drifts if written
 * twice.
 */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`focus-ring relative h-7 w-12 shrink-0 rounded-full transition-colors duration-ui ease-enter ${
        checked ? 'bg-brand' : 'bg-ink-2'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-fg shadow-sm transition-transform duration-ui ease-enter ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}
