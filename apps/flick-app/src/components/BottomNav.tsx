import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './BottomNav.module.css';
import React from 'react';

interface NavItem {
  name: string;
  path: string;
  icon: React.ReactNode;
  activeIcon: React.ReactNode;
}

export default function BottomNav() {
  const pathname = usePathname();

  const navItems: NavItem[] = [
    {
      name: 'หน้าหลัก',
      path: '/home',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.icon}>
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>
      ),
      activeIcon: (
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" className={styles.icon}>
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          <rect x="9" y="12" width="6" height="10" fill="#000"></rect>
        </svg>
      )
    },
    {
      name: 'แนะนำ',
      path: '/discover',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.icon}>
          <circle cx="12" cy="12" r="10"></circle>
          <polygon points="10 8 16 12 10 16 10 8"></polygon>
        </svg>
      ),
      activeIcon: (
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" className={styles.icon}>
          <circle cx="12" cy="12" r="10"></circle>
          <polygon points="10 8 16 12 10 16 10 8" fill="#000"></polygon>
        </svg>
      )
    },
    {
      name: 'บันทึก',
      path: '/bookmarks',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.icon}>
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
        </svg>
      ),
      activeIcon: (
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" className={styles.icon}>
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
        </svg>
      )
    },
    {
      name: 'โปรไฟล์',
      path: '/profile',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.icon}>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      ),
      activeIcon: (
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" className={styles.icon}>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      )
    }
  ];

  return (
    <nav className={styles.bottomNav}>
      <ul className={styles.navList}>
        {navItems.map((item) => {
          const isActive = pathname === item.path;
          return (
            <li key={item.path} className={styles.navItem}>
              <Link href={item.path} className={`${styles.navLink} ${isActive ? styles.active : ''}`}>
                <div className={styles.iconWrapper}>
                  {isActive ? item.activeIcon : item.icon}
                </div>
                <span className={styles.navText}>{item.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
