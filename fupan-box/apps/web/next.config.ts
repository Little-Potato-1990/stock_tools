import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 16 默认拦截非 same-origin 的 dev 资源请求, 导致从 127.0.0.1 / 局域网 IP
  // 打开页面时 HMR 与 client chunks 被 block, 浏览器永远停在 ClientShell 的 "加载中..." 占位.
  // 这里把本机常用 dev origin 全部放行.
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "192.168.31.124",
    "0.0.0.0",
  ],
};

export default nextConfig;
