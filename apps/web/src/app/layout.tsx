import type { Metadata, Viewport } from 'next';
import { Chakra_Petch, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { DeepField, SiteNav, SiteFooter } from '../components/site-chrome';

/*
 * Fonts are downloaded at BUILD time and served from our own origin. No runtime
 * request to Google, so no third-party tracking and no render-blocking round
 * trip on first paint. `display: swap` means text is readable immediately in the
 * fallback rather than invisible while a webfont loads.
 */
const display = Chakra_Petch({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-display-src',
  display: 'swap',
});

const body = Inter({
  subsets: ['latin'],
  variable: '--font-body-src',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-src',
  display: 'swap',
});

export const metadata: Metadata = {
  title: "Grim's Squad — No Quarter in the Void",
  description:
    'Elite Dangerous squadron. Player minor faction, fleet carriers, combat and AX, trade, ' +
    'mining and exploration. Operating from Hyades Sector AV-W b2-4.',
  applicationName: "Grim's Squad Hub",
  openGraph: {
    title: "Grim's Squad — No Quarter in the Void",
    description: 'Elite Dangerous squadron. Recruiting CMDRs.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#05070a',
  // Pinch-zoom is never disabled (ssot/07-design/accessibility.md).
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="scanlines flex min-h-dvh flex-col antialiased">
        {/* Skip link is the first focusable element. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:bg-[var(--color-surface-panel-raised)] focus:px-4 focus:py-2 focus:text-[var(--color-text-primary)]"
        >
          Skip to content
        </a>

        <DeepField />
        <SiteNav />

        <div className="flex-1">{children}</div>

        {/* Rendered here so INV-029's attribution cannot be omitted by a page. */}
        <SiteFooter />
      </body>
    </html>
  );
}
