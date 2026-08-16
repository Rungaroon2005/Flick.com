'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { login } from '@/lib/auth';
import { useAuth } from '@/components/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

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
    <div
      className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-ink px-6 py-12"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 100% 45% at 50% 0%, rgba(204,51,0,0.16), transparent 70%)',
      }}
    >
      <Link
        href="/"
        aria-label="กลับหน้าแรก"
        className="absolute left-4 flex h-10 w-10 items-center justify-center rounded-full text-fg-dim transition-colors hover:text-fg"
        style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
      >
        <Icon name="chevronLeft" size={22} />
      </Link>

      <div className="text-3xl font-extrabold tracking-tight text-brand-ink">Flick</div>

      <div className="mt-7 w-full max-w-sm rounded-2xl border border-hairline bg-ink-1/70 p-6 backdrop-blur-xl">
        <h1 className="text-title font-display">เข้าสู่ระบบ</h1>
        <p className="mt-1 text-sm text-fg-mute">ดูหนังสั้นที่ค้างไว้ต่อได้เลย</p>

        {error && (
          <div role="alert" className="mt-4 flex items-center gap-2 rounded-lg bg-fail/15 px-3 py-2.5 text-sm text-fail">
            <Icon name="alertCircle" size={16} className="shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
          <div className="relative flex items-center">
            <Icon name="mail" size={18} className="pointer-events-none absolute left-3.5 text-fg-mute" />
            <input
              type="email"
              className="h-12 w-full rounded-xl border border-hairline bg-ink-2 pl-11 pr-4 text-base text-fg outline-none placeholder:text-fg-mute focus:border-brand-ink"
              placeholder="อีเมล"
              aria-label="อีเมล"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="relative flex items-center">
            <Icon name="lock" size={18} className="pointer-events-none absolute left-3.5 text-fg-mute" />
            <input
              type={showPassword ? 'text' : 'password'}
              className="h-12 w-full rounded-xl border border-hairline bg-ink-2 pl-11 pr-11 text-base text-fg outline-none placeholder:text-fg-mute focus:border-brand-ink"
              placeholder="รหัสผ่าน"
              aria-label="รหัสผ่าน"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
              className="absolute right-3.5 text-fg-mute transition-colors hover:text-fg"
            >
              <Icon name={showPassword ? 'eyeOff' : 'eye'} size={18} />
            </button>
          </div>

          <div className="mt-1 flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 text-fg-dim">
              <input type="checkbox" className="accent-brand" />
              จดจำฉันไว้
            </label>
            <span className="text-fg-mute">ลืมรหัสผ่าน?</span>
          </div>

          <Button type="submit" variant="primary" size="lg" className="mt-2 w-full">
            เข้าสู่ระบบ
          </Button>
        </form>

        <div className="mt-5 text-center text-sm text-fg-dim">
          ยังไม่มีบัญชี?{' '}
          <Link href="/register" className="font-medium text-brand-ink">
            สมัครสมาชิก
          </Link>
        </div>
      </div>

      <div className="mt-6 flex justify-center gap-4 text-xs text-fg-mute">
        <span>เงื่อนไขการใช้งาน</span>
        <span>นโยบายความเป็นส่วนตัว</span>
      </div>
    </div>
  );
}
