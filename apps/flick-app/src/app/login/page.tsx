'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { login } from '@/lib/auth';
import { useAuth } from '@/components/AuthProvider';
import { Button } from '@/components/ui/Button';

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email || !password) {
      setError('กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }

    try {
      const result = await login(email, password);
      if (result.success) {
        // Re-read the server session so the app reflects the new cookie.
        await refresh();
        router.push('/home');
      } else {
        setError(result.error || 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message || 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
      } else {
        setError('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
      }
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-ink px-6 py-12">
      <div className="text-4xl font-extrabold tracking-tight text-brand-ink">Flick</div>

      <div className="mt-8 w-full max-w-sm rounded-2xl bg-ink-1 p-6">
        <h1 className="text-title mb-5 font-display">เข้าสู่ระบบ</h1>

        {error && (
          <div role="alert" className="mb-4 rounded-lg bg-fail/15 px-3 py-2.5 text-sm text-fail">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            className="h-12 rounded-lg border border-hairline bg-ink-2 px-4 text-base text-fg outline-none placeholder:text-fg-mute focus:border-brand-ink"
            placeholder="บัญชีผู้ใช้"
            aria-label="บัญชีผู้ใช้ (อีเมล)"
            value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
          />

          <div className="relative flex items-center">
            <input
              type={showPassword ? 'text' : 'password'}
              className="h-12 w-full rounded-lg border border-hairline bg-ink-2 px-4 pr-16 text-base text-fg outline-none placeholder:text-fg-mute focus:border-brand-ink"
              placeholder="รหัสผ่าน"
              aria-label="รหัสผ่าน"
              value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 text-sm text-fg-mute"
            >
              {showPassword ? 'ซ่อน' : 'แสดง'}
            </button>
          </div>

          <div className="mt-1 flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 text-fg-dim">
              <input type="checkbox" className="accent-brand" />
              จดจำรหัสผ่าน
            </label>
            <span className="text-fg-mute">ลืมรหัสผ่าน?</span>
          </div>

          <Button type="submit" variant="primary" size="lg" className="mt-2 w-full">
            เข้าสู่ระบบ
          </Button>
        </form>

        <div className="mt-5 text-center text-sm">
          <Link href="/register" className="font-medium text-brand-ink">
            สมัครสมาชิก
          </Link>
        </div>

        <div className="mt-6 flex justify-center gap-4 text-xs text-fg-mute">
          <span>ชำระค่าบริการ?</span>
          <span>เงื่อนไข?</span>
          <span>นโยบาย?</span>
        </div>
      </div>
    </div>
  );
}
