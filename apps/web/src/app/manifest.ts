import type { MetadataRoute } from 'next';

/**
 * PWA manifest — makes the hub installable to a home screen.
 *
 * Next serves this at /manifest.webmanifest and links it automatically.
 *
 * TWO ICON PURPOSES, because they are not interchangeable:
 *   `any`      — drawn as supplied, transparent background preserved.
 *   `maskable` — the platform CROPS it to whatever shape it likes (circle on
 *                Android, squircle on some launchers). A transparent icon with
 *                content to the edges gets its corners eaten, so the maskable
 *                variant is padded onto solid void with the badge inset well
 *                inside the safe zone.
 *
 * Shipping only `any` is the usual mistake: Android then draws a white circle
 * behind the icon and the badge floats in the middle of it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Grim's Squad Hub",
    short_name: "Grim's Squad",
    description:
      'Squadron hub for Grim’s Squad — operations, market data, fleet and the background simulation.',
    start_url: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#05070a',
    theme_color: '#05070a',
    categories: ['games', 'utilities'],
    icons: [
      { src: '/brand/badge-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/badge-512-transparent.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512-safe.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
