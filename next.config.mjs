/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Local dev only: the Next.js "N" badge defaults to bottom-left, where the
  // helper dock (assistant faces + 💡) sits. Keep it out of the way.
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
