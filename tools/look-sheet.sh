#!/usr/bin/env bash
set -euo pipefail

# tools/look-sheet.sh
#
# Produces the comparison sheet for the 3 Looks in src/MantraReel/Look.tsx,
# rendered through the REAL Remotion pipeline (an OffthreadVideo wrapped in
# <Look>, rendered with @remotion/bundler + @remotion/renderer — the same
# SVG-filter code path the reel itself uses) against the same 3 source
# frames of public/mantra/danna-01-proxy.mp4 (~2s, ~12s, ~22s), plus the 3
# raw source frames for comparison.
#
# Output: 12 PNGs in public/mantra/looks/ (gitignored):
#   source-02s.png / source-12s.png / source-22s.png
#   natural-02s.png / warm-02s.png / crisp-02s.png  (and -12s / -22s)
#
# This script writes two temporary files inside the repo (a Remotion entry
# point and a Node driver script) so the Remotion bundler can resolve
# node_modules and staticFile() correctly. Both are deleted on exit — this
# script does not leave any new source file behind, and it never touches
# src/Root.tsx or src/MantraReel/Reel.tsx.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FFMPEG="${FFMPEG:-/Users/dannakushnir/.local/bin/ffmpeg}"
SRC="public/mantra/danna-01-proxy.mp4"
OUT_DIR="public/mantra/looks"
FPS=30
DURATION_SEC=26.27
FRAMES_SEC=(2 12 22)

mkdir -p "$OUT_DIR"

ENTRY="$REPO_ROOT/.look-sheet-entry.tsx"
DRIVER="$REPO_ROOT/.look-sheet-driver.mjs"
cleanup() { rm -f "$ENTRY" "$DRIVER"; }
trap cleanup EXIT

cat > "$ENTRY" <<'EOF'
import React from "react";
import { registerRoot, Composition, OffthreadVideo, staticFile } from "remotion";
import { Look } from "./src/MantraReel/Look";

const FPS = 30;
const DURATION_SEC = 26.27;

const LookStill = ({ look }) => (
  <Look look={look}>
    <OffthreadVideo
      src={staticFile("mantra/danna-01-proxy.mp4")}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  </Look>
);

const LookSheetRoot = () => (
  <>
    {["natural", "warm", "softCrisp"].map((look) => (
      <Composition
        key={look}
        id={`LookSheet-${look}`}
        component={LookStill}
        width={1080}
        height={1920}
        fps={FPS}
        durationInFrames={Math.round(DURATION_SEC * FPS)}
        defaultProps={{ look }}
      />
    ))}
  </>
);

registerRoot(LookSheetRoot);
EOF

cat > "$DRIVER" <<EOF
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

const entry = "$ENTRY";
const outDir = "$REPO_ROOT/$OUT_DIR";
const looks = ["natural", "warm", "softCrisp"];
const framesSec = [${FRAMES_SEC[@]/%/,}];
const fps = $FPS;

console.log("Bundling (once, reused for every still)...");
const serveUrl = await bundle({ entryPoint: entry, onProgress: () => {} });

for (const look of looks) {
  const id = \`LookSheet-\${look}\`;
  const composition = await selectComposition({ serveUrl, id });
  for (const sec of framesSec) {
    const out = \`\${outDir}/\${look}-\${String(sec).padStart(2, "0")}s.png\`;
    console.log(\`Rendering \${out}\`);
    await renderStill({
      composition,
      serveUrl,
      output: out,
      frame: Math.round(sec * fps),
      imageFormat: "png",
      overwrite: true,
    });
  }
}

console.log("Done.");
EOF

echo "== Extracting source reference frames =="
for t in "${FRAMES_SEC[@]}"; do
  "$FFMPEG" -y -ss "$t" -i "$SRC" -frames:v 1 \
    "$OUT_DIR/source-$(printf '%02d' "$t")s.png" -loglevel error
done

echo "== Rendering look stills through Remotion =="
node "$DRIVER"

echo "== Output =="
ls -la "$OUT_DIR"
