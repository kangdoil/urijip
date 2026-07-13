import type { Metadata } from "next";
import localFont from "next/font/local";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthBoot } from "@/components/auth-boot";

// 한글 UI 전용 서비스라 Pretendard(가변 폰트)를 기본 산세리프로 쓴다.
// Tailwind의 font-sans가 이 값을 그대로 참조하도록 변수명을 --font-sans로 맞췄다
// (globals.css의 `@theme inline { --font-sans: var(--font-sans); }`와 짝을 이룸).
const pretendard = localFont({
  src: "../../public/fonts/PretendardVariable.woff2",
  variable: "--font-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "우리집 — 신혼집 찾기",
  description: "신혼부부 2인이 주거 조건을 조율해 함께 살 구역을 찾는 서비스",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${pretendard.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthBoot />
        {children}
      </body>
    </html>
  );
}
