FROM python:3.12-slim-bookworm

# System dependencies:
# - LibreOffice (writer + core) for PDF -> DOCX
# - FFmpeg for yt-dlp post-processing (audio extraction, A/V merge)
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
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps first so layer caching helps
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the rembg U2Net model into the image (~170 MB) so cold starts are fast.
ENV U2NET_HOME=/root/.u2net
RUN python -c "from rembg import new_session; new_session('u2net')"

# Copy the rest of the backend code
COPY backend/ .

ENV HOST=0.0.0.0 \
    PORT=8001 \
    PYTHONUNBUFFERED=1
EXPOSE 8001

CMD ["python", "main.py"]
