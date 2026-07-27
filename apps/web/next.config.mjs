import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Traces exactly the files the server needs into .next/standalone, so the
  // runtime image carries a few hundred MB instead of the whole monorepo's
  // node_modules. Required by infra/docker/Dockerfile.web.
  output: 'standalone',
  // The monorepo root, so tracing follows workspace symlinks correctly.
  //
  // fileURLToPath, NOT new URL(...).pathname: on Windows the latter yields
  // "/D:/..." with a leading slash, which is not a usable filesystem path and
  // breaks the build on the dev machine but not in the container — the worst
  // kind of difference. Resolved from this file rather than process.cwd() so it
  // does not depend on where the build was invoked from, and so it needs no
  // `process` global (which eslint rightly flags in a browser-adjacent config).
  outputFileTracingRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  /**
   * Where build output goes. Defaults to `.next`, which is what CI and the
   * Dockerfile expect — but overridable, and that override is the whole point.
   *
   * `next build` and `next dev` otherwise share one directory. A production
   * build run while the dev server is up replaces the chunks that server has
   * open, and it then dies on the next request with "Cannot find module
   * './307.js'" — a message that points at webpack internals and says nothing
   * about the actual cause. It has happened three times in this project, each
   * time from someone verifying a route while dev was running.
   *
   * So a verification build uses `pnpm build:check`, which sets this to a
   * separate directory and cannot touch the running server. Deployment is
   * unaffected: nothing sets the variable, so it stays `.next`.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',

  poweredByHeader: false,

  /**
   * Proxies /v1/* to the API in DEVELOPMENT ONLY.
   *
   * In production Caddy does this (infra/caddy/Caddyfile), which is what makes
   * the API same-origin and lets the session cookie work without CORS. Locally
   * there is no Caddy, so every relative /v1/... call — sign-in, the privacy
   * toggles, TOTP enrolment, the whole admin console — 404s against the Next
   * server instead of reaching the API on :5001.
   *
   * That failure is confusing rather than obvious: the page renders fine and
   * only the buttons are dead, and the 404 comes from Next, so nothing appears
   * in the API log at all.
   *
   * Scoped to development deliberately. In production Caddy intercepts /v1
   * before Next ever sees it, so a rewrite here would be dead configuration
   * that looks meaningful — and if the container were ever addressed directly,
   * a silent second proxy path is not something to discover during an incident.
   */
  async rewrites() {
    if (process.env.NODE_ENV === 'production') return [];
    const api = process.env.API_INTERNAL_URL ?? 'http://localhost:5001';
    return [{ source: '/v1/:path*', destination: `${api}/v1/:path*` }];
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Strict CSP. Nonces arrive with the forum's user HTML in P2 (INV-035);
          // this baseline already denies framing and plugins outright.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
