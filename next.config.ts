import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev-mode route badge sits over the editor chrome; compile and runtime errors still show
  devIndicators: false,
};

export default nextConfig;
