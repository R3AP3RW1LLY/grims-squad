import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: "Grim's Squad — No Quarter in the Void",
  description:
    "Elite Dangerous squadron. Player minor faction, fleet carriers, combat and AX, trade, " +
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
    <html lang="en">
      <body className="scanlines min-h-dvh antialiased">
        {/* Skip link is the first focusable element. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-[var(--color-surface-panel-raised)] focus:px-4 focus:py-2 focus:text-[var(--color-text-primary)]"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
