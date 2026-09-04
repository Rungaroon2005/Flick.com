'use client';

import { Switch } from '@/components/ui/Switch';
import { usePreferences } from '@/features/preferences';

/**
 * Kept as a small client child so ProfilePage stays a Server Component,
 * same reasoning as LogoutButton beside it. Night Mode is a
 * localStorage-only preference (Phase A of the NewPlan design), not a
 * write to User.theme -- the "ลักษณะการแสดงผล" row further down the page
 * is a different, not-yet-built feature backed by that column, and this
 * does not repurpose it.
 */
export default function NightModeToggle() {
  const { prefs, setNight } = usePreferences();
  return (
    <div className="flex items-center justify-between rounded-2xl border border-white/5 bg-ink-1 p-5">
      <div>
        <h3 className="text-xs font-medium text-fg-dim">โหมดกลางคืน</h3>
        <p className="mt-1 text-sm text-fg">ลดความสว่างของหน้าจอ และปิดเล่นตอนถัดไปอัตโนมัติ</p>
      </div>
      <Switch checked={prefs.night} onChange={setNight} label="โหมดกลางคืน" />
    </div>
  );
}
