import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 로컬 개발 중 같은 Wi-Fi의 휴대폰 등에서 접속해 확인할 수 있도록 허용.
  allowedDevOrigins: ["192.168.0.106"],
};

export default nextConfig;
