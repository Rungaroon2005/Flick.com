import { Metadata, Viewport } from 'next';
import { Anuphan, IBM_Plex_Sans_Thai, IBM_Plex_Mono } from 'next/font/google';
import AuthProvider from '@/components/AuthProvider';
import { ToastProvider } from '@/components/ui/Toast';
import './globals.css';

// Display face — loopless, variable, Thai+Latin. Used ≥20px only.
const anuphan = Anuphan({
  subsets: ['thai', 'latin'],
  variable: '--font-anuphan',
  display: 'swap',
});

// Body/UI face — looped, Latin co-designed with the Thai glyphs so mixed
// Thai/English strings (VIP, 1080p, ฿149) hold one texture.
const plexThai = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-thai',
  display: 'swap',
});

// Data face — tabular figures for timecodes, coin balances, episode numbers.
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Flick — ดูหนังสั้นออนไลน์',
  description: 'แพลตฟอร์มสตรีมมิ่งหนังสั้นออนไลน์ ดูหนังสั้น ซีรี่ส์ ดราม่า สยองขวัญ แอ็คชั่น โรแมนติก ได้ทุกที่ทุกเวลา',
  keywords: 'หนังสั้น, สตรีมมิ่ง, ซีรี่ส์ไทย, ดูหนังออนไลน์, Flick',
  icons: { icon: '/favicon.ico' },
};

// viewportFit: 'cover' is what makes env(safe-area-inset-*) resolve to a
// real value instead of 0 — required by the portrait player's safe-area
// chrome and the bottom nav's pb-safe (docs/FRONTEND_PLAN.md Part 2).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0B0908',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="th"
      className={`${anuphan.variable} ${plexThai.variable} ${plexMono.variable}`}
    >
      <body>
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
