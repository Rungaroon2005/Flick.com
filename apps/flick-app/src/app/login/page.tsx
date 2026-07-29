'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { login } from '@/lib/auth';
import styles from './page.module.css';

export default function LoginPage() {
  const router = useRouter();
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
    <div className={styles.container}>
      <div className={styles.logo}>Flick</div>
      
      <div className={styles.formCard}>
        <h1 className={styles.header}>เข้าสู่ระบบ</h1>
        
        {error && <div className={styles.errorMsg}>{error}</div>}
        
        <form onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <input 
              type="email" 
              className={styles.input} 
              placeholder="บัญชีผู้ใช้" 
              aria-label="บัญชีผู้ใช้ (อีเมล)"
              value={email}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            />
          </div>
          
          <div className={styles.formGroup}>
            <div className={styles.inputWrapper || "input-wrapper-fallback"} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input 
                type={showPassword ? "text" : "password"} 
                className={styles.input} 
                placeholder="รหัสผ่าน" 
                aria-label="รหัสผ่าน"
                value={password}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                style={{ flex: 1 }}
              />
              <button 
                type="button" 
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '12px',
                  background: 'none',
                  border: 'none',
                  color: '#A0A0A0',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                {showPassword ? "ซ่อน" : "แสดง"}
              </button>
            </div>
          </div>
          
          <div className={styles.optionsRow}>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" className={styles.checkbox} />
              จดจำรหัสผ่าน
            </label>
            <Link href="#" className={styles.link}>ลืมรหัสผ่าน?</Link>
          </div>
          
          <button type="submit" className={styles.submitBtn}>เข้าสู่ระบบ</button>
        </form>
        
        <div className={styles.registerLink}>
          <Link href="/register" className={styles.link}>สมัครสมาชิก</Link>
        </div>
        
        <div className={styles.footerLinks}>
          <Link href="#" className={styles.link}>ชำระค่าบริการ?</Link>
          <Link href="#" className={styles.link}>เงื่อนไข?</Link>
          <Link href="#" className={styles.link}>นโยบาย?</Link>
        </div>
      </div>
    </div>
  );
}
