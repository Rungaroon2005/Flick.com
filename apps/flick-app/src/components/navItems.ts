import type { IconName } from './ui/Icon';

export interface NavItem {
  name: string;
  path: string;
  icon: IconName;
  activeIcon: IconName;
}

/**
 * The tab set, shared by BottomNav (below lg) and HeaderNav (lg and up).
 * One source of truth on purpose: a tab added to only one renderer is
 * invisible on half the devices and passes every screen it is tested on.
 */
export const NAV_ITEMS: NavItem[] = [
  { name: 'หน้าหลัก', path: '/home', icon: 'home', activeIcon: 'homeFilled' },
  { name: 'แนะนำ', path: '/discover', icon: 'discover', activeIcon: 'discoverFilled' },
  { name: 'บันทึก', path: '/bookmarks', icon: 'bookmark', activeIcon: 'bookmarkFilled' },
  { name: 'โปรไฟล์', path: '/profile', icon: 'profile', activeIcon: 'profileFilled' },
];
