const isProd = process.env.NODE_ENV === "production";
const repo = process.env.NEXT_PUBLIC_BASE_PATH ?? "/pnpki_form_reg";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath: isProd ? repo : "",
  assetPrefix: isProd ? `${repo}/` : "",
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_BASE_PATH: isProd ? repo : "",
  },
};

export default nextConfig;
