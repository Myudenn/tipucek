#!/bin/bash
# Retry build TipuCek sampai berhasil (penanganan gelombang EPERM VM).
# Tiap percobaan: coba build langsung dulu (npm run build -> dist/).
# Bila gagal, coba jalur cadangan: build ke /tmp/tipucek-dist lewat
# tools/vite.tmpfs.config.js, lalu salin public/ via cp biasa
# (copyFileSync Vite gagal EPERM dari /dev/mapper/rv saat gelombang).
# Hanya BUILD — tidak deploy. Bila READY TO DEPLOY tercetak, deploy
# manual: firebase deploy --only hosting (token di /tmp/firebase-config).
# Lokasi tahan restart VM (di workspace, bukan /tmp).
set -u
cd "$(dirname "$0")/.." || exit 1
DIST=/tmp/tipucek-dist
CFG="$PWD/tools/vite.tmpfs.config.js"
echo "build-retry: mulai $(date '+%H:%M:%S WIB')"
for i in $(seq 1 150); do
  # Jalur utama: build langsung ke dist/.
  if npm run build >/tmp/build-retry-attempt.log 2>&1; then
    if [ -f dist/index.html ] && [ "$(wc -c < dist/index.html)" -gt 10000 ]; then
      echo "build-retry: build langsung OK pada percobaan $i"
      echo "READY TO DEPLOY — dist segar di $PWD/dist"
      exit 0
    fi
  fi
  # Jalur cadangan: build ke /tmp + salin public/ via cp.
  if npx vite build --config "$CFG" >/tmp/build-retry-attempt.log 2>&1; then
    if [ -f "$DIST/index.html" ] && [ "$(wc -c < "$DIST/index.html")" -gt 10000 ]; then
      cp -r public/. "$DIST/" 2>/dev/null
      ok=1
      for f in public/*; do [ -f "$DIST/$(basename "$f")" ] || ok=0; done
      if [ "$ok" = 1 ]; then
        echo "build-retry: build /tmp OK pada percobaan $i"
        echo "READY TO DEPLOY — dist segar di $DIST (bundle baru, bukan dist proyek)"
        exit 0
      fi
    fi
  fi
  sleep 2
done
echo "build-retry: GAGAL sesudah 150 percobaan — lihat /tmp/build-retry-attempt.log"
exit 1
