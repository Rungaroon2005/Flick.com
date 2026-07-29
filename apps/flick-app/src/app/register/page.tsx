'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { register } from '@/lib/auth';
import styles from './page.module.css';

interface RegisterFormData {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
}

export default function RegisterPage() {
  const router = useRouter();
  const [formData, setFormData] = useState<RegisterFormData>({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    acceptTerms: false
  });
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
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
        password: formData.password
      });
      
      if (result.success) {
        // Successful registration auto-logins the user in auth.js
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
    <div className={styles.container}>
      <div className={styles.logo}>Flick</div>
      
      <div className={styles.formCard}>
        <h1 className={styles.header}>สมัครสมาชิก</h1>
        
        {error && <div className={styles.errorMsg}>{error}</div>}
        
        <form onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <input 
              type="text" 
              name="name"
              className={styles.input} 
              placeholder="ชื่อที่แสดง" 
              value={formData.name}
              onChange={handleChange}
            />
          </div>
          
          <div className={styles.formGroup}>
            <input 
              type="email" 
              name="email"
              className={styles.input} 
              placeholder="อีเมล" 
              value={formData.email}
              onChange={handleChange}
            />
          </div>

          <div className={styles.formGroup}>
            <input 
              type="tel" 
              name="phone"
              className={styles.input} 
              placeholder="เบอร์โทรศัพท์ (ไม่บังคับ)" 
              value={formData.phone}
              onChange={handleChange}
            />
          </div>
          
          <div className={styles.formGroup}>
            <div className={styles.inputWrapper}>
              <input 
                type={showPassword ? "text" : "password"} 
                name="password"
                className={styles.input} 
                placeholder="รหัสผ่าน" 
                value={formData.password}
                onChange={handleChange}
              />
              <button 
                type="button" 
                className={styles.toggleBtn}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? "ซ่อน" : "แสดง"}
              </button>
            </div>
          </div>

          <div className={styles.formGroup}>
            <input 
              type="password" 
              name="confirmPassword"
              className={styles.input} 
              placeholder="ยืนยันรหัสผ่าน" 
              value={formData.confirmPassword}
              onChange={handleChange}
            />
          </div>
          
          <div className={styles.termsRow}>
            <input 
              type="checkbox" 
              name="acceptTerms"
              className={styles.checkbox} 
              checked={formData.acceptTerms}
              onChange={handleChange}
            />
            <label>ยอมรับ เงื่อนไข และ นโยบายความเป็นส่วนตัว</label>
          </div>
          
          <button type="submit" className={styles.submitBtn}>สมัครสมาชิก</button>
        </form>
        
        <div className={styles.loginLink}>
          <Link href="/login">มีบัญชีแล้ว? เข้าสู่ระบบ</Link>
        </div>
      </div>
    </div>
  );
}
