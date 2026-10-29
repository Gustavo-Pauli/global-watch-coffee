import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  // Uploads grandes são encaminhados por Route Handler com checagem de limite.
  reactStrictMode: true,
};
export default nextConfig;
