import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const sourceDirectory = fileURLToPath(new URL("./src", import.meta.url));
const importProtection = {
  behavior: "error" as const,
  client: { files: ["**/server/**"], specifiers: ["server-only"] },
};

export default defineConfig(({ command }) => ({
  resolve: {
    alias: { "@": sourceDirectory },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
    ignoreOutdatedRequests: true,
  },
  plugins: [
    tailwindcss(),
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      importProtection,
      server: { entry: "server" },
    }),
    ...(command === "build"
      ? [nitro({ defaultPreset: "cloudflare-module", output: { dir: "dist" } })]
      : []),
    react(),
  ],
  server: { host: "::", port: 8080, allowedHosts: [".lovable.app"] },
  preview: { allowedHosts: [".lovable.app"] },
}));
