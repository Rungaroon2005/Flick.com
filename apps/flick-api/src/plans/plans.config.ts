// Subscription plans and coin pack configuration
// Extracted from plans.controller.ts to allow updates without code changes

/**
 * Single source of truth for valid paid plan ids and their durations.
 *
 * This is what closes the revenue bug in the legacy frontend flow: the old
 * client-side code sent `'vip-weekly'` while its OWN duration map was keyed
 * `weekly`/`monthly`/`trial`, so the lookup silently fell through to
 * `durations.monthly` — ฿49 bought 30 days instead of 7. By deriving
 * `PaidPlanId` from this object's keys, any caller that passes a plan id
 * not present here is a compile-time type error (in TS callers) and a
 * runtime 400 (via the DTO's `@IsIn` below) — it can never again silently
 * default to the wrong duration.
 */
export const PLAN_DURATIONS_MS = {
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
} as const;

export type PaidPlanId = keyof typeof PLAN_DURATIONS_MS;

export const SUBSCRIPTION_PLANS = [
  {
    id: 'free',
    name: 'ฟรี',
    nameEn: 'Free',
    price: 0,
    period: '',
    features: ['ดูตอนที่ 1-10 ฟรี', 'คุณภาพ 720p', 'มีโฆษณา', '1 อุปกรณ์'],
    featuresEn: [
      'Episodes 1-10 free',
      '720p quality',
      'Ad-supported',
      '1 device',
    ],
    badge: null,
    color: '#666',
  },
  {
    id: 'weekly',
    name: 'VIP รายสัปดาห์',
    nameEn: 'Weekly VIP',
    price: 49,
    period: '/สัปดาห์',
    features: ['ไม่มีโฆษณา', 'คุณภาพ 1080p', 'ดูทุกตอน', '2 อุปกรณ์'],
    featuresEn: ['Ad-free', '1080p quality', 'All episodes', '2 devices'],
    badge: null,
    color: '#CC3300',
  },
  {
    id: 'monthly',
    name: 'VIP รายเดือน',
    nameEn: 'Monthly VIP',
    price: 149,
    period: '/เดือน',
    features: [
      'ไม่มีโฆษณา',
      'คุณภาพ 1080p/4K',
      'ดูทุกตอน',
      '4 อุปกรณ์',
      'ดาวน์โหลดได้',
      'ดูก่อนใคร',
    ],
    featuresEn: [
      'Ad-free',
      '1080p/4K quality',
      'All episodes',
      '4 devices',
      'Offline download',
      'Early access',
    ],
    badge: 'คุ้มที่สุด',
    color: '#FFD700',
  },
];

export const COIN_PACKS = [
  { id: 'starter', name: 'Starter', coins: 100, price: 35, unlocks: '~10 ตอน' },
  {
    id: 'popular',
    name: 'Popular',
    coins: 320,
    price: 99,
    unlocks: '~32 ตอน',
    badge: 'ยอดนิยม',
  },
  {
    id: 'bestvalue',
    name: 'Best Value',
    coins: 1100,
    price: 299,
    unlocks: '~110 ตอน',
    badge: 'คุ้มที่สุด',
  },
];
