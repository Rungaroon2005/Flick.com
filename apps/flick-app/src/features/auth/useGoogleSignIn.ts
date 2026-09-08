'use client';
import { useCallback, useEffect, useState } from 'react';
import { requestNonce, verifyOAuth, type OAuthVerifyResult } from './oauth';
import { loadSdk } from './sdkLoader';

const SDK_SRC = 'https://accounts.google.com/gsi/client';

interface GoogleCredentialResponse {
  credential?: string;
}

/** Only the corner of the GSI surface this hook actually touches. */
interface GoogleIdentityServices {
  accounts: {
    id: {
      initialize(config: {
        client_id: string | undefined;
        nonce: string;
        callback: (response: GoogleCredentialResponse) => void;
      }): void;
      renderButton(
        parent: HTMLElement,
        options: { theme: string; size: string; width: number; text: string },
      ): void;
    };
  };
}

function googleSdk(): GoogleIdentityServices | undefined {
  return (window as unknown as { google?: GoogleIdentityServices }).google;
}

/**
 * Google Identity Services renders its own button into a container we own, so
 * the flow is: get a nonce, initialize with it, let GSI draw the button, and
 * post whatever credential comes back.
 *
 * `setContainer` is a callback ref rather than a useRef object on purpose — the
 * effect must run once the node actually exists, and the node appears in the
 * same render that flips `enabled` true (the provider list arrives async).
 * State makes that ordering explicit instead of leaving it to luck.
 */
export function useGoogleSignIn(
  enabled: boolean,
  onResult: (result: OAuthVerifyResult) => void,
) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  const handleCredential = useCallback(
    async (response: GoogleCredentialResponse, nonce: string) => {
      if (!response.credential) return;
      onResult(
        await verifyOAuth({
          provider: 'google',
          idToken: response.credential,
          nonce,
        }),
      );
    },
    [onResult],
  );

  useEffect(() => {
    if (!enabled || !container) return;
    let cancelled = false;

    void (async () => {
      try {
        const [nonce] = await Promise.all([
          requestNonce('google'),
          loadSdk(SDK_SRC, () => Boolean(googleSdk())),
        ]);
        if (cancelled) return;

        const gsi = googleSdk();
        if (!gsi) return;

        gsi.accounts.id.initialize({
          client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
          // Embedded in the signed token; the server burns it once.
          nonce,
          callback: (r: GoogleCredentialResponse) =>
            void handleCredential(r, nonce),
        });
        gsi.accounts.id.renderButton(container, {
          theme: 'outline',
          size: 'large',
          width: 320,
          text: 'signin_with',
        });
        setReady(true);
      } catch {
        // A dead SDK or an unreachable API means no Google button. OTP still
        // works, so this is a missing affordance, not a broken page.
        if (!cancelled) setReady(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, container, handleCredential]);

  return { setContainer, ready };
}
