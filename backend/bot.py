import io
import logging
import os
import re

import httpx
from telegram import Update
from telegram.ext import (
    ApplicationBuilder, CommandHandler, ContextTypes,
    MessageHandler, filters,
)

log = logging.getLogger("bot")

OWNER_CHAT_ID = int(os.environ.get("TELEGRAM_OWNER_CHAT_ID", "0") or "0")
LOCAL_API = f"http://127.0.0.1:{int(os.environ.get('PORT', '8001'))}"

TELEGRAM_INBOUND_LIMIT = 20 * 1024 * 1024
TELEGRAM_OUTBOUND_LIMIT = 50 * 1024 * 1024


def _allowed(update: Update) -> bool:
    if not OWNER_CHAT_ID:
        return True
    return bool(update.effective_chat and update.effective_chat.id == OWNER_CHAT_ID)


async def _deny(update: Update):
    await update.effective_message.reply_text("Sorry, this bot is private.")


async def cmd_start(update: Update, _ctx: ContextTypes.DEFAULT_TYPE):
    if not _allowed(update):
        return await _deny(update)
    await update.effective_message.reply_text(
        "Hi! I'm Digitools.\n\n"
        "• Send a PDF — I convert it to DOCX\n"
        "• Send a photo — I extract text (OCR, eng+khm)\n"
        "• /qr <text> — QR code\n"
        "• /vid <url> — download video (MP4)\n"
        "• /aud <url> — download audio (MP3)"
    )


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


async def on_photo(update: Update, _ctx: ContextTypes.DEFAULT_TYPE):
    if not _allowed(update):
        return await _deny(update)
    photo = update.effective_message.photo[-1]
    if photo.file_size and photo.file_size > TELEGRAM_INBOUND_LIMIT:
        return await update.effective_message.reply_text("Image too large for the bot API (>20 MB).")
    msg = await update.effective_message.reply_text("Reading text…")
    try:
        f = await photo.get_file()
        img_bytes = bytes(await f.download_as_bytearray())
        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(
                f"{LOCAL_API}/image/ocr",
                files={"file": ("photo.jpg", img_bytes, "image/jpeg")},
                data={"lang": "eng+khm"},
            )
        if r.status_code != 200:
            detail = r.json().get("detail", r.text) if r.headers.get("content-type", "").startswith("application/json") else r.text
            return await msg.edit_text(f"OCR failed ({r.status_code}): {detail[:300]}")
        text = (r.json().get("text") or "").strip() or "(no text found)"
        await msg.edit_text(text[:4000])
    except Exception as e:
        await msg.edit_text(f"OCR failed: {e}")


async def on_document(update: Update, _ctx: ContextTypes.DEFAULT_TYPE):
    if not _allowed(update):
        return await _deny(update)
    doc = update.effective_message.document
    if not doc:
        return
    name = doc.file_name or ""
    if not name.lower().endswith(".pdf"):
        return await update.effective_message.reply_text("Please send a PDF document.")
    if doc.file_size and doc.file_size > TELEGRAM_INBOUND_LIMIT:
        return await update.effective_message.reply_text("PDF too large (>20 MB via bot API).")
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
            return await msg.edit_text(f"Download failed ({r.status_code}).")
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


def build_app(token: str):
    app = ApplicationBuilder().token(token).build()
    app.add_handler(CommandHandler(["start", "help"], cmd_start))
    app.add_handler(CommandHandler("qr", cmd_qr))
    app.add_handler(CommandHandler("vid", cmd_vid))
    app.add_handler(CommandHandler("aud", cmd_aud))
    app.add_handler(MessageHandler(filters.PHOTO, on_photo))
    app.add_handler(MessageHandler(filters.Document.ALL, on_document))
    return app
