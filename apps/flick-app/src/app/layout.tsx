import { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Flick — ดูหนังสั้นออนไลน์',
  description: 'แพลตฟอร์มสตรีมมิ่งหนังสั้นออนไลน์ ดูหนังสั้น ซีรี่ส์ ดราม่า สยองขวัญ แอ็คชั่น โรแมนติก ได้ทุกที่ทุกเวลา',
  keywords: 'หนังสั้น, สตรีมมิ่ง, ซีรี่ส์ไทย, ดูหนังออนไลน์, Flick',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <meta name="theme-color" content="#000000" />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
