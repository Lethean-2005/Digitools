"""Rasterize a logo (SVG/PNG/JPG) into a tight-cropped, multi-size favicon set."""
import os
import shutil
import subprocess
import sys
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "frontend" / "src" / "assets" / "download.png"
PUBLIC = ROOT / "frontend" / "public"
PUBLIC.mkdir(exist_ok=True)

work = PUBLIC.parent / ".favicon_tmp"
shutil.rmtree(work, ignore_errors=True)
work.mkdir()

RENDER_PX = 2048

# Step 1: load the source as an RGBA image at high resolution
if SRC.suffix.lower() == ".svg":
    SOFFICE = r"C:\Program Files\LibreOffice\program\soffice.com"
    LO_PY = next(Path(r"C:\Program Files\LibreOffice\program").glob("python-core-*"), None)
    env = {**os.environ}
    if LO_PY:
        env["PYTHONHOME"] = str(LO_PY)
    env.pop("PYTHONPATH", None)

    print(f"converting {SRC.name} -> PDF…")
    result = subprocess.run(
        [SOFFICE, "--headless", "--norestore", "--convert-to", "pdf",
         "--outdir", str(work), str(SRC)],
        capture_output=True, text=True, env=env, timeout=60,
    )
    if result.returncode != 0:
        print("LibreOffice failed:", result.stderr or result.stdout)
        sys.exit(1)
    pdf = next(work.glob("*.pdf"))

    doc = fitz.open(str(pdf))
    page = doc[0]
    scale = RENDER_PX / max(page.rect.width, page.rect.height)
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    hires = work / "hires.png"
    pix.save(str(hires))
    doc.close()
    src_rgba = Image.open(hires).convert("RGBA")
else:
    src_rgba = Image.open(SRC).convert("RGBA")
    if max(src_rgba.size) < RENDER_PX:
        scale = RENDER_PX / max(src_rgba.size)
        new_size = (round(src_rgba.width * scale), round(src_rgba.height * scale))
        src_rgba = src_rgba.resize(new_size, Image.LANCZOS)

# Step 2: figure out content mask
# If the source has any transparency, trust its alpha channel.
# Otherwise, detect a uniform background color and treat that as transparent.
alpha = src_rgba.split()[-1]
alpha_min = alpha.getextrema()[0]

if alpha_min < 250:
    print(f"hires: {src_rgba.size}, using alpha channel (min alpha={alpha_min})")
    src = src_rgba
else:
    src_rgb = src_rgba.convert("RGB")
    bg_color = src_rgb.getpixel((0, 0))
    print(f"hires: {src_rgb.size}, no alpha — bg corner color: {bg_color}")
    diff = ImageChops.difference(src_rgb, Image.new("RGB", src_rgb.size, bg_color)).convert("L")
    mask = diff.point(lambda p: 255 if p > 12 else 0, mode="L")
    src = Image.new("RGBA", src_rgb.size, (0, 0, 0, 0))
    src.paste(src_rgb, mask=mask)

bbox = src.split()[-1].getbbox()
if not bbox:
    print("no non-background pixels found")
    sys.exit(1)
print(f"content bbox: {bbox} ({bbox[2]-bbox[0]} x {bbox[3]-bbox[1]})")
cropped = src.crop(bbox)

# Step 3: square-pad with transparency
side = max(cropped.size)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.paste(cropped, ((side - cropped.width) // 2, (side - cropped.height) // 2), cropped)

# Step 4: render the favicon set
PADDING_PCT = 0.0  # Pinterest-style edge-to-edge

def render_at(size: int) -> Image.Image:
    margin = max(0, int(round(size * PADDING_PCT)))
    inner = max(1, size - 2 * margin)
    scaled = square.resize((inner, inner), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(scaled, (margin, margin), scaled)
    return canvas

SIZES = [16, 32, 48, 180, 192, 512]
for size in SIZES:
    img = render_at(size)
    name = "apple-touch-icon.png" if size == 180 else f"favicon-{size}x{size}.png"
    img.save(PUBLIC / name, optimize=True)
    print(f"  wrote {name} ({size}x{size})")

ico_sizes = [(16, 16), (32, 32), (48, 48)]
ico_imgs = [render_at(s) for s, _ in ico_sizes]
ico_imgs[0].save(PUBLIC / "favicon.ico", format="ICO", sizes=ico_sizes)
print("  wrote favicon.ico (16/32/48)")

shutil.rmtree(work, ignore_errors=True)
print("done.")
