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
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote

IS_WINDOWS = platform.system() == "Windows"

import fitz  # PyMuPDF
import yt_dlp
from docx import Document
from docxcompose.composer import Composer
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from PIL import Image
from pydantic import BaseModel
from starlette.background import BackgroundTask

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("converter")

app = FastAPI(title="PDF / Media Converter")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):\d+$",
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
        opts = _ydl({
            "format": (
                "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/"
                "best[ext=mp4][height<=1080]/"
                "best[height<=1080]/best"
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
_REMBG_SESSION = None


def _get_rembg_session():
    global _REMBG_SESSION
    if _REMBG_SESSION is None:
        from rembg import new_session
        log.info("loading rembg u2net session…")
        _REMBG_SESSION = new_session("u2net")
    return _REMBG_SESSION


def _remove_bg_blocking(data: bytes) -> bytes:
    from rembg import remove
    return remove(data, session=_get_rembg_session())


def _emoji_blocking(data: bytes, size: int) -> bytes:
    from rembg import remove
    cut = remove(data, session=_get_rembg_session())
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


@app.get("/health")
def health():
    return {
        "status": "ok",
        "engines": {
            "pdf": "libreoffice-headless",
            "media": "yt-dlp",
            "image": "rembg-u2net",
            "qr": "qrcode",
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
        out = await asyncio.to_thread(_remove_bg_blocking, data)
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
        out = await asyncio.to_thread(_emoji_blocking, data, size)
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
