import type { NextConfig } from "next";
const config: NextConfig = { output: "standalone", outputFileTracingRoot: process.cwd(), reactStrictMode: true };
export default config;
