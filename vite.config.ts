import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const port = Number(process.env.PORT) || 5183;

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { host: true, port },
  preview: { host: true, port },
});
