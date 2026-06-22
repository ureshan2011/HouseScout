/** @type {import('next').NextConfig} */

// Static export for GitHub Pages. A project site is served from a sub-path
// (https://<user>.github.io/<repo>/), so basePath/assetPrefix are derived from
// NEXT_PUBLIC_BASE_PATH (set by the deploy workflow to "/<repo>"). Leave it unset
// for local `npm run dev` / root-hosted deployments.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig = {
  output: "export",
  reactStrictMode: true,
  trailingSlash: true, // emit /path/index.html so deep links work on GitHub Pages
  images: { unoptimized: true }, // no server to run Next's image optimiser
  basePath: basePath || undefined,
  assetPrefix: basePath ? `${basePath}/` : undefined,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

module.exports = nextConfig;
