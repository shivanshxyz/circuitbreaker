import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: [
    "@dynamic-labs-wallet/core",
    "@dynamic-labs-wallet/node-evm",
    "@evervault/wasm-attestation-bindings"
  ]
};

export default nextConfig;
