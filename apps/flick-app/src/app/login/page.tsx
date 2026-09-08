'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { resolveLoginDestination } from './loginRedirect';
import Link from 'next/link';
import {
  fetchOAuthProviders,
  requestOtp,
  useAppleSignIn,
  useGoogleSignIn,
  verifyOtp,
  type OAuthVerifyResult,
} from '@/features/auth';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

type Step = 'phone' | 'code';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState<string>('');
  const [code, setCode] = useState<string>('');
  const [ref, setRef] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [claimed, setClaimed] = useState<boolean>(false);

  // An empty list means no buttons, not a broken page: OTP still works.
  useEffect(() => {
    void fetchOAuthProviders().then(setProviders);
  }, []);

  const handleSocial = useCallback(
    (result: OAuthVerifyResult) => {
      if (result.success) {
        // Same landing rule as OTP, including sending a brand-new account to
        // /subscribe rather than /home.
        router.replace(
          resolveLoginDestination(searchParams.get('next'), result.isNewUser),
        );
        router.refresh();
        return;
      }
      // The refuse-to-link case has its own instruction; everything else is
      // an ordinary error.
      setClaimed(Boolean(result.claimed));
      setError(result.claimed ? '' : result.error);
    },
    [router, searchParams],
  );

  const { setContainer: setGoogleContainer } = useGoogleSignIn(
    providers.includes('google'),
    handleSocial,
  );
  const { signIn: appleSignIn, ready: appleReady } = useAppleSignIn(
    providers.includes('apple'),
    handleSocial,
  );

  const handleRequest = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!phone) {
      setError('กรุณากรอกเบอร์โทรศัพท์');
      return;
    }
    setBusy(true);
    setError('');
    const result = await requestOtp(phone);
    setBusy(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    // The API answers identically for known and unknown numbers, so there is
    // nothing here to branch on — always advance to the code step.
    setRef(result.ref);
    setStep('code');
  };

  const handleVerify = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (code.length !== 6) {
      setError('กรุณากรอกรหัส 6 หลัก');
      return;
    }
    setBusy(true);
    setError('');
    const result = await verifyOtp(phone, ref, code);
    setBusy(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    // replace, not push: nobody should be able to navigate back into a
    // consumed OTP screen.
    router.replace(resolveLoginDestination(searchParams.get('next'), result.isNewUser));
    router.refresh();
  };

  return (
    <div
      className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-ink px-6 py-12"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 100% 45% at 50% 0%, rgba(255,92,26,0.16), transparent 70%)',
      }}
    >
      <Link
        href="/"
        aria-label="กลับหน้าแรก"
        className="focus-ring absolute left-4 flex h-10 w-10 items-center justify-center rounded-full text-fg-dim transition-colors hover:text-fg"
        style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
      >
        <Icon name="chevronLeft" size={22} />
      </Link>

      <div className="text-3xl font-extrabold tracking-tight text-brand-ink">Flick</div>

      <div className="mt-7 w-full max-w-sm rounded-2xl border border-hairline bg-ink-1/70 p-6 backdrop-blur-xl md:max-w-md">
        <h1 className="text-title font-display">
          {step === 'phone' ? 'เข้าสู่ระบบ' : 'ใส่รหัสยืนยัน'}
        </h1>
        <p className="mt-1 text-sm text-fg-mute">
          {step === 'phone'
            ? 'กรอกเบอร์โทรศัพท์เพื่อรับรหัสยืนยัน'
            : `ส่งรหัส 6 หลักไปที่ ${phone} แล้ว (รหัสอ้างอิง ${ref})`}
        </p>

        {claimed && (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-ink-2 p-3 text-sm text-fg-dim"
          >
            มีบัญชีที่ใช้อีเมลนี้อยู่แล้ว กรุณาเข้าสู่ระบบด้วยวิธีเดิม (OTP) แล้วเชื่อมบัญชีโซเชียลในหน้าโปรไฟล์
          </p>
        )}

        {error && (
          <div role="alert" className="mt-4 flex items-center gap-2 rounded-lg bg-fail/15 px-3 py-2.5 text-sm text-fail">
            <Icon name="alertCircle" size={16} className="shrink-0" />
            {error}
          </div>
        )}

        {step === 'phone' ? (
          <form onSubmit={handleRequest} className="mt-5 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-phone" className="text-sm text-fg-dim">
                เบอร์โทรศัพท์
              </label>
              <div className="relative flex items-center">
                <Icon name="phone" size={18} className="pointer-events-none absolute left-3.5 text-fg-mute" />
                <input
                  id="login-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  className="focus-ring h-12 w-full rounded-xl border border-hairline bg-ink-2 pl-11 pr-4 text-base text-fg placeholder:text-fg-mute focus:border-brand-ink"
                  placeholder="08X-XXX-XXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>
            <Button type="submit" variant="primary" size="lg" className="mt-2 w-full" disabled={busy}>
              {busy ? 'กำลังส่ง...' : 'ขอรหัสยืนยัน'}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="mt-5 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-code" className="text-sm text-fg-dim">
                รหัสยืนยัน 6 หลัก
              </label>
              <input
                id="login-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="focus-ring h-12 w-full rounded-xl border border-hairline bg-ink-2 px-4 text-center text-xl tracking-[0.5em] text-fg placeholder:tracking-normal placeholder:text-fg-mute focus:border-brand-ink"
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <Button type="submit" variant="primary" size="lg" className="mt-2 w-full" disabled={busy}>
              {busy ? 'กำลังตรวจสอบ...' : 'ยืนยัน'}
            </Button>
            <button
              type="button"
              onClick={() => {
                setStep('phone');
                setCode('');
                setError('');
              }}
              className="focus-ring mt-1 text-sm text-fg-dim transition-colors hover:text-fg"
            >
              เปลี่ยนเบอร์โทรศัพท์
            </button>
          </form>
        )}

        {step === 'phone' && providers.length > 0 && (
          <div className="mt-5 flex flex-col gap-3">
            <div className="flex items-center gap-3 text-xs text-fg-mute">
              <span className="h-px flex-1 bg-hairline" />
              หรือ
              <span className="h-px flex-1 bg-hairline" />
            </div>
            {providers.includes('google') && (
              <div ref={setGoogleContainer} className="flex justify-center" />
            )}
            {providers.includes('apple') && (
              <button
                type="button"
                onClick={() => void appleSignIn()}
                disabled={!appleReady}
                className="focus-ring flex w-full items-center justify-center gap-2 rounded-xl border border-hairline py-3 text-sm font-medium text-fg disabled:opacity-50"
              >
                เข้าสู่ระบบด้วย Apple
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-center gap-4 text-xs text-fg-mute">
        <span>เงื่อนไขการใช้งาน</span>
        <span>นโยบายความเป็นส่วนตัว</span>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
