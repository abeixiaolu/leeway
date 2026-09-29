import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Leeway · 个人财务",
  description: "清楚掌握资金、支出计划与财务安全月数。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
