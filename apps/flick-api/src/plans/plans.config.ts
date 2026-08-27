// Subscription plan configuration
// Extracted from plans.controller.ts to allow updates without code changes

/**
 * Single source of truth for valid paid plan ids and their durations.
 *
 * This is what closes the revenue bug in the legacy frontend flow: the old
 * client-side code sent `'vip-weekly'` while its OWN duration map was keyed
 * `weekly`/`monthly`/`trial`, so the lookup silently fell through to
 * `durations.monthly` — ฿49 bought 30 days instead of 7. By deriving
 * `PaidPlanId` from this object's keys, any caller that passes a plan id
 * not present here is a compile-time type error in TypeScript callers. These
 * durations are reserved for the future verified payment callback; browser
 * activation remains disabled until that integration exists.
 */
export const PLAN_DURATIONS_MS = {
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
    id: 'monthly',
    name: 'VIP รายเดือน',
    nameEn: 'Monthly VIP',
    price: 249,
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
