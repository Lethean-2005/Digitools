FROM python:3.12-slim-bookworm

# System dependencies:
# - LibreOffice (writer + core) for PDF -> DOCX
# - FFmpeg for yt-dlp post-processing (audio extraction, A/V merge)
# - Tesseract (+ eng/khm language data) for image OCR
# - Fonts (Noto, Liberation, CJK + Khmer) so Khmer / mixed-script PDFs render correctly
RUN apt-get update && apt-get install -y --no-install-recommends \
        libreoffice-writer \
        libreoffice-core \
        libreoffice-common \
        fonts-liberation \
        fonts-dejavu-core \
        fonts-noto \
        fonts-noto-cjk \
        fonts-khmeros \
        ffmpeg \
        tesseract-ocr \
        tesseract-ocr-eng \
        tesseract-ocr-khm \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps first so layer caching helps
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the rembg model into the image so cold starts are fast.
# Using u2netp (~5 MB) by default — fits on 512 MB free-tier RAM. Set
# REMBG_MODEL=u2net at build time for the larger/better model on a paid plan.
ARG REMBG_MODEL=u2netp
ENV U2NET_HOME=/root/.u2net
ENV REMBG_MODEL=${REMBG_MODEL}
RUN python -c "from rembg import new_session; new_session('${REMBG_MODEL}')"

# Copy the rest of the backend code
COPY backend/ .

ENV HOST=0.0.0.0 \
    PORT=8001 \
    PYTHONUNBUFFERED=1
EXPOSE 8001

CMD ["python", "main.py"]
