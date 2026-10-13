/** @type {import('next').NextConfig} */
const nextConfig = {
  // In development ALTAR is opened through the gateway (http://localhost:8080), not Next's own port.
  allowedDevOrigins: (process.env.ALTAR_DEV_ORIGINS || "localhost,127.0.0.1").split(","),
  poweredByHeader: false,
  // The repo has its own AGENTS.md; stop Next writing another one here.
  agentRules: false,
};

export default nextConfig;
