import type { ReactNode } from 'react';
import { direction, t } from '@bnlinkvault/i18n';

export const metadata = { title: t('en', 'app.name'), description: t('en', 'app.tagline'), robots: { index: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir={direction('en')}>
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: '3rem auto', maxWidth: 640, padding: '0 1rem' }}>{children}</body>
    </html>
  );
}
