'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { register } from '@/lib/auth';
import { useAuth } from '@/components/AuthProvider';
import { Button } from '@/components/ui/Button';

interface RegisterFormData {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
}

const inputClass =
  'h-12 rounded-lg border border-hairline bg-ink-2 px-4 text-base text-fg outline-none placeholder:text-fg-mute focus:border-brand-ink';

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
    <div className="flex min-h-dvh flex-col items-center justify-center bg-ink px-6 py-12">
      <div className="text-4xl font-extrabold tracking-tight text-brand-ink">Flick</div>

      <div className="mt-8 w-full max-w-sm rounded-2xl bg-ink-1 p-6">
        <h1 className="text-title mb-5 font-display">สมัครสมาชิก</h1>

        {error && (
          <div role="alert" className="mb-4 rounded-lg bg-fail/15 px-3 py-2.5 text-sm text-fail">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            name="name"
            className={inputClass}
            placeholder="ชื่อที่แสดง"
            aria-label="ชื่อที่แสดง"
            value={formData.name}
            onChange={handleChange}
          />

          <input
            type="email"
            name="email"
            className={inputClass}
            placeholder="อีเมล"
            aria-label="อีเมล"
            value={formData.email}
            onChange={handleChange}
          />

          <input
            type="tel"
            name="phone"
            className={inputClass}
            placeholder="เบอร์โทรศัพท์ (ไม่บังคับ)"
            aria-label="เบอร์โทรศัพท์"
            value={formData.phone}
            onChange={handleChange}
          />

          <div className="relative flex items-center">
            <input
              type={showPassword ? 'text' : 'password'}
              name="password"
              className={`${inputClass} w-full pr-16`}
              placeholder="รหัสผ่าน"
              aria-label="รหัสผ่าน"
              value={formData.password}
              onChange={handleChange}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 text-sm text-fg-mute"
            >
              {showPassword ? 'ซ่อน' : 'แสดง'}
            </button>
          </div>

          <input
            type="password"
            name="confirmPassword"
            className={inputClass}
            placeholder="ยืนยันรหัสผ่าน"
            aria-label="ยืนยันรหัสผ่าน"
            value={formData.confirmPassword}
            onChange={handleChange}
          />

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

        <div className="mt-5 text-center text-sm">
          <Link href="/login" className="font-medium text-brand-ink">
            มีบัญชีแล้ว? เข้าสู่ระบบ
          </Link>
        </div>
      </div>
    </div>
  );
}
