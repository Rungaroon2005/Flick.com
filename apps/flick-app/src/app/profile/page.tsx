'use client';
import { useRouter } from 'next/navigation';
import { logout } from '@/lib/auth';
import BottomNav from '@/components/BottomNav';
import styles from './page.module.css';

export default function ProfilePage() {
  const router = useRouter();

  const handleLogout = async () => {
    if (logout) await logout();
    router.push('/login');
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.logo}>Flick</div>
        <div className={styles.headerIcons}>
          <button className={styles.iconBtn} aria-label="Downloads">⬇️</button>
          <button className={styles.iconBtn} aria-label="Search">🔍</button>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.userInfo}>
          <div className={styles.avatar}></div>
          <div className={styles.userDetails}>
            <h2 className={styles.name}>ชื่อผู้ใช้</h2>
            <p className={styles.username}>@username</p>
            <p className={styles.email}>user@example.com</p>
            <button className={styles.editBtn}>แก้ไขโปรไฟล์ &gt;</button>
          </div>
        </div>

        <div className={styles.subCard}>
          <div className={styles.subInfo}>
            <h3>สถานะสมาชิก</h3>
            <p className={styles.planName}>พรีเมียมรายเดือน</p>
          </div>
          <button className={styles.manageBtn} onClick={() => router.push('/subscribe')}>
            จัดการ
          </button>
        </div>

        <div className={styles.settingsGroup}>
          <div className={styles.settingItem}><span>ตั้งค่าบัญชี</span> <span className={styles.chevron}>&gt;</span></div>
          <div className={styles.settingItem}><span>การแจ้งเตือน</span> <span className={styles.chevron}>&gt;</span></div>
          <div className={styles.settingItem}><span>การเล่นวิดีโอ</span> <span className={styles.chevron}>&gt;</span></div>
          <div className={styles.settingItem}><span>ภาษา</span> <span className={styles.chevron}>&gt;</span></div>
          <div className={styles.settingItem}><span>ลักษณะการแสดงผล</span> <span className={styles.chevron}>&gt;</span></div>
          <div className={styles.settingItem}><span>ความเป็นส่วนตัว</span> <span className={styles.chevron}>&gt;</span></div>
          <div className={styles.settingItem}><span>อุปกรณ์ที่เข้าสู่ระบบ</span> <span className={styles.chevron}>&gt;</span></div>
          <div className={styles.settingItem}><span>ล้างแคช</span> <span className={styles.chevron}>&gt;</span></div>
        </div>

        <div className={styles.settingsGroup}>
          <div className={styles.settingItem}><span>ศูนย์ช่วยเหลือ</span> <span className={styles.chevron}>&gt;</span></div>
          <div className={styles.settingItem}><span>ติดต่อเรา</span> <span className={styles.chevron}>&gt;</span></div>
          <div className={styles.settingItem}><span>ให้คะแนนแอพ</span> <span className={styles.chevron}>&gt;</span></div>
          <div className={styles.settingItem}><span>ข้อกำหนดการใช้งาน</span> <span className={styles.chevron}>&gt;</span></div>
          <div className={styles.settingItem}><span>นโยบายความเป็นส่วนตัว</span> <span className={styles.chevron}>&gt;</span></div>
          <div className={styles.settingItem}>
            <span>เวอร์ชัน</span>
            <span className={styles.version}>1.0.0</span>
          </div>
        </div>

        <button className={styles.logoutBtn} onClick={handleLogout}>
          ออกจากระบบ
        </button>
      </main>

      <BottomNav />
    </div>
  );
}
