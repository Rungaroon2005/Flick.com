'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS } from '../navItems';
import { Icon } from './Icon';

/**
 * Desktop navigation, hosted inside AppHeader. Appears at lg (1024px), which
 * is the layout-regime boundary, not a device boundary: iPad landscape and
 * desktop get the bar; iPhone and iPad portrait keep the thumb-reachable
 * bottom pill. Item heights are kept inside AppHeader's fixed h-16 so the
 * sticky offsets on /search stay correct.
 */
export function HeaderNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="เมนูหลัก" className="hidden lg:flex lg:items-center lg:gap-1">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.path;
        return (
          <Link
            key={item.path}
            href={item.path}
            aria-current={isActive ? 'page' : undefined}
            className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium no-underline transition-colors duration-ui ${
              isActive
                ? 'bg-brand/15 text-brand-ink'
                : 'text-fg-mute [@media(hover:hover)]:hover:bg-white/5 [@media(hover:hover)]:hover:text-fg'
            }`}
          >
            <Icon name={isActive ? item.activeIcon : item.icon} size={18} />
            {item.name}
          </Link>
        );
      })}
    </nav>
  );
}
