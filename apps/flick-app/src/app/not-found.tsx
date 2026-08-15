import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';

/**
 * Was missing entirely before this (docs/FRONTEND_PLAN.md Phase 2) — a
 * bad /movie/:id or /player/:id fell through to Next's unstyled default.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ink px-6 text-center">
      <Icon name="alertCircle" size={40} className="text-fg-mute" />
      <div>
        <p className="text-title font-display">ไม่พบหน้านี้</p>
        <p className="mt-2 text-sm text-fg-dim">ลิงก์นี้อาจไม่ถูกต้องหรือเนื้อหาถูกลบไปแล้ว</p>
      </div>
      <Link href="/home" className="mt-2 text-sm font-medium text-brand-ink">
        กลับหน้าหลัก
      </Link>
    </div>
  );
}
