import Link from 'next/link';
import { Icon } from './Icon';
import { HeaderNav } from './HeaderNav';

interface AppHeaderProps {
  greeting?: string;
  coinBalance?: number;
  activeAction?: 'downloads' | 'search';
  variant?: 'solid' | 'overlay';
}

const actions = [
  { name: 'downloads' as const, href: '/downloads', label: 'รายการของฉัน', icon: 'bookmark' as const },
  { name: 'search' as const, href: '/search', label: 'ค้นหา', icon: 'search' as const },
];

export function AppHeader({ greeting, coinBalance, activeAction, variant = 'solid' }: AppHeaderProps) {
  return (
    // Height is defined by --spacing-header in globals.css, not a literal
    // here: SearchClient's filter bar sticks at top-header against the same
    // token, and the root's scroll-padding-top is derived from it too.
    <header
      className={`sticky top-0 z-[100] flex h-header items-center justify-between px-5 backdrop-blur-sm md:px-8 lg:px-10 ${
        variant === 'overlay' ? 'bg-gradient-to-b from-black/90 to-transparent' : 'bg-ink/95'
      }`}
    >
      <div className="flex min-w-0 items-baseline gap-2.5">
        <div className="text-2xl font-extrabold tracking-tight text-brand-ink">Flick</div>
        {greeting && <span className="truncate text-[13px] text-fg-mute">สวัสดี, {greeting}</span>}
      </div>
      <HeaderNav />
      <div className="flex items-center gap-3">
        {coinBalance !== undefined && (
          <Link
            href="/profile"
            className="focus-ring flex items-center gap-1.5 rounded-full bg-fg/10 py-1.5 pr-3 pl-2 text-data font-medium text-coin transition-colors duration-ui hover:bg-fg/15"
          >
            <Icon name="coin" size={16} />
            {coinBalance}
          </Link>
        )}
        {actions.map((action) => {
          const className = `flex h-8 w-8 items-center justify-center rounded-full transition-all duration-ui ease-enter active:scale-90 ${
            activeAction === action.name ? 'bg-brand-ink/10 text-brand-ink' : 'bg-fg/10 text-fg hover:bg-fg/15'
          }`;
          return activeAction === action.name ? (
            <span key={action.name} aria-label={action.label} className={className}>
              <Icon name={action.icon} size={18} />
            </span>
          ) : (
            <Link
              key={action.name}
              href={action.href}
              aria-label={action.label}
              className={`focus-ring ${className}`}
            >
              <Icon name={action.icon} size={18} />
            </Link>
          );
        })}
      </div>
    </header>
  );
}
