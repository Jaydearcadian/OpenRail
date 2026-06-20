import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Collapse the v1.x @mysten/sui copies (dapp-kit pins 1.45.2; enoki nests 1.36)
  // to a single module so Transaction/wallet identity stays consistent in the bundle.
  resolve: {
    dedupe: ["@mysten/sui", "@tanstack/react-query", "react", "react-dom"],
  },
});
