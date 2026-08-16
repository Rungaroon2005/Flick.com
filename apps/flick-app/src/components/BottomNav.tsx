'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React from 'react';

interface NavItem {
  name: string;
  path: string;
  icon: React.ReactNode;
  activeIcon: React.ReactNode;
}

const ICON_CLASS = 'h-6 w-6 transition-transform duration-150';

export default function BottomNav() {
  const pathname = usePathname();

  const navItems: NavItem[] = [
    {
      name: 'หน้าหลัก',
      path: '/home',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={ICON_CLASS}>
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>
      ),
      activeIcon: (
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" className={ICON_CLASS}>
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          <rect x="9" y="12" width="6" height="10" fill="#0B0908"></rect>
        </svg>
      )
    },
    {
      name: 'แนะนำ',
      path: '/discover',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={ICON_CLASS}>
          <circle cx="12" cy="12" r="10"></circle>
          <polygon points="10 8 16 12 10 16 10 8"></polygon>
        </svg>
      ),
      activeIcon: (
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" className={ICON_CLASS}>
          <circle cx="12" cy="12" r="10"></circle>
          <polygon points="10 8 16 12 10 16 10 8" fill="#0B0908"></polygon>
        </svg>
      )
    },
    {
      name: 'บันทึก',
      path: '/bookmarks',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={ICON_CLASS}>
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
        </svg>
      ),
      activeIcon: (
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" className={ICON_CLASS}>
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
        </svg>
      )
    },
    {
      name: 'โปรไฟล์',
      path: '/profile',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={ICON_CLASS}>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      ),
      activeIcon: (
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" className={ICON_CLASS}>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      )
    }
  ];

  return (
    <nav
      className="fixed inset-x-4 z-[1000] flex justify-center"
      style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
    >
      <ul
        className="m-0 flex w-full max-w-sm list-none items-center justify-around rounded-full
          border border-white/10 bg-zinc-900/75 p-2
          shadow-lg shadow-black/20 backdrop-blur-xl"
      >
        {navItems.map((item) => {
          const isActive = pathname === item.path;
          return (
            <li key={item.path}>
              <Link
                href={item.path}
                aria-label={item.name}
                aria-current={isActive ? 'page' : undefined}
                className="relative flex h-12 w-12 items-center justify-center rounded-full no-underline"
              >
                {/* Cozy active state — a soft tinted glow behind the icon
                    rather than a hard color snap, so switching tabs feels
                    tactile instead of a flat state toggle. */}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full bg-brand/15 shadow-[0_0_18px_-2px_rgba(255,77,26,0.55)]"
                  />
                )}
                <span
                  className={`relative flex items-center justify-center transition-transform duration-200
                    ${isActive ? 'scale-110 text-brand-ink' : 'text-neutral-400'}`}
                >
                  {isActive ? item.activeIcon : item.icon}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
