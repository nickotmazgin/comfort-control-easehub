#!/usr/bin/env bash
set -euo pipefail

# Build a refined tri‑color collage from screenshots with a gradient background.
# - Fits tiles fully (no cropping) into uniform size
# - Adapts columns/rows to image count (2 or 3 columns)
# - Adds subtle border/padding around each tile
# - Renders a tri‑color gradient (blue→green→orange) as the background only

SRC_DIR=${1:-"$HOME/Pictures/Screenshots/comfort control extension screenshots"}
OUT_PATH=${2:-"screenshots/collages/easehub_collage_tricolor.png"}

if [ ! -d "$SRC_DIR" ]; then
  echo "Source directory not found: $SRC_DIR" >&2
  exit 1
fi

if ! command -v convert >/dev/null || ! command -v montage >/dev/null || ! command -v identify >/dev/null; then
  echo "ImageMagick (convert/montage/identify) is required." >&2
  exit 2
fi

mapfile -t files < <(find "$SRC_DIR" -maxdepth 1 -type f \
  \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \) \
  | awk -F/ '{print $NF"\t"$0}' | sort -V | awk -F"\t" '{print $2}')

if [ ${#files[@]} -eq 0 ]; then
  echo "No images found in $SRC_DIR" >&2
  exit 3
fi

mkdir -p "$(dirname "$OUT_PATH")"
WORK=".collage_tmp"
rm -rf "$WORK" && mkdir -p "$WORK"

# Decide grid
N=${#files[@]}
COLS=3
if [ $N -le 4 ]; then COLS=2; fi
ROWS=$(( (N + COLS - 1) / COLS ))

# Tile size: 560x320 is a balanced 16:9 for readability
TW=560
TH=320
GAP=16
BORDER=6

# Prepare tiles (crop/center into uniform aspect)
idx=0
for f in "${files[@]}"; do
  printf -v of "%s/tile_%03d.png" "$WORK" "$idx"
  # Fit inside (no cropping), then pad to exact tile size with transparent background
  convert "$f" -auto-orient \
    -thumbnail ${TW}x${TH} -gravity center -background none -extent ${TW}x${TH} \
    -unsharp 0x1 \
    "$of"
  idx=$((idx+1))
done

# Build base collage
BASE="$WORK/base.png"
montage "$WORK"/tile_*.png \
  -background none \
  -bordercolor "#2a2f3f" -border $BORDER \
  -geometry ${TW}x${TH}+${GAP}+${GAP} \
  -tile ${COLS}x \
  "$BASE"

# Dimensions
WH=$(identify -format "%w %h" "$BASE")
W=${WH% *}
H=${WH#* }
HALF=$((W/2))

# Tri‑color gradient background (not affecting tile colors)
G1="$WORK/grad_l.png"
G2="$WORK/grad_r.png"
GRAD="$WORK/grad.png"
convert -size ${HALF}x${H} gradient:#1565c0-#43a047 "$G1"
convert -size ${HALF}x${H} gradient:#43a047-#fb8c00 "$G2"
convert "$G1" "$G2" +append "$GRAD"

# Compose: gradient as background, montage over it (no color blending)
OUT_TMP="$WORK/collage.png"
convert "$GRAD" "$BASE" -compose over -composite "$OUT_TMP"

# Rounded corners + light stroke
MASK="$WORK/mask.png"
R=24
convert -size ${W}x${H} xc:none -draw "roundrectangle 0,0 $((W-1)),$((H-1)),$R,$R" "$MASK"
convert "$OUT_TMP" "$MASK" -compose DstIn -composite "$OUT_TMP"
convert "$OUT_TMP" -stroke '#2a2f3f' -strokewidth 1 -fill none -draw "roundrectangle 0,0 $((W-1)),$((H-1)),$R,$R" "$OUT_TMP"

# Soft shadow for finished card
convert "$OUT_TMP" \( +clone -background '#000000' -shadow 30x8+0+8 \) +swap \
  -background none -layers merge +repage "$OUT_PATH"

echo "Saved collage: $OUT_PATH (${W}x${H})"
