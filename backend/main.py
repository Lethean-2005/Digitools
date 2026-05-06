import asyncio
import io
import logging
import os
import platform
import re
import shutil
import subprocess
import time
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional
from urllib.parse import quote

IS_WINDOWS = platform.system() == "Windows"

import fitz  # PyMuPDF
import yt_dlp
from docx import Document
from docxcompose.composer import Composer
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from PIL import Image
from pydantic import BaseModel
from starlette.background import BackgroundTask

# Register HEIC/HEIF support so iPhone photos work in OCR / compress / resize / etc.
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except Exception:  # plugin not installed — non-fatal
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("converter")

_tg_app = None


@asynccontextmanager
async def lifespan(_app):
    global _tg_app
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if token:
        try:
            from bot import build_app, register_commands
            _tg_app = build_app(token)
            await _tg_app.initialize()
            await register_commands(_tg_app)
            await _tg_app.start()
            await _tg_app.updater.start_polling(drop_pending_updates=True)
            log.info("telegram bot polling started")
        except Exception:
            log.exception("telegram bot failed to start")
            _tg_app = None
    else:
        log.info("TELEGRAM_BOT_TOKEN unset — bot disabled")
    try:
        yield
    finally:
        if _tg_app:
            try:
                await _tg_app.updater.stop()
                await _tg_app.stop()
                await _tg_app.shutdown()
                log.info("telegram bot stopped")
            except Exception:
                log.exception("telegram bot shutdown error")


app = FastAPI(title="PDF / Media Converter", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=(
        r"^http://(localhost|127\.0\.0\.1)(:\d+)?$"
        r"|^https://[a-z0-9-]+\.vercel\.app$"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TMP_DIR = Path(__file__).parent / "tmp"
TMP_DIR.mkdir(exist_ok=True)

# ── PDF → DOCX (LibreOffice) ─────────────────────────
MAX_BYTES = 50 * 1024 * 1024
NUM_WORKERS = 4
MIN_PAGES_PER_CHUNK = 8
CHUNK_TIMEOUT_SEC = 1800

SOFFICE_DIR_CANDIDATES = [
    r"C:\Program Files\LibreOffice\program",
    r"C:\Program Files (x86)\LibreOffice\program",
    "/usr/lib/libreoffice/program",
    "/opt/libreoffice/program",
    "/usr/local/lib/libreoffice/program",
]
LO_DIR = next((p for p in SOFFICE_DIR_CANDIDATES if Path(p).exists()), None)
if LO_DIR is None:
    raise RuntimeError(
        "LibreOffice not found. Install it "
        "(Windows: winget install TheDocumentFoundation.LibreOffice; "
        "Debian/Ubuntu: apt-get install libreoffice)."
    )
SOFFICE = str(Path(LO_DIR) / ("soffice.com" if IS_WINDOWS else "soffice"))
LO_PYTHON_HOME = next(
    (str(p) for p in Path(LO_DIR).glob("python-core-*") if p.is_dir()),
    None,
)
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
EXECUTOR = ThreadPoolExecutor(max_workers=NUM_WORKERS, thread_name_prefix="lo")


def _soffice_env():
    env = os.environ.copy()
    # On Windows the bundled Python embedding inside soffice.bin can fail to find
    # its stdlib unless PYTHONHOME points at the LO-bundled python. On Linux the
    # distro's libreoffice package self-discovers — setting PYTHONHOME there
    # would break it.
    if IS_WINDOWS and LO_PYTHON_HOME:
        env["PYTHONHOME"] = LO_PYTHON_HOME
    env.pop("PYTHONPATH", None)
    return env


def _convert_one(pdf_path: Path, out_dir: Path, profile_dir: Path) -> Path:
    profile_dir.mkdir(parents=True, exist_ok=True)
    profile_url = profile_dir.absolute().as_uri()
    cmd = [
        SOFFICE,
        f"-env:UserInstallation={profile_url}",
        "--headless",
        "--norestore",
        "--nofirststartwizard",
        "--nologo",
        "--infilter=writer_pdf_import",
        "--convert-to",
        "docx:MS Word 2007 XML",
        "--outdir",
        str(out_dir),
        str(pdf_path),
    ]
    started = time.monotonic()
    log.info("soffice start: %s", pdf_path.name)
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=CHUNK_TIMEOUT_SEC,
        creationflags=CREATE_NO_WINDOW,
        env=_soffice_env(),
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"LibreOffice exited {result.returncode}: "
            f"{(result.stderr or result.stdout or '').strip()[:500]}"
        )
    out_path = out_dir / (pdf_path.stem + ".docx")
    if not out_path.exists():
        candidates = list(out_dir.glob(f"{pdf_path.stem}.docx"))
        if not candidates:
            raise RuntimeError("LibreOffice produced no .docx output.")
        out_path = candidates[0]
    log.info("soffice done: %s in %.1fs", pdf_path.name, time.monotonic() - started)
    return out_path


def _split_pdf(pdf_path: Path, out_dir: Path, num_chunks: int) -> list[Path]:
    src = fitz.open(str(pdf_path))
    try:
        n_pages = src.page_count
        pages_per_chunk = max(1, -(-n_pages // max(1, num_chunks)))
        out: list[Path] = []
        for i in range(num_chunks):
            start = i * pages_per_chunk
            end = min(start + pages_per_chunk, n_pages)
            if start >= end:
                break
            sub = fitz.open()
            try:
                sub.insert_pdf(src, from_page=start, to_page=end - 1)
                cp = out_dir / f"chunk_{i:02d}.pdf"
                sub.save(str(cp))
            finally:
                sub.close()
            out.append(cp)
        return out
    finally:
        src.close()


def _page_count(pdf_path: Path) -> int:
    src = fitz.open(str(pdf_path))
    try:
        return src.page_count
    finally:
        src.close()


def _merge_docx(parts: list[Path], output: Path) -> None:
    if len(parts) == 1:
        shutil.copyfile(parts[0], output)
        return
    log.info("merge %d parts -> %s", len(parts), output.name)
    started = time.monotonic()
    master = Document(str(parts[0]))
    composer = Composer(master)
    for p in parts[1:]:
        composer.append(Document(str(p)))
    composer.save(str(output))
    log.info("merge done in %.1fs", time.monotonic() - started)


# ── Media (yt-dlp) ───────────────────────────────────
class MediaUrl(BaseModel):
    url: str


class MediaDownload(BaseModel):
    url: str
    format: str = "video"  # "video" or "audio"


def _find_ffmpeg_dir() -> str | None:
    # 1) PATH
    found = shutil.which("ffmpeg")
    if found:
        return str(Path(found).parent)
    # 2) winget shim links
    shim = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Links" / "ffmpeg.exe"
    if shim.exists():
        return str(shim.parent)
    # 3) winget package locations
    pkgs = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    if pkgs.exists():
        for exe in pkgs.rglob("ffmpeg.exe"):
            return str(exe.parent)
    # 4) common install paths
    for p in (r"C:\Program Files\ffmpeg\bin", r"C:\ffmpeg\bin"):
        if (Path(p) / "ffmpeg.exe").exists():
            return p
    return None


FFMPEG_DIR = _find_ffmpeg_dir()
log.info("ffmpeg dir: %s", FFMPEG_DIR or "NOT FOUND")


def _ydl(opts: dict) -> dict:
    base = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "noplaylist": True,
    }
    if FFMPEG_DIR:
        base["ffmpeg_location"] = FFMPEG_DIR
    base.update(opts)
    return base


def _media_info_blocking(url: str) -> dict:
    with yt_dlp.YoutubeDL(_ydl({})) as ydl:
        info = ydl.extract_info(url, download=False)
    if isinstance(info, dict) and info.get("entries"):
        info = info["entries"][0]
    return {
        "title": info.get("title") or "untitled",
        "thumbnail": info.get("thumbnail"),
        "duration": info.get("duration"),
        "uploader": info.get("uploader") or info.get("channel"),
        "extractor": info.get("extractor_key") or info.get("extractor"),
        "webpage_url": info.get("webpage_url") or url,
    }


def _media_download_blocking(url: str, fmt: str, out_dir: Path) -> Path:
    if fmt == "audio":
        opts = _ydl({
            "format": "bestaudio/best",
            "outtmpl": str(out_dir / "%(title).200s.%(ext)s"),
            "restrictfilenames": True,
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }],
        })
    else:
        # Format chain — flexible enough for sites where audio isn't tagged
        # `m4a` (e.g. Pinterest tags its audio-only stream as `mp4`). Order:
        #   1. mp4 H.264 video + any audio (preferred)
        #   2. any video + any audio (covers WebM-only sources)
        #   3. progressive mp4 ≤1080p (single-stream)
        #   4. any progressive ≤1080p
        #   5. `b` — yt-dlp's "best of whatever's there" (last resort)
        opts = _ydl({
            "format": (
                "bv*[ext=mp4][height<=1080]+ba/"
                "bv*[height<=1080]+ba/"
                "b[ext=mp4][height<=1080]/"
                "b[height<=1080]/"
                "b"
            ),
            "outtmpl": str(out_dir / "%(title).200s.%(ext)s"),
            "restrictfilenames": True,
            "merge_output_format": "mp4",
        })

    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.extract_info(url, download=True)

    candidates = [
        p for p in out_dir.iterdir()
        if p.is_file() and p.suffix.lower() not in {".part", ".ytdl", ".tmp"}
    ]
    if not candidates:
        raise RuntimeError("yt-dlp produced no file.")
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0]


# ── Image (rembg) ─────────────────────────────────────
MAX_IMAGE_BYTES = 25 * 1024 * 1024
EMOJI_SIZES = {128, 256, 512}

# u2net (170 MB) is too big for 512 MB free-tier RAM. u2netp (~5 MB) fits and
# is plenty for product/portrait/silhouette use cases. Override via env var
# REMBG_MODEL if you upgrade to a paid plan and want better quality.
REMBG_MODEL = os.environ.get("REMBG_MODEL", "u2netp")
_REMBG_SESSION = None
_REMBG_LOCK = __import__("threading").Lock()


def _get_rembg_session():
    global _REMBG_SESSION
    if _REMBG_SESSION is None:
        with _REMBG_LOCK:
            if _REMBG_SESSION is None:  # double-checked
                from rembg import new_session
                log.info("loading rembg %s session…", REMBG_MODEL)
                _REMBG_SESSION = new_session(REMBG_MODEL)
    return _REMBG_SESSION


# Cap input dimensions before rembg / API so payloads stay reasonable.
_REMBG_MAX_DIM = 1024
_REMBG_INFER_LOCK = __import__("threading").Lock()
REMOVE_BG_API_KEY = os.environ.get("REMOVE_BG_API_KEY", "").strip()


def _downscale_for_rembg(data: bytes) -> bytes:
    img = Image.open(io.BytesIO(data))
    img.load()
    w, h = img.size
    big = max(w, h)
    if big <= _REMBG_MAX_DIM:
        return data
    scale = _REMBG_MAX_DIM / big
    img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=False)
    return buf.getvalue()


def _remove_bg_local(data: bytes) -> bytes:
    """Local rembg path — used when no remove.bg API key is configured."""
    from rembg import remove
    data = _downscale_for_rembg(data)
    with _REMBG_INFER_LOCK:
        return remove(data, session=_get_rembg_session())


async def _remove_bg_api(data: bytes) -> bytes:
    """remove.bg API path — used when REMOVE_BG_API_KEY is set."""
    import httpx
    data = _downscale_for_rembg(data)
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            "https://api.remove.bg/v1.0/removebg",
            headers={"X-Api-Key": REMOVE_BG_API_KEY},
            files={"image_file": ("image.png", data, "image/png")},
            data={"size": "auto", "format": "png"},
        )
    if r.status_code != 200:
        raise RuntimeError(f"remove.bg API {r.status_code}: {r.text[:300]}")
    return r.content


async def _cutout(data: bytes) -> bytes:
    """Background-removed PNG bytes. Picks API or local engine automatically."""
    if REMOVE_BG_API_KEY:
        return await _remove_bg_api(data)
    return await asyncio.to_thread(_remove_bg_local, data)


def _emoji_from_cutout(cut: bytes, size: int) -> bytes:
    img = Image.open(io.BytesIO(cut)).convert("RGBA")
    bbox = img.split()[-1].getbbox()
    if bbox:
        img = img.crop(bbox)
    side = max(img.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(img, ((side - img.width) // 2, (side - img.height) // 2), img)
    out = square.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


# ── OCR (Tesseract) ───────────────────────────────────
def _find_tesseract() -> str | None:
    found = shutil.which("tesseract")
    if found:
        return found
    if IS_WINDOWS:
        for p in (
            r"C:\Program Files\Tesseract-OCR\tesseract.exe",
            r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        ):
            if Path(p).exists():
                return p
    return None


TESSERACT_BIN = _find_tesseract()
log.info("tesseract: %s", TESSERACT_BIN or "NOT FOUND")

# If a sibling tessdata/ dir exists (handy on Windows where the system tessdata
# is under Program Files and adding language packs would need admin), prefer it.
_LOCAL_TESSDATA = Path(__file__).parent / "tessdata"
if _LOCAL_TESSDATA.is_dir():
    os.environ["TESSDATA_PREFIX"] = str(_LOCAL_TESSDATA)
    log.info("tessdata: %s", _LOCAL_TESSDATA)

OCR_LANGS = {"eng", "khm", "eng+khm"}


def _sniff_format(data: bytes) -> str:
    head = data[:16]
    if head.startswith(b"\xff\xd8\xff"): return "JPEG"
    if head.startswith(b"\x89PNG\r\n\x1a\n"): return "PNG"
    if head[:6] in (b"GIF87a", b"GIF89a"): return "GIF"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP": return "WebP"
    if head[:2] == b"BM": return "BMP"
    if head[:4] in (b"II*\x00", b"MM\x00*"): return "TIFF"
    if data[4:8] == b"ftyp":
        sub = data[8:12]
        if sub in (b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"):
            return f"HEIC/HEIF ({sub.decode('ascii', 'replace')})"
        if sub == b"avif":
            return "AVIF"
        return f"ISO-BMFF ({sub.decode('ascii', 'replace')})"
    if head[:5] == b"<?xml" or head[:4] == b"<svg":
        return "SVG"
    if head[:4] == b"%PDF":
        return "PDF"
    return f"unknown ({head[:8].hex()})"


def _rasterize_to_png(data: bytes, fmt: str) -> bytes:
    """Convert vector / multi-page formats to a PNG bytes blob via PyMuPDF."""
    if fmt.startswith("SVG"):
        ftype = "svg"
    elif fmt.startswith("PDF"):
        ftype = "pdf"
    else:
        return data
    with fitz.open(stream=data, filetype=ftype) as doc:
        page = doc[0]
        # 2× zoom so small text survives OCR
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        return pix.tobytes("png")


def _ocr_blocking(data: bytes, lang: str) -> str:
    import pytesseract
    if TESSERACT_BIN:
        pytesseract.pytesseract.tesseract_cmd = TESSERACT_BIN
    fmt = _sniff_format(data)
    if fmt.startswith(("SVG", "PDF")):
        try:
            data = _rasterize_to_png(data, fmt)
        except Exception as e:
            raise RuntimeError(f"Failed to rasterize {fmt}: {e}")
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as e:
        raise RuntimeError(
            f"Could not read image. Detected: {fmt}. PIL: {e}. "
            f"Supported: JPG / PNG / WEBP / GIF / BMP / TIFF / HEIC / SVG / PDF (1st page)."
        )
    return pytesseract.image_to_string(img, lang=lang)


# ── QR ────────────────────────────────────────────────
import qrcode
from qrcode.constants import ERROR_CORRECT_L, ERROR_CORRECT_M, ERROR_CORRECT_Q, ERROR_CORRECT_H

ECC_MAP = {"L": ERROR_CORRECT_L, "M": ERROR_CORRECT_M, "Q": ERROR_CORRECT_Q, "H": ERROR_CORRECT_H}


class QRRequest(BaseModel):
    text: str
    size: int = 512
    fg: str = "#0f172a"
    bg: str = "#ffffff"
    ecc: str = "M"  # L / M / Q / H


def _qr_blocking(req: QRRequest) -> bytes:
    qr = qrcode.QRCode(
        version=None,
        error_correction=ECC_MAP.get(req.ecc.upper(), ERROR_CORRECT_M),
        box_size=10,
        border=2,
    )
    qr.add_data(req.text)
    qr.make(fit=True)
    bg = (0, 0, 0, 0) if req.bg.lower() in {"transparent", "none", ""} else req.bg
    img = qr.make_image(fill_color=req.fg, back_color=bg).convert("RGBA")
    if img.size[0] != req.size:
        img = img.resize((req.size, req.size), Image.NEAREST)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


@app.get("/", response_class=HTMLResponse)
def root():
    return """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Digitools API</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 640px;
         margin: 4rem auto; padding: 0 1.25rem; line-height: 1.55; }
  h1 { margin-bottom: .25rem; }
  p.lead { color: #555; margin-top: 0; }
  code { background: rgba(127,127,127,.15); padding: .1rem .35rem; border-radius: 4px; }
  ul { padding-left: 1.25rem; }
  li { margin: .25rem 0; }
  a { color: #2563eb; }
</style>
</head>
<body>
  <h1>Digitools API</h1>
  <p class="lead">FastAPI backend. The web UI lives elsewhere — point it here via <code>VITE_API_BASE</code>.</p>
  <ul>
    <li><a href="/health">/health</a> — engine status</li>
    <li><a href="/docs">/docs</a> — interactive API docs (Swagger)</li>
    <li><a href="/redoc">/redoc</a> — alternative API docs</li>
  </ul>
  <p>Endpoints: <code>POST /convert</code>, <code>POST /media/info</code>, <code>POST /media/download</code>,
     <code>POST /image/remove-bg</code>, <code>POST /image/emoji</code>, <code>POST /image/ocr</code>,
     <code>POST /qr</code>.</p>
</body>
</html>"""


@app.get("/health")
def health():
    return {
        "status": "ok",
        "engines": {
            "pdf": "libreoffice-headless",
            "media": "yt-dlp",
            "image": "remove.bg-api" if REMOVE_BG_API_KEY else f"rembg-{REMBG_MODEL}",
            "image_edit": "pillow",
            "ocr": "tesseract" if TESSERACT_BIN else "missing",
            "qr": "qrcode",
            "gif": "ffmpeg" if FFMPEG_DIR else "missing",
            "md2pdf": "libreoffice+markdown",
        },
        "workers": NUM_WORKERS,
        "chunk_timeout_sec": CHUNK_TIMEOUT_SEC,
    }


@app.post("/qr")
async def qr_generate(req: QRRequest):
    if not req.text.strip():
        raise HTTPException(400, "Text is required.")
    if req.size not in {128, 256, 512, 1024}:
        raise HTTPException(400, "Size must be 128/256/512/1024.")
    if len(req.text) > 4000:
        raise HTTPException(400, "Text too long (max 4000 chars).")
    try:
        out = await asyncio.to_thread(_qr_blocking, req)
    except Exception as e:
        log.exception("qr failed")
        raise HTTPException(500, f"{e}")
    return StreamingResponse(
        io.BytesIO(out),
        media_type="image/png",
        headers={"Content-Disposition": 'attachment; filename="qr.png"'},
    )


@app.post("/image/remove-bg")
async def image_remove_bg(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Only image files are accepted.")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file.")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image exceeds 25 MB limit.")
    try:
        out = await _cutout(data)
    except Exception as e:
        log.exception("remove-bg failed")
        raise HTTPException(500, f"{e}")

    name = (Path(file.filename or "image").stem or "image") + "-nobg.png"
    ascii_fallback = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_") or "nobg.png"
    headers = {
        "Content-Disposition": (
            f'attachment; filename="{ascii_fallback}"; '
            f"filename*=UTF-8''{quote(name)}"
        )
    }
    return StreamingResponse(io.BytesIO(out), media_type="image/png", headers=headers)


@app.post("/image/emoji")
async def image_emoji(file: UploadFile = File(...), size: int = Form(256)):
    if size not in EMOJI_SIZES:
        raise HTTPException(400, f"size must be one of {sorted(EMOJI_SIZES)}.")
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Only image files are accepted.")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file.")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image exceeds 25 MB limit.")
    try:
        cut = await _cutout(data)
        out = await asyncio.to_thread(_emoji_from_cutout, cut, size)
    except Exception as e:
        log.exception("emoji failed")
        raise HTTPException(500, f"{e}")

    name = (Path(file.filename or "emoji").stem or "emoji") + f"-emoji-{size}.png"
    ascii_fallback = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_") or f"emoji-{size}.png"
    headers = {
        "Content-Disposition": (
            f'attachment; filename="{ascii_fallback}"; '
            f"filename*=UTF-8''{quote(name)}"
        )
    }
    return StreamingResponse(io.BytesIO(out), media_type="image/png", headers=headers)


@app.post("/image/ocr")
async def image_ocr(file: UploadFile = File(...), lang: str = Form("eng")):
    if TESSERACT_BIN is None:
        raise HTTPException(503, "Tesseract is not installed on the server.")
    if lang not in OCR_LANGS:
        raise HTTPException(400, f"lang must be one of {sorted(OCR_LANGS)}.")
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Only image files are accepted.")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file.")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image exceeds 25 MB limit.")
    try:
        text = await asyncio.to_thread(_ocr_blocking, data, lang)
    except Exception as e:
        log.exception("ocr failed")
        raise HTTPException(500, f"{e}")
    return {"text": text}


@app.post("/media/info")
async def media_info(req: MediaUrl):
    if not req.url.strip():
        raise HTTPException(400, "URL is required.")
    try:
        return await asyncio.to_thread(_media_info_blocking, req.url.strip())
    except yt_dlp.utils.DownloadError as e:
        raise HTTPException(400, f"Could not fetch info: {e}")
    except Exception as e:
        log.exception("media info failed")
        raise HTTPException(500, f"{e}")


@app.post("/media/download")
async def media_download(req: MediaDownload):
    if not req.url.strip():
        raise HTTPException(400, "URL is required.")
    if req.format not in {"video", "audio"}:
        raise HTTPException(400, "format must be 'video' or 'audio'.")

    job_dir = TMP_DIR / uuid.uuid4().hex
    job_dir.mkdir(parents=True, exist_ok=True)
    log.info("media download %s format=%s", req.url, req.format)

    try:
        out_path = await asyncio.to_thread(
            _media_download_blocking, req.url.strip(), req.format, job_dir
        )
    except yt_dlp.utils.DownloadError as e:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(400, f"Download failed: {e}")
    except Exception as e:
        shutil.rmtree(job_dir, ignore_errors=True)
        log.exception("media download failed")
        raise HTTPException(500, f"{e}")

    media = "audio/mpeg" if req.format == "audio" else "video/mp4"
    return FileResponse(
        path=out_path,
        media_type=media,
        filename=out_path.name,
        background=BackgroundTask(lambda: shutil.rmtree(job_dir, ignore_errors=True)),
    )


# ── PDF tools (merge / split / rotate) ───────────────
def _pdf_merge_blocking(pdf_blobs: list[bytes]) -> bytes:
    out = fitz.open()
    try:
        for blob in pdf_blobs:
            with fitz.open(stream=blob, filetype="pdf") as src:
                out.insert_pdf(src)
        return out.tobytes()
    finally:
        out.close()


def _parse_ranges(spec: str, n_pages: int) -> list[tuple[int, int]]:
    """Parse '1-3,5,7-10' into [(0,2),(4,4),(6,9)] (0-indexed inclusive)."""
    out: list[tuple[int, int]] = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            start, end = int(a) - 1, int(b) - 1
        else:
            start = end = int(part) - 1
        if start < 0 or end >= n_pages or start > end:
            raise ValueError(f"Invalid range: {part}")
        out.append((start, end))
    if not out:
        raise ValueError("No ranges provided.")
    return out


def _pdf_split_blocking(pdf_blob: bytes, ranges_spec: str) -> bytes:
    with fitz.open(stream=pdf_blob, filetype="pdf") as src:
        ranges = _parse_ranges(ranges_spec, src.page_count)
        zbuf = io.BytesIO()
        with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as zf:
            for i, (start, end) in enumerate(ranges, 1):
                sub = fitz.open()
                try:
                    sub.insert_pdf(src, from_page=start, to_page=end)
                    zf.writestr(f"pages_{start+1}-{end+1}.pdf", sub.tobytes())
                finally:
                    sub.close()
        return zbuf.getvalue()


def _pdf_rotate_blocking(pdf_blob: bytes, degrees: int) -> bytes:
    with fitz.open(stream=pdf_blob, filetype="pdf") as src:
        for page in src:
            page.set_rotation((page.rotation + degrees) % 360)
        return src.tobytes()


@app.post("/pdf/merge")
async def pdf_merge(files: List[UploadFile] = File(...)):
    if len(files) < 2:
        raise HTTPException(400, "Send at least 2 PDFs.")
    blobs: list[bytes] = []
    for f in files:
        if not (f.filename or "").lower().endswith(".pdf"):
            raise HTTPException(400, f"Not a PDF: {f.filename}")
        data = await f.read()
        if not data:
            raise HTTPException(400, f"Empty file: {f.filename}")
        if len(data) > MAX_BYTES:
            raise HTTPException(413, f"{f.filename} exceeds 50 MB.")
        blobs.append(data)
    try:
        out = await asyncio.to_thread(_pdf_merge_blocking, blobs)
    except Exception as e:
        log.exception("pdf merge failed")
        raise HTTPException(500, f"{e}")
    return StreamingResponse(
        io.BytesIO(out),
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="merged.pdf"'},
    )


@app.post("/pdf/split")
async def pdf_split(file: UploadFile = File(...), ranges: str = Form(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDFs accepted.")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file.")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File exceeds 50 MB.")
    try:
        out = await asyncio.to_thread(_pdf_split_blocking, data, ranges)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.exception("pdf split failed")
        raise HTTPException(500, f"{e}")
    return StreamingResponse(
        io.BytesIO(out),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="split.zip"'},
    )


@app.post("/pdf/rotate")
async def pdf_rotate(file: UploadFile = File(...), degrees: int = Form(90)):
    if degrees not in {90, 180, 270}:
        raise HTTPException(400, "degrees must be 90, 180, or 270.")
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDFs accepted.")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file.")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File exceeds 50 MB.")
    try:
        out = await asyncio.to_thread(_pdf_rotate_blocking, data, degrees)
    except Exception as e:
        log.exception("pdf rotate failed")
        raise HTTPException(500, f"{e}")
    return StreamingResponse(
        io.BytesIO(out),
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="rotated.pdf"'},
    )


# ── Image tools (compress / resize / convert) ────────
_IMAGE_FMT_ALIASES = {"jpg": "JPEG", "jpeg": "JPEG", "png": "PNG", "webp": "WEBP", "gif": "GIF", "bmp": "BMP"}


def _open_image(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img.load()
    return img


def _image_compress_blocking(data: bytes, quality: int) -> bytes:
    img = _open_image(data)
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=int(quality), optimize=True, progressive=True)
    return buf.getvalue()


def _image_resize_blocking(data: bytes, width: Optional[int], height: Optional[int]) -> bytes:
    img = _open_image(data)
    w, h = img.size
    if width and not height:
        height = int(h * (width / w))
    elif height and not width:
        width = int(w * (height / h))
    elif not width and not height:
        raise ValueError("Provide width and/or height.")
    target = (max(1, int(width)), max(1, int(height)))
    img = img.resize(target, Image.LANCZOS)
    buf = io.BytesIO()
    fmt = (img.format or "PNG").upper()
    if fmt not in {"PNG", "JPEG", "WEBP"}:
        fmt = "PNG"
    if fmt == "JPEG" and img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
    img.save(buf, format=fmt, optimize=True)
    return buf.getvalue(), fmt.lower()


def _image_convert_blocking(data: bytes, target_fmt: str) -> bytes:
    pil_fmt = _IMAGE_FMT_ALIASES.get(target_fmt.lower())
    if not pil_fmt:
        raise ValueError(f"Unsupported format: {target_fmt}")
    img = _open_image(data)
    if pil_fmt in {"JPEG", "BMP"} and img.mode in ("RGBA", "P", "LA"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    save_kwargs = {"optimize": True} if pil_fmt in {"JPEG", "PNG"} else {}
    if pil_fmt == "JPEG":
        save_kwargs["quality"] = 92
    img.save(buf, format=pil_fmt, **save_kwargs)
    return buf.getvalue()


@app.post("/image/compress")
async def image_compress(file: UploadFile = File(...), quality: int = Form(75)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Only image files are accepted.")
    if not (1 <= quality <= 100):
        raise HTTPException(400, "quality must be 1–100.")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file.")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image exceeds 25 MB.")
    try:
        out = await asyncio.to_thread(_image_compress_blocking, data, quality)
    except Exception as e:
        log.exception("compress failed")
        raise HTTPException(500, f"{e}")
    name = (Path(file.filename or "image").stem or "image") + ".jpg"
    return StreamingResponse(
        io.BytesIO(out),
        media_type="image/jpeg",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@app.post("/image/resize")
async def image_resize(
    file: UploadFile = File(...),
    width: Optional[int] = Form(None),
    height: Optional[int] = Form(None),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Only image files are accepted.")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file.")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image exceeds 25 MB.")
    try:
        out, fmt = await asyncio.to_thread(_image_resize_blocking, data, width, height)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.exception("resize failed")
        raise HTTPException(500, f"{e}")
    ext = "jpg" if fmt == "jpeg" else fmt
    name = (Path(file.filename or "image").stem or "image") + f"-resized.{ext}"
    return StreamingResponse(
        io.BytesIO(out),
        media_type=f"image/{fmt}",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@app.post("/image/convert")
async def image_convert(file: UploadFile = File(...), target: str = Form(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Only image files are accepted.")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file.")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image exceeds 25 MB.")
    try:
        out = await asyncio.to_thread(_image_convert_blocking, data, target)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.exception("convert failed")
        raise HTTPException(500, f"{e}")
    ext = "jpg" if target.lower() in ("jpg", "jpeg") else target.lower()
    name = (Path(file.filename or "image").stem or "image") + f".{ext}"
    return StreamingResponse(
        io.BytesIO(out),
        media_type=f"image/{ext}",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


# ── Video → GIF (ffmpeg) ─────────────────────────────
def _video_to_gif_blocking(data: bytes, start: float, duration: float, width: int) -> bytes:
    # ffmpeg via subprocess; uses palette generation for smaller/cleaner GIFs.
    job = TMP_DIR / uuid.uuid4().hex
    job.mkdir(parents=True, exist_ok=True)
    try:
        in_path = job / "in.bin"
        in_path.write_bytes(data)
        palette = job / "pal.png"
        out_path = job / "out.gif"
        ffmpeg = "ffmpeg"
        if FFMPEG_DIR:
            ffmpeg = str(Path(FFMPEG_DIR) / ("ffmpeg.exe" if IS_WINDOWS else "ffmpeg"))
        common = [ffmpeg, "-y", "-ss", str(start), "-t", str(duration), "-i", str(in_path)]
        # Pass 1: palette
        subprocess.run(
            common + ["-vf", f"fps=12,scale={width}:-1:flags=lanczos,palettegen", str(palette)],
            check=True, capture_output=True, timeout=120,
            creationflags=CREATE_NO_WINDOW,
        )
        # Pass 2: gif
        subprocess.run(
            common + ["-i", str(palette), "-lavfi",
                      f"fps=12,scale={width}:-1:flags=lanczos [x]; [x][1:v] paletteuse", str(out_path)],
            check=True, capture_output=True, timeout=120,
            creationflags=CREATE_NO_WINDOW,
        )
        return out_path.read_bytes()
    finally:
        shutil.rmtree(job, ignore_errors=True)


@app.post("/media/gif")
async def media_gif(
    file: UploadFile = File(...),
    start: float = Form(0.0),
    duration: float = Form(5.0),
    width: int = Form(480),
):
    if not file.content_type or not (
        file.content_type.startswith("video/") or file.content_type.startswith("image/")
    ):
        raise HTTPException(400, "Only video files are accepted.")
    if duration <= 0 or duration > 30:
        raise HTTPException(400, "duration must be 0–30 seconds.")
    if width < 64 or width > 1280:
        raise HTTPException(400, "width must be 64–1280 px.")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file.")
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(413, "Video exceeds 50 MB.")
    try:
        out = await asyncio.to_thread(_video_to_gif_blocking, data, start, duration, width)
    except subprocess.CalledProcessError as e:
        raise HTTPException(400, f"ffmpeg failed: {(e.stderr or b'').decode(errors='ignore')[:300]}")
    except Exception as e:
        log.exception("gif failed")
        raise HTTPException(500, f"{e}")
    name = (Path(file.filename or "clip").stem or "clip") + ".gif"
    return StreamingResponse(
        io.BytesIO(out),
        media_type="image/gif",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


# ── Markdown → PDF (LibreOffice) ─────────────────────
class MarkdownReq(BaseModel):
    text: str
    title: str = "Document"


def _md_to_pdf_blocking(md_text: str, title: str) -> bytes:
    import markdown as md_mod
    body_html = md_mod.markdown(md_text, extensions=["extra", "fenced_code", "tables"])
    full_html = f"""<!doctype html>
<html><head><meta charset='utf-8'><title>{title}</title>
<style>
body {{ font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.55; padding: 24px; max-width: 720px; }}
pre, code {{ font-family: monospace; background: #f4f4f4; padding: 2px 4px; border-radius: 3px; }}
pre {{ padding: 8px; overflow-x: auto; }}
table {{ border-collapse: collapse; margin: 1em 0; }}
th, td {{ border: 1px solid #999; padding: 4px 8px; }}
h1, h2, h3 {{ color: #1a365d; }}
blockquote {{ border-left: 3px solid #888; margin: 0; padding-left: 12px; color: #555; }}
</style></head>
<body>{body_html}</body></html>"""
    job = TMP_DIR / uuid.uuid4().hex
    job.mkdir(parents=True, exist_ok=True)
    try:
        html_path = job / "doc.html"
        html_path.write_text(full_html, encoding="utf-8")
        profile = job / "lo_profile"
        profile.mkdir()
        profile_url = profile.absolute().as_uri()
        cmd = [
            SOFFICE,
            f"-env:UserInstallation={profile_url}",
            "--headless", "--norestore", "--nofirststartwizard", "--nologo",
            "--convert-to", "pdf", "--outdir", str(job), str(html_path),
        ]
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=180,
            creationflags=CREATE_NO_WINDOW, env=_soffice_env(),
        )
        if result.returncode != 0:
            raise RuntimeError((result.stderr or result.stdout or "").strip()[:500])
        out_path = job / "doc.pdf"
        if not out_path.exists():
            raise RuntimeError("LibreOffice produced no PDF.")
        return out_path.read_bytes()
    finally:
        shutil.rmtree(job, ignore_errors=True)


@app.post("/doc/md2pdf")
async def doc_md2pdf(req: MarkdownReq):
    if not req.text.strip():
        raise HTTPException(400, "text is required.")
    if len(req.text) > 200_000:
        raise HTTPException(400, "Markdown too long (max 200k chars).")
    try:
        out = await asyncio.to_thread(_md_to_pdf_blocking, req.text, req.title or "Document")
    except Exception as e:
        log.exception("md2pdf failed")
        raise HTTPException(500, f"{e}")
    safe_title = re.sub(r"[^A-Za-z0-9._-]+", "_", req.title or "document").strip("_") or "document"
    return StreamingResponse(
        io.BytesIO(out),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.pdf"'},
    )


# ── PDF endpoint (unchanged) ─────────────────────────
@app.post("/convert")
async def convert(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only .pdf files are accepted.")

    data = await file.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds 50 MB limit.")

    job_dir = TMP_DIR / uuid.uuid4().hex
    job_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = job_dir / "input.pdf"
    final_docx = job_dir / "output.docx"
    loop = asyncio.get_running_loop()
    job_started = time.monotonic()

    try:
        pdf_path.write_bytes(data)

        try:
            n_pages = await asyncio.to_thread(_page_count, pdf_path)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Could not read PDF: {exc}")

        num_chunks = max(1, min(NUM_WORKERS, n_pages // MIN_PAGES_PER_CHUNK))
        log.info(
            "job=%s pages=%d size=%.2fMB chunks=%d filename=%r",
            job_dir.name, n_pages, len(data) / (1024 * 1024), num_chunks, file.filename,
        )

        try:
            if num_chunks == 1:
                profile = job_dir / "lo_profile_0"
                await loop.run_in_executor(
                    EXECUTOR, _convert_one, pdf_path, job_dir, profile
                )
                produced = job_dir / "input.docx"
                shutil.move(str(produced), str(final_docx))
            else:
                chunk_pdfs = await asyncio.to_thread(
                    _split_pdf, pdf_path, job_dir, num_chunks
                )
                tasks = []
                for i, cp in enumerate(chunk_pdfs):
                    profile = job_dir / f"lo_profile_{i}"
                    tasks.append(
                        loop.run_in_executor(EXECUTOR, _convert_one, cp, job_dir, profile)
                    )
                produced = await asyncio.gather(*tasks)
                await asyncio.to_thread(_merge_docx, list(produced), final_docx)
        except subprocess.TimeoutExpired:
            raise HTTPException(
                status_code=504,
                detail=f"LibreOffice did not finish a chunk in {CHUNK_TIMEOUT_SEC}s.",
            )
        except HTTPException:
            raise
        except Exception as exc:
            log.exception("conversion failed")
            raise HTTPException(status_code=500, detail=f"Conversion failed: {exc}")

        if not final_docx.exists():
            raise HTTPException(status_code=500, detail="Conversion produced no output.")

        log.info(
            "job=%s done in %.1fs total",
            job_dir.name, time.monotonic() - job_started,
        )
        buffer = io.BytesIO(final_docx.read_bytes())
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)

    out_name = Path(file.filename).stem + ".docx"
    ascii_fallback = re.sub(r"[^A-Za-z0-9._-]+", "_", out_name).strip("_") or "converted.docx"
    headers = {
        "Content-Disposition": (
            f'attachment; filename="{ascii_fallback}"; '
            f"filename*=UTF-8''{quote(out_name)}"
        )
    }
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers=headers,
    )


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8001"))
    uvicorn.run(app, host=host, port=port, log_config=None)
