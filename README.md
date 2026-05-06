# Digitools

All-in-one digital toolbox: convert PDFs to Word, download videos/audio from 1000+ sites, remove image backgrounds, turn images into emojis, and generate QR codes.

## Stack

- **Frontend** — React 18 + Vite. Saira / Teko / Kantumruy Pro fonts.
- **Backend** — FastAPI on port 8001.
- **Engines**
  - PDF → Word: LibreOffice headless with parallel chunked conversion + `docxcompose` merge.
  - Media download: `yt-dlp` + FFmpeg.
  - Image background removal & emoji: `rembg` (U2Net).
  - QR generation: `qrcode[pil]`.
  - Image OCR: Tesseract via `pytesseract` (English + Khmer).

## Run locally

### Backend (Windows)

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
```

System dependencies (Windows):

```powershell
winget install TheDocumentFoundation.LibreOffice
winget install Gyan.FFmpeg.Essentials
winget install UB-Mannheim.TesseractOCR
```

### Backend (Linux)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
sudo apt-get install libreoffice-writer libreoffice-core ffmpeg \
                     tesseract-ocr tesseract-ocr-eng tesseract-ocr-khm \
                     fonts-noto fonts-noto-cjk fonts-khmeros
python main.py
```

### Frontend

```bash
cd frontend
cp .env.example .env.local   # adjust VITE_API_BASE if needed
npm install
npm run dev
```

The Vite dev server runs at `http://localhost:5173/` (or 5174 if 5173 is busy). Backend listens on `http://localhost:8001/`.

The U2Net ONNX model (~170 MB) downloads automatically on first image call to `~/.u2net/`.

## API

| Route | Purpose |
|---|---|
| `POST /convert` | PDF → DOCX |
| `POST /media/info` | Fetch media metadata |
| `POST /media/download` | Download as `video` (MP4) or `audio` (MP3) |
| `POST /image/remove-bg` | Returns transparent-background PNG |
| `POST /image/emoji` | Returns square emoji PNG (128 / 256 / 512) |
| `POST /image/ocr` | Extract text from an image (Tesseract — `eng`, `khm`, `eng+khm`) |
| `POST /qr` | Returns a QR-code PNG |
| `GET /health` | Engine status |

## Deploy

### Backend — Docker (any VPS, Render, Fly.io, Railway)

A `Dockerfile` is included. It bakes in LibreOffice + FFmpeg + the rembg model so the container is self-contained (image is ~2 GB).

```bash
# Local test
docker compose up --build

# Or vanilla docker
docker build -t digitools-api ./backend
docker run -p 8001:8001 digitools-api
```

For a VPS deploy: `git clone` the repo, then `docker compose up -d`. Put a reverse proxy (Caddy / Nginx / Traefik) in front for HTTPS.

Render / Fly.io: point them at `backend/Dockerfile`. Allocate **at least 1 GB RAM** (rembg + LibreOffice need it).

### Frontend — Vercel / Netlify / Cloudflare Pages

```bash
cd frontend
npm run build  # outputs dist/
```

Vercel:
1. Import the GitHub repo, set the **root directory** to `frontend`.
2. Vercel auto-detects Vite. The included `vercel.json` handles SPA fallback.
3. Add env var `VITE_API_BASE` = your backend URL (e.g. `https://api.digitools.example.com`).
4. Deploy.

Netlify / Cloudflare Pages: same idea — root = `frontend`, build command `npm run build`, publish directory `dist`, set `VITE_API_BASE`.

### CORS

The backend's CORS is currently hardcoded to allow any `localhost`/`127.0.0.1` origin. For production, edit `backend/main.py` (`allow_origin_regex`) to permit your frontend's deployed origin, e.g.:

```python
allow_origins=["https://digitools.example.com"],
```
