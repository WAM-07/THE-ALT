/** @type {import('next').NextConfig} */
const nextConfig = {
  // Served by the gateway at http://localhost:8080/portal, beside the services and ALTAR web.
  basePath: "/portal",
  allowedDevOrigins: (process.env.PORTAL_DEV_ORIGINS || "localhost,127.0.0.1").split(","),
  poweredByHeader: false,
  // The dev badge sits on top of the rail's sign-out button.
  devIndicators: false,
  // The repo has its own AGENTS.md; stop Next writing another one here.
  agentRules: false,
  // A staff tool: never framed, never indexed, never leaks its address to other sites.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
