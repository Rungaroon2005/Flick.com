import Link from 'next/link';
import { redirect } from 'next/navigation';
import LogoutButton from './LogoutButton';
import NightModeToggle from './NightModeToggle';
import { AppHeader } from '@/components/ui/AppHeader';
import { Container } from '@/components/ui/Container';
import { PageShell } from '@/components/ui/PageShell';
import { ApiError } from '@/lib/apiClient';
import { apiFetchServer, getSession } from '@/lib/session';
import { withNext } from '@/lib/nextParam';
import { PassportDto, Subscription } from '@/types';

/** Display-only label for a plan id. Falls back to the raw planType, so an id
 *  this map has not heard of degrades to something truthful rather than
 *  claiming the wrong plan — nothing here is ever sent back to the API. */
const PLAN_LABELS: Record<string, string> = {
  monthly: 'VIP รายเดือน',
};

const NO_PLAN_LABEL = 'ฟรี';

function planLabel(subscription: Subscription | null): string {
  if (!subscription) return NO_PLAN_LABEL;
  return PLAN_LABELS[subscription.planType] ?? subscription.planType;
}

/** ISO 3166-1 alpha-2 -> Thai display name, for the Passport card's
 *  "ประเทศที่ดูมากที่สุด" cell. The API returns only the raw code (NewPlan
 *  Part D, phase 2 -- there is no Country table to source a name from), so
 *  the Thai label lives here, same reasoning as PLAN_LABELS above. An
 *  unmapped code falls back to itself rather than claiming the wrong
 *  country -- nothing here is ever sent back to the API. */
const COUNTRY_LABELS: Record<string, string> = {
  TH: 'ไทย',
  KR: 'เกาหลีใต้',
  JP: 'ญี่ปุ่น',
  US: 'อเมริกา',
  CN: 'จีน',
  GB: 'อังกฤษ',
  FR: 'ฝรั่งเศส',
  IN: 'อินเดีย',
};

function countryLabel(topCountry: PassportDto['topCountry']): string {
  if (!topCountry) return '—';
  return COUNTRY_LABELS[topCountry.code] ?? topCountry.code;
}

// Every other settings/support row from the old list had no screen behind
// it — a chevron that promised navigation to nowhere. These three are kept
// because they're the only ones backed by real schema (User.language,
// User.theme, the Device model) — genuinely coming, not decoration — so
// they get a "เร็ว ๆ นี้" chip instead of a false chevron
// (docs/FRONTEND_PLAN.md Part 3).
const settingsRows = ['ภาษา', 'ลักษณะการแสดงผล', 'อุปกรณ์ที่เข้าสู่ระบบ'];

export default async function ProfilePage() {
  // Authorisation happens on the server, before any of this page is sent.
  const session = await getSession();
  if (!session) redirect(withNext('/login', '/profile'));

  let subscription: Subscription | null = null;
  let sessionExpired = false;
  let error: string | null = null;

  try {
    const sub = await apiFetchServer('/subscriptions/me');
    // GET /subscriptions/me answers "no subscription" with an empty 200 body,
    // which unwrapResponse surfaces as undefined.
    subscription = sub ?? null;
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
  if (sessionExpired) redirect(withNext('/login', '/profile'));

  // Independent of the subscription fetch above -- a failed passport
  // lookup has nothing to do with entitlements, and folding it into that
  // try/catch would blank out an unrelated card over an unrelated error.
  let passport: PassportDto | null = null;
  try {
    passport = await apiFetchServer('/me/passport');
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) {
      console.error('Error fetching passport on server:', err);
    }
  }
  // A passport showing "0 เรื่อง · 0 ชั่วโมง" reads worse than no card at
  // all (design doc Part D) -- it only appears once there's something
  // real to show.
  const hasPassportData =
    passport &&
    (passport.completedMoviesCount > 0 ||
      passport.totalWatchedHours > 0 ||
      passport.likedMoviesCount > 0);

  return (
    <PageShell>
      <AppHeader />

      <main>
        <Container width="reading">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 shrink-0 rounded-full bg-ink-2 ring-2 ring-white/10" />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-fg">{session.displayName}</h2>
              {session.email && <p className="truncate text-sm text-fg-dim">{session.email}</p>}
              <button
                aria-disabled="true"
                disabled
                title="ยังไม่เปิดให้ใช้งาน"
                className="mt-1 text-sm text-fg-mute"
              >
                แก้ไขโปรไฟล์ &gt;
              </button>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-4">
            {error ? (
              <p className="text-sm text-fail">{error}</p>
            ) : (
              <div className="flex items-center justify-between rounded-2xl border border-white/5 bg-ink-1 p-5">
                <div>
                  <h3 className="text-xs font-medium text-fg-dim">สถานะสมาชิก</h3>
                  <p className="mt-1 font-semibold text-fg">{planLabel(subscription)}</p>
                  {subscription && (
                    <p className="mt-0.5 text-xs text-fg-mute">
                      ใช้ได้ถึง {new Date(subscription.endDate).toLocaleDateString('th-TH')}
                    </p>
                  )}
                </div>
                <Link
                  href="/subscribe"
                  className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-ink shadow-md shadow-black/20 transition-all duration-surface ease-enter hover:-translate-y-0.5 active:translate-y-0 active:scale-95"
                >
                  จัดการ
                </Link>
              </div>
            )}

            {/* Independent of the subscription fetch above -- a failed
                network call for entitlements has nothing to do with this
                local preference, and hiding it alongside that error would
                make an unrelated toggle disappear for no reason the user
                could guess. */}
            <NightModeToggle />
          </div>

          {hasPassportData && passport && (
            <div className="mt-8 rounded-2xl border border-white/5 bg-ink-1 p-5">
              <h3 className="text-sm font-semibold text-fg">🛂 Flicer Passport</h3>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-2xl font-bold text-fg">{passport.completedMoviesCount}</p>
                  <p className="text-xs text-fg-mute">เรื่องที่ดูจบ</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-fg">{passport.totalWatchedHours}</p>
                  <p className="text-xs text-fg-mute">ชั่วโมงที่ดู</p>
                </div>
                <div>
                  <p className="truncate text-2xl font-bold text-fg">{passport.topGenre?.name ?? '—'}</p>
                  <p className="text-xs text-fg-mute">แนวที่ดูมากที่สุด</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-fg">{passport.likedMoviesCount}</p>
                  <p className="text-xs text-fg-mute">เรื่องที่ถูกใจ</p>
                </div>
                <div>
                  <p className="truncate text-2xl font-bold text-fg">{countryLabel(passport.topCountry)}</p>
                  <p className="text-xs text-fg-mute">ประเทศที่ดูมากที่สุด</p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-8 overflow-hidden rounded-2xl border border-white/5 bg-ink-1">
            {settingsRows.map((label, i) => (
              <div
                key={label}
                aria-disabled="true"
                className={`flex items-center justify-between py-4 text-sm text-fg-dim ${
                  i > 0 ? 'border-t border-white/5' : ''
                }`}
              >
                <span>{label}</span>
                <span className="rounded-full bg-ink-2 px-2.5 py-1 text-xs text-fg-mute">เร็ว ๆ นี้</span>
              </div>
            ))}
          </div>

          <div className="mt-8 flex items-center justify-between px-1 text-sm text-fg-mute">
            <span>เวอร์ชัน</span>
            <span>1.0.0</span>
          </div>

          <LogoutButton className="mt-6 flex h-12 w-full items-center justify-center rounded-full border border-white/5 bg-ink-1 font-medium text-fail transition-all duration-surface ease-enter hover:bg-ink-2 active:scale-[0.98]" />
        </Container>
      </main>
    </PageShell>
  );
}
