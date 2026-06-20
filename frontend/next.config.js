/** @type {import('next').NextConfig} */
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const nextConfig = {
  reactStrictMode: true,
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  async rewrites() {
    // Proxy /api/* to the FastAPI backend so the frontend can use same-origin paths.
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};

module.exports = nextConfig;
