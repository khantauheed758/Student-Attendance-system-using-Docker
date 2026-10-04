import './globals.css';
import type { Metadata } from 'next';

const COPYRIGHT =
  'Copyright © 2026 Tauheed Khan, JNEC Aurangabad. All rights reserved.';

export const metadata: Metadata = {
  title: 'Attendly — Attendance, beautifully simple',
  description:
    'Secure, teacher-led attendance intelligence for modern classrooms.',
  applicationName: 'Attendly',
  authors: [{ name: 'Tauheed Khan', url: 'mailto:khantauheed759@gmail.com' }],
  creator: 'Tauheed Khan',
  publisher: 'Tauheed Khan',
  keywords: [
    'Attendly',
    'attendance management',
    'Tauheed Khan',
    'JNEC Aurangabad',
    'teacher-led attendance',
  ],
  other: {
    copyright: COPYRIGHT,
    author: 'Tauheed Khan',
    'product-owner': 'Tauheed Khan (JNEC Aurangabad)',
    'contact-email': 'khantauheed759@gmail.com',
  },
  openGraph: {
    title: 'Attendly — teacher-led attendance',
    description: `Created and managed by Tauheed Khan, JNEC Aurangabad. ${COPYRIGHT}`,
    type: 'website',
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
