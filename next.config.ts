import type { NextConfig } from "next";
import { readFileSync } from "node:fs";

// The editor is served from this server (see src/app/monaco), under its own version in the URL
const monacoVersion = JSON.parse(readFileSync("node_modules/monaco-editor/package.json", "utf8")).version as string;

const nextConfig: NextConfig = {
  // The dev-mode route badge sits over the editor chrome; compile and runtime errors still show
  devIndicators: false,
  env: { NEXT_PUBLIC_MONACO_VERSION: monacoVersion },
};

export default nextConfig;
