'use client';
import { useCallback, useEffect, useState } from 'react';
import { requestNonce, verifyOAuth, type OAuthVerifyResult } from './oauth';
import { loadSdk } from './sdkLoader';

const SDK_SRC =
  'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

interface AppleSignInResponse {
  authorization?: { id_token?: string };
  user?: { name?: { firstName?: string; lastName?: string } };
}

/** Only the corner of the AppleID surface this hook actually touches. */
interface AppleIdSdk {
  auth: {
    init(config: {
      clientId: string | undefined;
      scope: string;
      redirectURI: string;
      usePopup: boolean;
      nonce: string;
    }): void;
    signIn(): Promise<AppleSignInResponse>;
  };
}

function appleSdk(): AppleIdSdk | undefined {
  return (window as unknown as { AppleID?: AppleIdSdk }).AppleID;
}

/** Apple gives us a popup we trigger ourselves, not a rendered button. */
export function useAppleSignIn(
  enabled: boolean,
  onResult: (result: OAuthVerifyResult) => void,
) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    // Resolved on a microtask even when the SDK is already present, which is
    // what keeps this out of the effect body — a synchronous setState here
    // would cascade a render.
    void loadSdk(SDK_SRC, () => Boolean(appleSdk()))
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const signIn = useCallback(async () => {
    const AppleID = appleSdk();
    if (!AppleID) return;

    const nonce = await requestNonce('apple');
    AppleID.auth.init({
      clientId: process.env.NEXT_PUBLIC_APPLE_CLIENT_ID,
      scope: 'name email',
      redirectURI: window.location.origin + '/login',
      usePopup: true,
      nonce,
    });

    let response: AppleSignInResponse;
    try {
      response = await AppleID.auth.signIn();
    } catch {
      return; // The user closed the popup. Not an error worth showing.
    }

    const idToken = response.authorization?.id_token;
    if (!idToken) return;

    // Apple sends the name ONCE, beside the token and never inside it. Read it
    // here or it is gone forever. The server treats it as an unverified hint.
    const name = response.user?.name;
    const displayName = [name?.firstName, name?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();

    onResult(
      await verifyOAuth({
        provider: 'apple',
        idToken,
        nonce,
        displayName: displayName || undefined,
      }),
    );
  }, [onResult]);

  return { signIn, ready };
}
