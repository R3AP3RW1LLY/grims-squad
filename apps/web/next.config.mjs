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
  poweredByHeader: false,
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
