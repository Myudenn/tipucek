// Build ke /tmp (tmpfs) bila build di direktori proyek gagal EPERM.
// Dipakai oleh tools/build-retry.sh sebagai jalur cadangan.
// Self-contained: proyek ini TIDAK punya vite.config.* (vite build
// jalan dengan default) — jadi tidak ada impor config dasar.
import { defineConfig } from "vite";
export default defineConfig({
  publicDir: false,
  build: { outDir: "/tmp/tipucek-dist", emptyOutDir: true },
});
