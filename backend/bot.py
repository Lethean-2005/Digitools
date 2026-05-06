import io
import logging
import os
import re
import time

import httpx
from telegram import BotCommand, Update
from telegram.ext import (
    Application, ApplicationBuilder, CommandHandler, ContextTypes,
    MessageHandler, filters,
)

log = logging.getLogger("bot")

OWNER_CHAT_ID = int(os.environ.get("TELEGRAM_OWNER_CHAT_ID", "0") or "0")
LOCAL_API = f"http://127.0.0.1:{int(os.environ.get('PORT', '8001'))}"

TELEGRAM_INBOUND_LIMIT = 20 * 1024 * 1024
TELEGRAM_OUTBOUND_LIMIT = 50 * 1024 * 1024

# Per-chat "what to do with the next image" memory (5 min TTL).
# Set when user runs /rmbg, /emoji, /ocr without attaching an image.
PENDING: dict[int, tuple[str, float]] = {}
PENDING_TTL = 5 * 60


def _set_pending(chat_id: int, action: str) -> None:
    PENDING[chat_id] = (action, time.monotonic())


def _take_pending(chat_id: int) -> str | None:
    entry = PENDING.pop(chat_id, None)
    if not entry:
        return None
    action, ts = entry
    if time.monotonic() - ts > PENDING_TTL:
        return None
    return action


def _allowed(update: Update) -> bool:
    if not OWNER_CHAT_ID:
        return True
    return bool(update.effective_chat and update.effective_chat.id == OWNER_CHAT_ID)


async def _deny(update: Update):
    await update.effective_message.reply_text("Sorry, this bot is private.")


HELP_TEXT = (
    "Hi! I'm Digitools.\n\n"
    "Image tools — send command with image attached, or run command first then send image:\n"
    "• /ocr — extract text\n"
    "• /rmbg — remove background\n"
    "• /emoji — make emoji\n"
    "• /compress [quality] — JPEG compress (default 75)\n"
    "• /resize WxH — resize (e.g. /resize 800x600 or /resize 800)\n"
    "• /convert <fmt> — to png|jpg|webp|gif|bmp\n\n"
    "PDF tools (send command with PDF attached):\n"
    "• /pdf — convert to DOCX\n"
    "• /rotate <90|180|270> — rotate pages\n\n"
    "Other:\n"
    "• /qr <text>\n"
    "• /vid <url> | /aud <url>\n"
    "• /gif — attach video to make a 5s GIF\n"
    "• /md2pdf <markdown> — render markdown to PDF"
)


async def cmd_start(update: Update, _ctx: ContextTypes.DEFAULT_TYPE):
    if not _allowed(update):
        return await _deny(update)
    await update.effective_message.reply_text(HELP_TEXT)


async def cmd_qr(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not _allowed(update):
        return await _deny(update)
    text = " ".join(ctx.args).strip() if ctx.args else ""
    if not text:
        return await update.effective_message.reply_text("Usage: /qr <text or URL>")
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(f"{LOCAL_API}/qr", json={"text": text})
        r.raise_for_status()
    except Exception as e:
        return await update.effective_message.reply_text(f"QR failed: {e}")
    await update.effective_message.reply_photo(io.BytesIO(r.content), caption=text[:200])


async def _safe_edit(msg, text: str):
    try:
        await msg.edit_text(text)
    except Exception:
        try:
            await msg.chat.send_message(text)
        except Exception:
            log.exception("could not deliver message")


async def _process_image(update: Update, img_bytes: bytes, action: str, msg):
    """action: 'ocr' | 'rmbg' | 'emoji'"""
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            if action == "ocr":
                r = await client.post(
                    f"{LOCAL_API}/image/ocr",
                    files={"file": ("photo.jpg", img_bytes, "image/jpeg")},
                    data={"lang": "eng+khm"},
                )
            elif action == "rmbg":
                r = await client.post(
                    f"{LOCAL_API}/image/remove-bg",
                    files={"file": ("photo.jpg", img_bytes, "image/jpeg")},
                )
            elif action == "emoji":
                r = await client.post(
                    f"{LOCAL_API}/image/emoji",
                    files={"file": ("photo.jpg", img_bytes, "image/jpeg")},
                    data={"size": "256"},
                )
            else:
                return await _safe_edit(msg, f"Unknown action: {action}")
        if r.status_code != 200:
            ct = r.headers.get("content-type", "")
            detail = r.json().get("detail", r.text) if ct.startswith("application/json") else r.text
            return await _safe_edit(msg, f"{action} failed ({r.status_code}): {str(detail)[:300]}")
        if action == "ocr":
            text = (r.json().get("text") or "").strip() or "(no text found)"
            await _safe_edit(msg, text[:4000])
        else:
            try:
                await msg.delete()
            except Exception:
                pass
            # PNG (transparent for rmbg/emoji) — send as document so Telegram
            # doesn't strip the alpha channel via JPEG re-compression.
            fname = "no-bg.png" if action == "rmbg" else "emoji.png"
            await update.effective_message.reply_document(io.BytesIO(r.content), filename=fname)
    except Exception as e:
        await _safe_edit(msg, f"{action} failed: {e}")


async def _handle_incoming_image(update: Update, img_bytes: bytes, default_action: str = "ocr"):
    chat_id = update.effective_chat.id if update.effective_chat else 0
    # Caption can carry the command, e.g. "/rmbg" or "/emoji"
    caption = (update.effective_message.caption or "").strip().lower()
    cap_cmd = None
    for cmd in ("/ocr", "/rmbg", "/emoji"):
        if caption.startswith(cmd):
            cap_cmd = cmd[1:]
            break
    action = cap_cmd or _take_pending(chat_id) or default_action
    label = {"ocr": "Reading text…", "rmbg": "Removing background…", "emoji": "Making emoji…"}[action]
    msg = await update.effective_message.reply_text(label)
    await _process_image(update, img_bytes, action, msg)


async def on_photo(update: Update, _ctx: ContextTypes.DEFAULT_TYPE):
    if not _allowed(update):
        return await _deny(update)
    photo = update.effective_message.photo[-1]
    if photo.file_size and photo.file_size > TELEGRAM_INBOUND_LIMIT:
        return await update.effective_message.reply_text("Image too large for the bot API (>20 MB).")
    try:
        f = await photo.get_file()
        img_bytes = bytes(await f.download_as_bytearray())
        await _handle_incoming_image(update, img_bytes)
    except Exception as e:
        await update.effective_message.reply_text(f"Failed: {e}")


async def on_document(update: Update, _ctx: ContextTypes.DEFAULT_TYPE):
    if not _allowed(update):
        return await _deny(update)
    doc = update.effective_message.document
    if not doc:
        return
    name = doc.file_name or ""
    mime = (doc.mime_type or "").lower()
    is_image = mime.startswith("image/") or name.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"))
    is_pdf = mime == "application/pdf" or name.lower().endswith(".pdf")

    if not (is_image or is_pdf):
        return await update.effective_message.reply_text("Send a PDF or an image.")
    if doc.file_size and doc.file_size > TELEGRAM_INBOUND_LIMIT:
        return await update.effective_message.reply_text("File too large (>20 MB via bot API).")

    if is_image:
        try:
            f = await doc.get_file()
            img_bytes = bytes(await f.download_as_bytearray())
            await _handle_incoming_image(update, img_bytes)
        except Exception as e:
            await update.effective_message.reply_text(f"Failed: {e}")
        return

    # PDF → DOCX
    msg = await update.effective_message.reply_text("Converting…")
    try:
        f = await doc.get_file()
        pdf_bytes = bytes(await f.download_as_bytearray())
        async with httpx.AsyncClient(timeout=900) as client:
            r = await client.post(
                f"{LOCAL_API}/convert",
                files={"file": (name, pdf_bytes, "application/pdf")},
            )
        if r.status_code != 200:
            return await msg.edit_text(f"Conversion failed ({r.status_code}).")
        out_name = re.sub(r"\.pdf$", ".docx", name, flags=re.I) or "out.docx"
        if len(r.content) > TELEGRAM_OUTBOUND_LIMIT:
            return await msg.edit_text("Result is >50 MB; Telegram bots can't send that.")
        await msg.delete()
        await update.effective_message.reply_document(io.BytesIO(r.content), filename=out_name)
    except Exception as e:
        await msg.edit_text(f"Conversion failed: {e}")


async def _media(update: Update, ctx: ContextTypes.DEFAULT_TYPE, fmt: str):
    if not _allowed(update):
        return await _deny(update)
    url = " ".join(ctx.args).strip() if ctx.args else ""
    if not url:
        cmd = "vid" if fmt == "video" else "aud"
        return await update.effective_message.reply_text(f"Usage: /{cmd} <url>")
    msg = await update.effective_message.reply_text(f"Downloading {fmt}…")
    try:
        async with httpx.AsyncClient(timeout=900) as client:
            r = await client.post(
                f"{LOCAL_API}/media/download",
                json={"url": url, "format": fmt},
            )
        if r.status_code != 200:
            ct = r.headers.get("content-type", "")
            try:
                detail = r.json().get("detail", r.text) if ct.startswith("application/json") else r.text
            except Exception:
                detail = r.text
            return await _safe_edit(msg, f"Download failed ({r.status_code}): {str(detail)[:500]}")
        if len(r.content) > TELEGRAM_OUTBOUND_LIMIT:
            return await msg.edit_text("Output is >50 MB; Telegram bots can't send that. Try a shorter clip.")
        cd = r.headers.get("content-disposition", "")
        m = re.search(r'filename="([^"]+)"', cd)
        name = m.group(1) if m else ("media.mp4" if fmt == "video" else "media.mp3")
        await msg.delete()
        if fmt == "audio":
            await update.effective_message.reply_audio(io.BytesIO(r.content), filename=name)
        else:
            await update.effective_message.reply_video(io.BytesIO(r.content), filename=name)
    except Exception as e:
        await msg.edit_text(f"Download failed: {e}")


async def cmd_vid(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    return await _media(update, ctx, "video")


async def cmd_aud(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    return await _media(update, ctx, "audio")


async def _image_command(update: Update, action: str, ask_text: str):
    if not _allowed(update):
        return await _deny(update)
    msg = update.effective_message

    # 1) Command sent as caption on a photo / document
    if msg.photo or (msg.document and (msg.document.mime_type or "").startswith("image/")):
        try:
            if msg.photo:
                f = await msg.photo[-1].get_file()
            else:
                f = await msg.document.get_file()
            img_bytes = bytes(await f.download_as_bytearray())
            label = {"ocr": "Reading text…", "rmbg": "Removing background…", "emoji": "Making emoji…"}[action]
            reply = await msg.reply_text(label)
            return await _process_image(update, img_bytes, action, reply)
        except Exception as e:
            return await msg.reply_text(f"{action} failed: {e}")

    # 2) Command in reply to an image message
    rep = msg.reply_to_message
    if rep and (rep.photo or (rep.document and (rep.document.mime_type or "").startswith("image/"))):
        try:
            if rep.photo:
                f = await rep.photo[-1].get_file()
            else:
                f = await rep.document.get_file()
            img_bytes = bytes(await f.download_as_bytearray())
            label = {"ocr": "Reading text…", "rmbg": "Removing background…", "emoji": "Making emoji…"}[action]
            reply = await msg.reply_text(label)
            return await _process_image(update, img_bytes, action, reply)
        except Exception as e:
            return await msg.reply_text(f"{action} failed: {e}")

    # 3) Bare command — remember and wait for the next image
    _set_pending(update.effective_chat.id, action)
    await msg.reply_text(ask_text)


async def cmd_ocr(update: Update, _ctx: ContextTypes.DEFAULT_TYPE):
    await _image_command(update, "ocr", "Send me an image (within 5 min) and I'll extract the text.")


async def cmd_rmbg(update: Update, _ctx: ContextTypes.DEFAULT_TYPE):
    await _image_command(update, "rmbg", "Send me an image (within 5 min) and I'll remove the background.")


async def cmd_emoji(update: Update, _ctx: ContextTypes.DEFAULT_TYPE):
    await _image_command(update, "emoji", "Send me an image (within 5 min) and I'll turn it into an emoji.")


async def cmd_pdf(update: Update, _ctx: ContextTypes.DEFAULT_TYPE):
    if not _allowed(update):
        return await _deny(update)
    await update.effective_message.reply_text("Just send me a PDF as a document — I'll convert it to DOCX.")


async def cmd_md2pdf(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not _allowed(update):
        return await _deny(update)
    text = update.effective_message.text or ""
    # strip the leading "/md2pdf" command, leaving the markdown body
    md = re.sub(r"^/md2pdf(@\S+)?\s*", "", text, count=1).strip()
    if not md:
        return await update.effective_message.reply_text(
            "Usage: /md2pdf followed by markdown.\nExample:\n/md2pdf # Hello\nThis is **bold**."
        )
    msg = await update.effective_message.reply_text("Rendering PDF…")
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(f"{LOCAL_API}/doc/md2pdf",
                                  json={"text": md, "title": "Document"})
        if r.status_code != 200:
            return await _safe_edit(msg, f"md2pdf failed ({r.status_code}).")
        try:
            await msg.delete()
        except Exception:
            pass
        await update.effective_message.reply_document(io.BytesIO(r.content), filename="document.pdf")
    except Exception as e:
        await _safe_edit(msg, f"md2pdf failed: {e}")


# ── Image edit commands (caption mode) ─────────────────
async def _attached_image_bytes(msg) -> tuple[bytes, str] | None:
    """Returns (bytes, original_name) for an attached photo or image-document."""
    if msg.photo:
        f = await msg.photo[-1].get_file()
        return bytes(await f.download_as_bytearray()), "photo.jpg"
    if msg.document:
        mime = (msg.document.mime_type or "").lower()
        nm = msg.document.file_name or ""
        if mime.startswith("image/") or nm.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp")):
            f = await msg.document.get_file()
            return bytes(await f.download_as_bytearray()), nm or "image"
    return None


async def _attached_pdf_bytes(msg) -> tuple[bytes, str] | None:
    if msg.document:
        nm = msg.document.file_name or ""
        if (msg.document.mime_type or "").lower() == "application/pdf" or nm.lower().endswith(".pdf"):
            f = await msg.document.get_file()
            return bytes(await f.download_as_bytearray()), nm or "input.pdf"
    return None


async def _attached_video_bytes(msg) -> bytes | None:
    if msg.video:
        f = await msg.video.get_file()
        return bytes(await f.download_as_bytearray())
    if msg.video_note:
        f = await msg.video_note.get_file()
        return bytes(await f.download_as_bytearray())
    if msg.document and (msg.document.mime_type or "").startswith("video/"):
        f = await msg.document.get_file()
        return bytes(await f.download_as_bytearray())
    return None


async def cmd_compress(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not _allowed(update):
        return await _deny(update)
    quality = 75
    if ctx.args:
        try:
            quality = max(1, min(100, int(ctx.args[0])))
        except ValueError:
            return await update.effective_message.reply_text("quality must be 1–100.")
    pair = await _attached_image_bytes(update.effective_message)
    if not pair:
        return await update.effective_message.reply_text("Attach an image. Usage: /compress [quality]")
    img_bytes, _ = pair
    msg = await update.effective_message.reply_text(f"Compressing (quality {quality})…")
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(f"{LOCAL_API}/image/compress",
                                  files={"file": ("img.bin", img_bytes, "image/jpeg")},
                                  data={"quality": str(quality)})
        if r.status_code != 200:
            return await _safe_edit(msg, f"Compress failed ({r.status_code}).")
        try: await msg.delete()
        except Exception: pass
        await update.effective_message.reply_document(io.BytesIO(r.content), filename="compressed.jpg")
    except Exception as e:
        await _safe_edit(msg, f"Compress failed: {e}")


async def cmd_resize(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not _allowed(update):
        return await _deny(update)
    if not ctx.args:
        return await update.effective_message.reply_text("Usage: /resize <width>[x<height>]  e.g. /resize 800  or /resize 800x600")
    spec = ctx.args[0].lower().replace("×", "x")
    width, height = None, None
    try:
        if "x" in spec:
            w, h = spec.split("x", 1)
            width = int(w) if w else None
            height = int(h) if h else None
        else:
            width = int(spec)
    except ValueError:
        return await update.effective_message.reply_text("Bad size. e.g. /resize 800  or /resize 800x600")
    pair = await _attached_image_bytes(update.effective_message)
    if not pair:
        return await update.effective_message.reply_text("Attach an image with /resize.")
    img_bytes, _ = pair
    msg = await update.effective_message.reply_text("Resizing…")
    try:
        data = {}
        if width:  data["width"] = str(width)
        if height: data["height"] = str(height)
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(f"{LOCAL_API}/image/resize",
                                  files={"file": ("img.bin", img_bytes, "image/jpeg")},
                                  data=data)
        if r.status_code != 200:
            return await _safe_edit(msg, f"Resize failed ({r.status_code}).")
        try: await msg.delete()
        except Exception: pass
        ct = r.headers.get("content-type", "image/png")
        ext = ct.split("/")[-1].split(";")[0]
        await update.effective_message.reply_document(io.BytesIO(r.content), filename=f"resized.{ext}")
    except Exception as e:
        await _safe_edit(msg, f"Resize failed: {e}")


async def cmd_convert(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not _allowed(update):
        return await _deny(update)
    if not ctx.args:
        return await update.effective_message.reply_text("Usage: /convert <png|jpg|webp|gif|bmp>")
    fmt = ctx.args[0].lower()
    pair = await _attached_image_bytes(update.effective_message)
    if not pair:
        return await update.effective_message.reply_text("Attach an image with /convert.")
    img_bytes, _ = pair
    msg = await update.effective_message.reply_text(f"Converting → {fmt}…")
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(f"{LOCAL_API}/image/convert",
                                  files={"file": ("img.bin", img_bytes, "image/jpeg")},
                                  data={"target": fmt})
        if r.status_code != 200:
            return await _safe_edit(msg, f"Convert failed ({r.status_code}).")
        try: await msg.delete()
        except Exception: pass
        ext = "jpg" if fmt in ("jpg", "jpeg") else fmt
        await update.effective_message.reply_document(io.BytesIO(r.content), filename=f"image.{ext}")
    except Exception as e:
        await _safe_edit(msg, f"Convert failed: {e}")


async def cmd_rotate(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not _allowed(update):
        return await _deny(update)
    deg = 90
    if ctx.args:
        try:
            deg = int(ctx.args[0])
        except ValueError:
            return await update.effective_message.reply_text("Usage: /rotate <90|180|270>")
    if deg not in (90, 180, 270):
        return await update.effective_message.reply_text("degrees must be 90, 180, or 270.")
    pair = await _attached_pdf_bytes(update.effective_message)
    if not pair:
        return await update.effective_message.reply_text("Attach a PDF with /rotate.")
    pdf_bytes, name = pair
    msg = await update.effective_message.reply_text(f"Rotating {deg}°…")
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(f"{LOCAL_API}/pdf/rotate",
                                  files={"file": (name, pdf_bytes, "application/pdf")},
                                  data={"degrees": str(deg)})
        if r.status_code != 200:
            return await _safe_edit(msg, f"Rotate failed ({r.status_code}).")
        try: await msg.delete()
        except Exception: pass
        out_name = re.sub(r"\.pdf$", f"-rot{deg}.pdf", name, flags=re.I) or "rotated.pdf"
        await update.effective_message.reply_document(io.BytesIO(r.content), filename=out_name)
    except Exception as e:
        await _safe_edit(msg, f"Rotate failed: {e}")


async def cmd_gif(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not _allowed(update):
        return await _deny(update)
    duration = 5.0
    start = 0.0
    if ctx.args:
        try:
            duration = float(ctx.args[0])
            if len(ctx.args) >= 2:
                start = float(ctx.args[1])
        except ValueError:
            pass
    video_bytes = await _attached_video_bytes(update.effective_message)
    if not video_bytes:
        return await update.effective_message.reply_text("Attach a video with /gif. Usage: /gif [duration_sec] [start_sec]")
    msg = await update.effective_message.reply_text(f"Making GIF ({duration}s)…")
    try:
        async with httpx.AsyncClient(timeout=300) as client:
            r = await client.post(f"{LOCAL_API}/media/gif",
                                  files={"file": ("clip.mp4", video_bytes, "video/mp4")},
                                  data={"duration": str(duration), "start": str(start), "width": "480"})
        if r.status_code != 200:
            return await _safe_edit(msg, f"GIF failed ({r.status_code}).")
        try: await msg.delete()
        except Exception: pass
        await update.effective_message.reply_animation(io.BytesIO(r.content), filename="clip.gif")
    except Exception as e:
        await _safe_edit(msg, f"GIF failed: {e}")


_COMMANDS = [
    BotCommand("start",    "Show help"),
    BotCommand("help",     "Show help"),
    BotCommand("ocr",      "Extract text from image"),
    BotCommand("rmbg",     "Remove image background"),
    BotCommand("emoji",    "Make emoji from image"),
    BotCommand("compress", "Compress JPEG (/compress 75)"),
    BotCommand("resize",   "Resize image (/resize 800x600)"),
    BotCommand("convert",  "Convert image format (/convert webp)"),
    BotCommand("pdf",      "Convert PDF to DOCX"),
    BotCommand("rotate",   "Rotate PDF (/rotate 90)"),
    BotCommand("md2pdf",   "Markdown → PDF (/md2pdf body)"),
    BotCommand("gif",      "Video → GIF (attach video)"),
    BotCommand("qr",       "Generate QR (/qr text)"),
    BotCommand("vid",      "Download video (/vid url)"),
    BotCommand("aud",      "Download audio (/aud url)"),
]


async def register_commands(app: Application) -> None:
    try:
        await app.bot.set_my_commands(_COMMANDS)
    except Exception:
        log.exception("set_my_commands failed")


def build_app(token: str):
    app = ApplicationBuilder().token(token).build()
    app.add_handler(CommandHandler(["start", "help"], cmd_start))
    app.add_handler(CommandHandler("qr", cmd_qr))
    app.add_handler(CommandHandler("vid", cmd_vid))
    app.add_handler(CommandHandler("aud", cmd_aud))
    app.add_handler(CommandHandler("ocr", cmd_ocr))
    app.add_handler(CommandHandler("rmbg", cmd_rmbg))
    app.add_handler(CommandHandler("emoji", cmd_emoji))
    app.add_handler(CommandHandler("pdf", cmd_pdf))
    app.add_handler(CommandHandler("md2pdf", cmd_md2pdf))
    app.add_handler(CommandHandler("compress", cmd_compress))
    app.add_handler(CommandHandler("resize", cmd_resize))
    app.add_handler(CommandHandler("convert", cmd_convert))
    app.add_handler(CommandHandler("rotate", cmd_rotate))
    app.add_handler(CommandHandler("gif", cmd_gif))
    app.add_handler(MessageHandler(filters.PHOTO, on_photo))
    app.add_handler(MessageHandler(filters.Document.ALL, on_document))
    return app
