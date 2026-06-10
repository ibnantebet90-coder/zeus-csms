import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  // Pindahkan ke luar dari objek experimental
  allowedDevOrigins: ["localhost"],
};

export default nextConfig;