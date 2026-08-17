'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './ui/Icon';
import { NAV_ITEMS } from './navItems';

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="เมนูหลัก"
      className="fixed inset-x-4 z-[1000] flex justify-center lg:hidden"
      style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
    >
      <ul className="m-0 flex w-full max-w-sm list-none items-center justify-around rounded-full border border-white/10 bg-ink-1/85 p-2 shadow-lg shadow-black/20 backdrop-blur-xl">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.path;
          return (
            <li key={item.path}>
              <Link
                href={item.path}
                aria-label={item.name}
                aria-current={isActive ? 'page' : undefined}
                className="relative flex h-12 w-12 items-center justify-center rounded-full no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink"
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full bg-brand/15 shadow-[0_0_18px_-2px_rgba(255,77,26,0.55)]"
                  />
                )}
                <Icon
                  name={isActive ? item.activeIcon : item.icon}
                  size={24}
                  className={`relative transition-transform duration-ui ease-enter ${
                    isActive ? 'scale-110 text-brand-ink' : 'text-fg-mute'
                  }`}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
