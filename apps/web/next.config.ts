import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  // TIFFs vão diretamente ao Storage via URL assinada; Next.js recebe apenas JSON pequeno.
  reactStrictMode: true,
};
export default nextConfig;
