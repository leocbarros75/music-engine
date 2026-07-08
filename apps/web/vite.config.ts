import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/generate":              "http://localhost:3001",
      "/generate_from_chords":  "http://localhost:3001",
      "/list_parts":            "http://localhost:3001",
      "/extract_part":          "http://localhost:3001",
      "/arrange_musicxml":      "http://localhost:3001",
      "/analyze_harmony":       "http://localhost:3001",
      "/omr_to_musicxml":       "http://localhost:3001",
      "/parse_pdf":             "http://localhost:3001",
      "/health":                "http://localhost:3001"
    }
  }
});
