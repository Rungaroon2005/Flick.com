import Link from 'next/link';
import { redirect } from 'next/navigation';
import BottomNav from '@/components/BottomNav';
import LogoutButton from './LogoutButton';
import { ApiError } from '@/lib/apiClient';
import { apiFetchServer, getSession } from '@/lib/session';
import { Subscription } from '@/types';
import styles from './page.module.css';

/** Display-only label for a plan id. Falls back to the raw planType, so an id
 *  this map has not heard of degrades to something truthful rather than
 *  claiming the wrong plan — nothing here is ever sent back to the API. */
const PLAN_LABELS: Record<string, string> = {
  weekly: 'VIP รายสัปดาห์',
  monthly: 'VIP รายเดือน',
};

const NO_PLAN_LABEL = 'ฟรี';

function planLabel(subscription: Subscription | null): string {
  if (!subscription) return NO_PLAN_LABEL;
  return PLAN_LABELS[subscription.planType] ?? subscription.planType;
}

const settingsRows = [
  'ตั้งค่าบัญชี',
  'การแจ้งเตือน',
  'การเล่นวิดีโอ',
  'ภาษา',
  'ลักษณะการแสดงผล',
  'ความเป็นส่วนตัว',
  'อุปกรณ์ที่เข้าสู่ระบบ',
  'ล้างแคช',
];

const supportRows = [
  'ศูนย์ช่วยเหลือ',
  'ติดต่อเรา',
  'ให้คะแนนแอพ',
  'ข้อกำหนดการใช้งาน',
  'นโยบายความเป็นส่วนตัว',
];

export default async function ProfilePage() {
  // Authorisation happens on the server, before any of this page is sent.
  const session = await getSession();
  if (!session) redirect('/login');

  let subscription: Subscription | null = null;
  let wallet: { balance: number } | null = null;
  let sessionExpired = false;
  let error: string | null = null;

  // Both calls sit in one try deliberately: unlike /home's optional bookmarks
  // row, neither of these can degrade independently — membership status and
  // coin balance are the entire point of this page, so a partial render would
  // be a page that lies about the user's entitlements.
  try {
    const [sub, w] = await Promise.all([
      apiFetchServer<Subscription | null>('/subscriptions/me'),
      apiFetchServer<{ balance: number }>('/wallet'),
    ]);
    // GET /subscriptions/me answers "no subscription" with an empty 200 body,
    // which unwrapResponse surfaces as undefined.
    subscription = sub ?? null;
    wallet = w;
  } catch (err) {
    // A 401 means the session died between getSession() above and this call:
    // that is a login redirect, never a generic error screen.
    if (err instanceof ApiError && err.status === 401) {
      sessionExpired = true;
    } else {
      console.error('Error fetching profile entitlements on server:', err);
      error = 'ไม่สามารถโหลดข้อมูลบัญชีได้ กรุณาลองใหม่อีกครั้ง';
    }
  }
  // redirect() throws, so it must be called outside the try/catch above or the
  // catch would swallow its NEXT_REDIRECT control-flow signal.
  if (sessionExpired) redirect('/login');

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
            <h2 className={styles.name}>{session.displayName}</h2>
            {session.email && <p className={styles.email}>{session.email}</p>}
            <button
              className={styles.editBtn}
              aria-disabled="true"
              disabled
              title="ยังไม่เปิดให้ใช้งาน"
            >
              แก้ไขโปรไฟล์ &gt;
            </button>
          </div>
        </div>

        {error ? (
          <p className={styles.errorNote}>{error}</p>
        ) : (
          <>
            <div className={styles.subCard}>
              <div className={styles.subInfo}>
                <h3>สถานะสมาชิก</h3>
                <p className={styles.planName}>{planLabel(subscription)}</p>
                {subscription && (
                  <p className={styles.subMeta}>
                    ใช้ได้ถึง{' '}
                    {new Date(subscription.endDate).toLocaleDateString('th-TH')}
                  </p>
                )}
              </div>
              <Link href="/subscribe" className={styles.manageBtn}>
                จัดการ
              </Link>
            </div>

            <div className={styles.walletCard}>
              <div className={styles.subInfo}>
                <h3>เหรียญคงเหลือ</h3>
                <p className={styles.coinBalance}>
                  <span aria-hidden="true">🟡</span> {wallet?.balance ?? 0}
                </p>
              </div>
            </div>
          </>
        )}

        <div className={styles.settingsGroup}>
          {settingsRows.map((label) => (
            <div key={label} className={styles.settingItemDisabled} aria-disabled="true">
              <span>{label}</span> <span className={styles.chevron}>&gt;</span>
            </div>
          ))}
        </div>

        <div className={styles.settingsGroup}>
          {supportRows.map((label) => (
            <div key={label} className={styles.settingItemDisabled} aria-disabled="true">
              <span>{label}</span> <span className={styles.chevron}>&gt;</span>
            </div>
          ))}
          <div className={styles.settingItemStatic}>
            <span>เวอร์ชัน</span>
            <span className={styles.version}>1.0.0</span>
          </div>
        </div>

        <LogoutButton className={styles.logoutBtn} />
      </main>

      <BottomNav />
    </div>
  );
}
