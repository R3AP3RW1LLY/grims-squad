'use client';

import { useEffect } from 'react';

/**
 * When the root layout itself fails.
 *
 * ★ WHY THIS CANNOT SHARE THE OTHER PAGES' COMPONENT ★
 *
 * `error.tsx` renders INSIDE the root layout, so it inherits the fonts, the theme variables and
 * the shell. This one replaces the layout — Next requires it to emit its own `<html>` and `<body>`
 * — which means the stylesheet and the CSS custom properties everything else is written against
 * may not have loaded at all. A shared component styled with `var(--color-brand-orange)` would
 * render as unstyled black-on-white here, which is the exact impression this page exists to avoid.
 *
 * So the styling is inline and self-contained, and deliberately minimal: this is the last screen
 * before a browser's own error page, and it has to work with nothing.
 *
 * In practice it is almost never seen. That is not a reason to leave it out — the one time it
 * fires is the worst possible time to be showing a stack trace.
 */
export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#07090c',
          color: '#c9d3dd',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          padding: '2rem',
        }}
      >
        <div style={{ maxWidth: '34rem', textAlign: 'center' }}>
          <p
            style={{
              margin: 0,
              fontSize: '11px',
              letterSpacing: '0.32em',
              textTransform: 'uppercase',
              color: '#4fd2e8',
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            Something went wrong
          </p>
          <h1 style={{ margin: '0.75rem 0 0', fontSize: '1.75rem', color: '#ff8c42' }}>
            THE HUB COULD NOT LOAD
          </h1>
          <p style={{ marginTop: '1.5rem', fontSize: '0.9rem', lineHeight: 1.6 }}>
            This is temporary — the site may be updating. Nothing about your account has changed.
          </p>
          <div
            style={{
              marginTop: '2rem',
              display: 'flex',
              gap: '0.75rem',
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                border: '1px solid #4fd2e8',
                background: 'transparent',
                color: '#4fd2e8',
                padding: '0.65rem 1.25rem',
                borderRadius: '4px',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '12px',
                letterSpacing: '0.24em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                border: '1px solid #2a3440',
                color: '#c9d3dd',
                padding: '0.65rem 1.25rem',
                borderRadius: '4px',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '12px',
                letterSpacing: '0.24em',
                textTransform: 'uppercase',
                textDecoration: 'none',
              }}
            >
              Back to the hub
            </a>
          </div>
          {error.digest === undefined ? null : (
            <p
              style={{
                marginTop: '2rem',
                fontSize: '11px',
                opacity: 0.7,
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              Reference <span style={{ color: '#e8eef4' }}>{error.digest}</span>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
