'use client';

// One promise per script URL, held at module scope: two components mounting the
// same provider must not inject two <script> tags, and a remount must not
// re-execute an SDK that is already on the page.
const loaders = new Map<string, Promise<void>>();

export function loadSdk(src: string, isPresent: () => boolean): Promise<void> {
  if (isPresent()) return Promise.resolve();

  const existing = loaders.get(src);
  if (existing) return existing;

  const loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Drop it so a later attempt can retry rather than await a dead promise.
      loaders.delete(src);
      reject(new Error(`Failed to load ${src}`));
    };
    document.head.appendChild(script);
  });

  loaders.set(src, loading);
  return loading;
}
