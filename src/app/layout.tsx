import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Serif_SC, Noto_Sans_SC } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** 标题衬线：跑团书的"金箔印刷"气质（此前 font-display 依赖系统 serif 回退，中文仍是雅黑） */
const notoSerifSC = Noto_Serif_SC({
  variable: "--font-serif-sc",
  subsets: ["latin"],
  weight: ["500", "700", "900"],
  display: "swap",
});

/** 正文黑体：Geist 无中文字形，此前全靠系统回退；显式加载保证跨平台一致 */
const notoSansSC = Noto_Sans_SC({
  variable: "--font-sans-sc",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "D&D 2024 战斗引擎 · Battle Forge",
  description: "D&D 2024 战术战斗前端：战术地图、先攻追踪、完整规则引擎、酒馆 <battle> 协议互通",
  keywords: ["D&D", "2024", "战斗", "跑团", "酒馆", "SillyTavern", "battle panel", "战术地图"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${notoSerifSC.variable} ${notoSansSC.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
