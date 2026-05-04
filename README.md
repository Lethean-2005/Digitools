# Digitools

All-in-one digital toolbox: convert PDFs to Word, download videos/audio from 1000+ sites, remove image backgrounds, and turn images into emojis.

## Stack

- **Frontend** — React 18 + Vite, Saira / Teko / Kantumruy Pro fonts.
- **Backend** — FastAPI on port 8001.
- **Engines**
  - PDF → Word: LibreOffice headless (`soffice --headless --infilter=writer_pdf_import --convert-to docx`), parallel chunked with `docxcompose` merging.
  - Media download: `yt-dlp` + FFmpeg.
  - Image background removal & emoji: `rembg` with the U2Net ONNX model.

## Run

```powershell
# Backend
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173/` (or whichever port Vite picked) — backend listens on `http://localhost:8001/`.

## Required system dependencies (Windows)

| Tool | Install |
|---|---|
| LibreOffice | `winget install TheDocumentFoundation.LibreOffice` |
| FFmpeg      | `winget install Gyan.FFmpeg.Essentials` |

The U2Net ONNX model (~170 MB) is downloaded automatically by `rembg` on first use to `~/.u2net/`.

## Endpoints

| Route | Purpose |
|---|---|
| `POST /convert` | PDF → DOCX |
| `POST /media/info` | Fetch media metadata (title, thumbnail, duration) |
| `POST /media/download` | Download as `video` (MP4) or `audio` (MP3) |
| `POST /image/remove-bg` | Returns a transparent-background PNG |
| `POST /image/emoji` | Returns a square emoji PNG (128 / 256 / 512) |
| `GET  /health` | Health + engine info |
