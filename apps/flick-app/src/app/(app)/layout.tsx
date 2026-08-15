import BottomNav from '@/components/BottomNav';

/**
 * Shared shell for every tab-bar route (home, discover, bookmarks,
 * downloads, profile, search). BottomNav lived inside each of those six
 * page.tsx/Client.tsx files before this — it unmounted and remounted on
 * every tab switch, which structurally blocks any cross-route transition
 * (docs/FRONTEND_PLAN.md Part 4 prerequisite, Phase 2). Mounting it once
 * here fixes that; BottomNav is position:fixed, so hoisting it doesn't
 * change anything about how it renders.
 */
export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <BottomNav />
    </>
  );
}
