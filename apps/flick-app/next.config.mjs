import path from 'node:path';
import { fileURLToPath } from 'node:url';

const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: monorepoRoot,
  },
  experimental: {
    viewTransition: true,
  },
  images: {
    // Seed/demo posters are local (/posters/*.jpg) and need no entry here.
    // This wildcard unblocks next/image for real (production) poster and
    // thumbnail URLs until the CDN/storage host is finalized (see
    // docs/FRONTEND_PLAN.md Appendix — "Poster host confirmed"), at which
    // point this should narrow to that host's exact hostname.
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
};

export default nextConfig;
