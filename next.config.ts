import type { NextConfig } from "next";

/**
 * 双模式构建：
 * - 默认（预览环境）：standalone 输出
 * - EXPORT_MODE=1（GitHub Pages 静态导出）：output=export → ./out
 *   BASE_PATH 用于项目页路径（如 /battle-forge）
 */
const isExport = process.env.EXPORT_MODE === "1";
const basePath = process.env.BASE_PATH || "";

const nextConfig: NextConfig = {
  ...(isExport
    ? { output: "export" as const, images: { unoptimized: true } }
    : { output: "standalone" as const }),
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
