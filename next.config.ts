import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Streaming + security for all pages (see Next self-hosting guide:
        // nginx must not buffer chunked responses for live campaign progress)
        source: "/:path*",
        headers: [
          { key: "X-Accel-Buffering", value: "no" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // Payment + Telegram APIs must never be cached by Cloudflare or nginx.
        // POSTs aren't cached by default, but this makes the intent explicit
        // so NOWPayments IPN / verify polls always hit the origin server.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
