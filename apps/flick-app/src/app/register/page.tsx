'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { register } from '@/lib/auth';
import { useAuth } from '@/components/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';

interface RegisterFormData {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
}

const inputClass =
  'h-12 w-full rounded-xl border border-hairline bg-ink-2 pl-11 pr-4 text-base text-fg outline-none placeholder:text-fg-mute focus:border-brand-ink';

function FieldIcon({ name }: { name: IconName }) {
  return <Icon name={name} size={18} className="pointer-events-none absolute left-3.5 text-fg-mute" />;
}

export default function RegisterPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [formData, setFormData] = useState<RegisterFormData>({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    acceptTerms: false,
  });
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    if (!formData.name || !formData.email || !formData.password || !formData.confirmPassword) {
      setError('กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('รหัสผ่านไม่ตรงกัน');
      return;
    }

    if (formData.password.length < 8) {
      setError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
      return;
    }

    if (!formData.acceptTerms) {
      setError('กรุณายอมรับเงื่อนไขและนโยบายความเป็นส่วนตัว');
      return;
    }

    try {
      const result = await register({
        displayName: formData.name,
        email: formData.email,
        phone: formData.phone,
        password: formData.password,
      });

      if (result.success) {
        // Registration sets the session cookie server-side; re-read it.
        await refresh();
        router.push('/subscribe');
      } else {
        setError(result.error || 'การสมัครสมาชิกผิดพลาด');
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message || 'การสมัครสมาชิกผิดพลาด');
      } else {
        setError('การสมัครสมาชิกผิดพลาด');
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
        <h1 className="text-title font-display">สมัครสมาชิก</h1>
        <p className="mt-1 text-sm text-fg-mute">ดูฟรีตอนที่ 1–10 ทุกเรื่อง ไม่ต้องผูกบัตร</p>

        {error && (
          <div role="alert" className="mt-4 flex items-center gap-2 rounded-lg bg-fail/15 px-3 py-2.5 text-sm text-fail">
            <Icon name="alertCircle" size={16} className="shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
          <div className="relative flex items-center">
            <FieldIcon name="user" />
            <input
              type="text"
              name="name"
              className={inputClass}
              placeholder="ชื่อที่แสดง"
              aria-label="ชื่อที่แสดง"
              value={formData.name}
              onChange={handleChange}
            />
          </div>

          <div className="relative flex items-center">
            <FieldIcon name="mail" />
            <input
              type="email"
              name="email"
              className={inputClass}
              placeholder="อีเมล"
              aria-label="อีเมล"
              value={formData.email}
              onChange={handleChange}
            />
          </div>

          <div className="relative flex items-center">
            <FieldIcon name="phone" />
            <input
              type="tel"
              name="phone"
              className={inputClass}
              placeholder="เบอร์โทรศัพท์ (ไม่บังคับ)"
              aria-label="เบอร์โทรศัพท์"
              value={formData.phone}
              onChange={handleChange}
            />
          </div>

          <div className="relative flex items-center">
            <FieldIcon name="lock" />
            <input
              type={showPassword ? 'text' : 'password'}
              name="password"
              className={`${inputClass} pr-11`}
              placeholder="รหัสผ่าน"
              aria-label="รหัสผ่าน"
              value={formData.password}
              onChange={handleChange}
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

          <div className="relative flex items-center">
            <FieldIcon name="lock" />
            <input
              type={showPassword ? 'text' : 'password'}
              name="confirmPassword"
              className={inputClass}
              placeholder="ยืนยันรหัสผ่าน"
              aria-label="ยืนยันรหัสผ่าน"
              value={formData.confirmPassword}
              onChange={handleChange}
            />
          </div>

          <label className="mt-1 flex items-center gap-2 text-sm text-fg-dim">
            <input
              type="checkbox"
              name="acceptTerms"
              className="accent-brand"
              checked={formData.acceptTerms}
              onChange={handleChange}
            />
            ยอมรับ เงื่อนไข และ นโยบายความเป็นส่วนตัว
          </label>

          <Button type="submit" variant="primary" size="lg" className="mt-2 w-full">
            สมัครสมาชิก
          </Button>
        </form>

        <div className="mt-5 text-center text-sm text-fg-dim">
          มีบัญชีแล้ว?{' '}
          <Link href="/login" className="font-medium text-brand-ink">
            เข้าสู่ระบบ
          </Link>
        </div>
      </div>
    </div>
  );
}
