import { useCallback, useEffect, useRef, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8001';
const MAX_BYTES = 50 * 1024 * 1024;

let nextId = 1;

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(s) {
  if (s == null || isNaN(s)) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function filenameFromContentDisposition(header, fallback) {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try { return decodeURIComponent(star[1].replace(/"/g, '')); } catch (_) {}
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1] : fallback;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ── Icons (Tabler-style inline) ─────────────────────── */
const Icon = ({ children, size = 16, strokeWidth = 2, className = '' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {children}
  </svg>
);
const IconCloudUpload = (p) => (
  <Icon {...p}>
    <path d="M7 18a4.6 4.4 0 0 1 0 -9a5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7h-1" />
    <path d="M9 15l3 -3l3 3" />
    <path d="M12 12l0 9" />
  </Icon>
);
const IconLink = (p) => (
  <Icon {...p}>
    <path d="M9 15l6 -6" />
    <path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464" />
    <path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463" />
  </Icon>
);
const IconHelp = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 17l0 .01" />
    <path d="M12 13.5a1.5 1.5 0 0 1 1 -1.5a2.6 2.6 0 1 0 -3 -4" />
  </Icon>
);
const IconX = (p) => (
  <Icon {...p}>
    <path d="M18 6l-12 12" /><path d="M6 6l12 12" />
  </Icon>
);
const IconTrash = (p) => (
  <Icon {...p}>
    <path d="M4 7l16 0" /><path d="M10 11l0 6" /><path d="M14 11l0 6" />
    <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" />
    <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />
  </Icon>
);
const IconCheck = (p) => (
  <Icon {...p}>
    <path d="M5 12l5 5l10 -10" />
  </Icon>
);
const IconLoader = (p) => (
  <Icon {...p}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </Icon>
);
const IconPlay = (p) => (
  <Icon {...p}>
    <path d="M7 4v16l13 -8z" />
  </Icon>
);
const IconMusic = (p) => (
  <Icon {...p}>
    <circle cx="6" cy="17" r="3" />
    <circle cx="16" cy="17" r="3" />
    <path d="M9 17v-13h10v13" />
    <path d="M9 8h10" />
  </Icon>
);
const IconDownload = (p) => (
  <Icon {...p}>
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
    <path d="M7 11l5 5l5 -5" />
    <path d="M12 4l0 12" />
  </Icon>
);
const IconClipboard = (p) => (
  <Icon {...p}>
    <path d="M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2" />
    <rect x="9" y="3" width="6" height="4" rx="2" />
  </Icon>
);
const IconMenu = (p) => (
  <Icon {...p}>
    <path d="M4 6l16 0" /><path d="M4 12l16 0" /><path d="M4 18l16 0" />
  </Icon>
);
const IconChevronDown = (p) => (
  <Icon {...p}>
    <path d="M6 9l6 6l6 -6" />
  </Icon>
);
const IconTool = (p) => (
  <Icon {...p}>
    <path d="M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5" />
  </Icon>
);
const IconScissors = (p) => (
  <Icon {...p}>
    <circle cx="6" cy="7" r="3" />
    <circle cx="6" cy="17" r="3" />
    <path d="M9 5l12 14M9 19l12 -14" />
  </Icon>
);
const IconSparkles = (p) => (
  <Icon {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    <path d="M12 7c0 2 -3 5 -5 5c2 0 5 3 5 5c0 -2 3 -5 5 -5c-2 0 -5 -3 -5 -5z" />
  </Icon>
);
const IconImage = (p) => (
  <Icon {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="1.5" />
    <path d="M21 15l-5 -5l-11 11" />
  </Icon>
);
const IconFile = (p) => (
  <Icon {...p}>
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
  </Icon>
);
const IconFolder = (p) => (
  <Icon {...p}>
    <path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2" />
  </Icon>
);
const IconHeart = (p) => (
  <Icon {...p}>
    <path d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572" />
  </Icon>
);
const IconHistory2 = (p) => (
  <Icon {...p}>
    <path d="M12 8l0 4l3 3" />
    <path d="M3 12a9 9 0 1 0 9 -9a9 9 0 0 0 -7 3.5" />
    <path d="M3 4v4h4" />
  </Icon>
);
const IconStack = (p) => (
  <Icon {...p}>
    <path d="M12 4l-8 4l8 4l8 -4l-8 -4" />
    <path d="M4 12l8 4l8 -4" />
    <path d="M4 16l8 4l8 -4" />
  </Icon>
);
const IconQR = (p) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3M20 14v3M14 17v3M17 17h3M14 21h3" />
  </Icon>
);

/* ── App shell ───────────────────────────────────────── */
const TOOLS = [
  { id: 'pdf',     label: 'PDF → Word',       desc: 'Convert PDF to Word',           Icon: IconCloudUpload },
  { id: 'media',   label: 'Media Download',   desc: 'Download video/audio from URL', Icon: IconDownload },
  { id: 'remove',  label: 'Remove Background', desc: 'Cut out the background of any image', Icon: IconScissors },
  { id: 'emoji',   label: 'Create Emoji',     desc: 'Make a 128/256/512 px emoji from an image', Icon: IconSparkles },
  { id: 'qr',      label: 'QR Generator',     desc: 'Generate a QR code from text or URL', Icon: IconQR },
];

const SIDEBAR_GROUPS = [
  {
    title: 'Tools',
    items: [
      {
        type: 'group',
        id: 'documents',
        label: 'Documents',
        Icon: IconFile,
        children: [
          { id: 'pdf',   label: 'PDF → Word' },
        ],
      },
      {
        type: 'group',
        id: 'media-group',
        label: 'Media',
        Icon: IconDownload,
        badge: '2',
        children: [
          { id: 'media-video', label: 'Video Download', target: 'media' },
          { id: 'media-audio', label: 'Audio Download', target: 'media' },
        ],
      },
      {
        type: 'group',
        id: 'images-group',
        label: 'Images',
        Icon: IconImage,
        badge: '2',
        children: [
          { id: 'remove', label: 'Remove Background' },
          { id: 'emoji',  label: 'Create Emoji' },
        ],
      },
      {
        type: 'group',
        id: 'gen-group',
        label: 'Generators',
        Icon: IconSparkles,
        badge: '1',
        children: [
          { id: 'qr', label: 'QR Generator' },
        ],
      },
      { type: 'item', id: 'likes', label: 'Likes', Icon: IconHeart, soon: true },
    ],
  },
  {
    title: 'My library',
    items: [
      { type: 'item', id: 'files',    label: 'My Files',  Icon: IconFolder, soon: true },
      { type: 'item', id: 'history',  label: 'History',   Icon: IconHistory2, badge: '0' },
      { type: 'item', id: 'recent',   label: 'Recent',    Icon: IconStack,  soon: true },
      { type: 'item', id: 'settings', label: 'Settings',  Icon: IconTool,   soon: true },
    ],
  },
];

const TAB_META = {
  pdf:    { title: 'PDF → Word',       breadcrumb: ['Tools', 'Documents'] },
  media:  { title: 'Media Download',   breadcrumb: ['Tools', 'Media'] },
  remove: { title: 'Remove Background', breadcrumb: ['Tools', 'Images'] },
  emoji:  { title: 'Create Emoji',     breadcrumb: ['Tools', 'Images'] },
  qr:     { title: 'QR Generator',     breadcrumb: ['Tools', 'Generators'] },
};

export default function App() {
  const [tab, setTab] = useState('pdf');
  const [sbOpen, setSbOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const meta = TAB_META[tab] || { title: '', breadcrumb: [] };

  useEffect(() => {
    const apply = () => {
      const m = window.innerWidth < 768;
      setIsMobile(m);
      // Auto-collapse on first mobile resize
      if (m) setSbOpen(false);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  const closeOnMobile = () => { if (isMobile) setSbOpen(false); };

  return (
    <div className="layout">
      {isMobile && sbOpen && (
        <div className="sb-backdrop" onClick={() => setSbOpen(false)} />
      )}
      <Sidebar
        tab={tab}
        setTab={(id) => { setTab(id); closeOnMobile(); }}
        sbOpen={sbOpen}
        onClose={() => setSbOpen(false)}
      />
      <main className="page">
        <Topbar meta={meta} sbOpen={sbOpen} onToggle={() => setSbOpen((v) => !v)} />
        <section className="workspace">
          <header className="ws-head">
            <p className="ws-crumbs">
              {meta.breadcrumb.map((c, i) => (
                <span key={c}>{i > 0 && <span className="ws-sep">/</span>}{c}</span>
              ))}
            </p>
            <h1 className="ws-title">{meta.title}</h1>
          </header>
          <div className="ws-card-wrap">
            <div className="card">
              {tab === 'pdf'    && <UploadPanel />}
              {tab === 'media'  && <MediaPanel />}
              {tab === 'remove' && <ImagePanel mode="remove" />}
              {tab === 'emoji'  && <ImagePanel mode="emoji" />}
              {tab === 'qr'     && <QRPanel />}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function Topbar({ meta, sbOpen, onToggle }) {
  return (
    <header className="topbar">
      <button
        type="button"
        className="ghost-btn topbar-toggle"
        onClick={onToggle}
        aria-label={sbOpen ? 'Hide sidebar' : 'Show sidebar'}
        aria-pressed={sbOpen}
      ><IconMenu size={20} /></button>
      <div className="topbar-title">{meta.title}</div>
      <div className="topbar-search">
        <SearchGlyph />
        <input placeholder="Search tools, files…" />
      </div>
      <button className="ghost-btn" aria-label="Help"><IconHelp size={18} /></button>
      <div className="topbar-avatar" aria-hidden>D</div>
    </header>
  );
}

function SearchGlyph() {
  return (
    <Icon size={16} strokeWidth={1.75}>
      <circle cx="10" cy="10" r="7" />
      <path d="m20 20 -3.5 -3.5" />
    </Icon>
  );
}

function Sidebar({ tab, setTab, sbOpen, onClose }) {
  // figure out which group contains the active tab so it's expanded by default
  const groupHasTab = (g) =>
    g.type === 'group' && g.children.some((c) => (c.target || c.id) === tab);
  const initialExpanded = {};
  for (const section of SIDEBAR_GROUPS) {
    for (const it of section.items) {
      if (it.type === 'group') initialExpanded[it.id] = groupHasTab(it);
    }
  }
  const [expanded, setExpanded] = useState(initialExpanded);
  const toggle = (id) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  return (
    <aside className={`sidebar${sbOpen ? ' open' : ' closed'}`}>
      <div className="sb-top">
        <a className="sb-brand" href="/" aria-label="Digitools home">
          <span className="sb-brand-mark"><IconTool size={20} strokeWidth={2.25} /></span>
          <span className="sb-brand-text">Digitools</span>
        </a>
        <button
          type="button"
          className="ghost-btn sb-close"
          onClick={onClose}
          aria-label="Close menu"
        ><IconX size={18} /></button>
      </div>
      {SIDEBAR_GROUPS.map((section) => (
        <div className="sb-section" key={section.title}>
          <p className="sb-heading">{section.title}</p>
          {section.items.map((it) => {
            if (it.type === 'group') {
              const isOpen = expanded[it.id];
              const childActive = it.children.some((c) => (c.target || c.id) === tab);
              return (
                <div className="sb-group" key={it.id}>
                  <button
                    type="button"
                    className={`sb-item${childActive && !isOpen ? ' active' : ''}`}
                    onClick={() => toggle(it.id)}
                    aria-expanded={isOpen}
                  >
                    <span className="sb-icon"><it.Icon size={18} strokeWidth={1.75} /></span>
                    <span className="sb-label">{it.label}</span>
                    {it.badge && <span className="sb-badge">{it.badge}</span>}
                    <IconChevronDown
                      size={14}
                      strokeWidth={2}
                      className={`sb-chev${isOpen ? ' up' : ''}`}
                    />
                  </button>
                  {isOpen && (
                    <ul className="sb-children">
                      {it.children.map((c) => {
                        const target = c.target || c.id;
                        const active = tab === target;
                        return (
                          <li key={c.id}>
                            <button
                              type="button"
                              className={`sb-child${active ? ' active' : ''}`}
                              onClick={() => setTab(target)}
                            >
                              {c.label}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            }
            return (
              <button
                key={it.id}
                type="button"
                className={`sb-item${tab === it.id ? ' active' : ''}${it.soon ? ' soon' : ''}`}
                onClick={() => !it.soon && setTab(it.id)}
                disabled={it.soon}
                title={it.soon ? 'Coming soon' : undefined}
              >
                <span className="sb-icon"><it.Icon size={18} strokeWidth={1.75} /></span>
                <span className="sb-label">{it.label}</span>
                {it.badge && <span className="sb-badge">{it.badge}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );
}

function Hero({ onPrimary }) {
  return (
    <section className="hero">
      <div className="hero-bg" aria-hidden />
      <div className="hero-inner">
        <span className="hero-eyebrow">All-in-one digital toolbox</span>
        <h1 className="hero-title">
          Convert, download &amp; <span className="hero-accent">simplify</span> your files.
        </h1>
        <p className="hero-sub">
          PDF to Word with proper Khmer support. Download videos and audio from 1000+
          sites. Fast, private, no sign-up required.
        </p>
        <div className="hero-cta">
          <button className="primary-btn" onClick={() => onPrimary('pdf')}>
            <IconCloudUpload size={16} /> PDF to Word
          </button>
          <button className="browse-btn" onClick={() => onPrimary('media')}>
            <IconDownload size={14} /> Download media
          </button>
        </div>
        <div className="hero-stats">
          <div><strong>1000+</strong><span>supported sites</span></div>
          <div><strong>50 MB</strong><span>max upload</span></div>
          <div><strong>0 sign-up</strong><span>just paste &amp; go</span></div>
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  {
    Icon: IconCloudUpload,
    title: 'PDF to Word',
    body: 'Drop a PDF, get a .docx back. Khmer fonts preserved. Multi-file queue with live progress.',
  },
  {
    Icon: IconDownload,
    title: 'Media downloader',
    body: 'Paste a TikTok, Instagram, YouTube, Twitter or Vimeo link. Save as MP4 or extract MP3 audio.',
  },
  {
    Icon: IconCheck,
    title: 'Private by design',
    body: 'Files are processed locally on this server and deleted right after the download finishes.',
  },
];

function Features() {
  return (
    <section className="features">
      <div className="section-head">
        <span className="hero-eyebrow">Why Digitools</span>
        <h2 className="section-title">Built for speed, designed to stay out of your way.</h2>
      </div>
      <div className="feature-grid">
        {FEATURES.map(({ Icon, title, body }) => (
          <article key={title} className="feature">
            <span className="feature-icon"><Icon size={20} strokeWidth={1.75} /></span>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ── Image panel (Remove BG / Emoji) ─────────────────── */
const IMG_MAX_BYTES = 25 * 1024 * 1024;

function ImagePanel({ mode }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);    // object URL of input
  const [outUrl, setOutUrl] = useState(null);      // object URL of output
  const [outName, setOutName] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [size, setSize] = useState(256);           // emoji only
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
      if (outUrl) URL.revokeObjectURL(outUrl);
    };
  }, [preview, outUrl]);

  const reset = () => {
    if (preview) URL.revokeObjectURL(preview);
    if (outUrl)  URL.revokeObjectURL(outUrl);
    setFile(null); setPreview(null); setOutUrl(null); setOutName(null);
    setError(''); setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const setNewFile = (f) => {
    if (!f) return;
    setError('');
    if (!f.type.startsWith('image/')) { setError('Only image files are accepted.'); return; }
    if (f.size > IMG_MAX_BYTES)        { setError('Image exceeds 25 MB limit.');    return; }
    if (preview) URL.revokeObjectURL(preview);
    if (outUrl)  URL.revokeObjectURL(outUrl);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setOutUrl(null);
    setOutName(null);
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    setNewFile(e.dataTransfer.files?.[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const url = mode === 'emoji'
        ? `${API_BASE}/image/emoji`
        : `${API_BASE}/image/remove-bg`;
      if (mode === 'emoji') form.append('size', String(size));
      const r = await fetch(url, { method: 'POST', body: form });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || `Failed (${r.status})`);
      }
      const blob = await r.blob();
      const cd = r.headers.get('Content-Disposition');
      const fallback = file.name.replace(/\.[^.]+$/, '') +
        (mode === 'emoji' ? `-emoji-${size}.png` : '-nobg.png');
      const name = filenameFromContentDisposition(cd, fallback);
      if (outUrl) URL.revokeObjectURL(outUrl);
      const objUrl = URL.createObjectURL(blob);
      setOutUrl(objUrl);
      setOutName(name);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!outUrl || !outName) return;
    const a = document.createElement('a');
    a.href = outUrl;
    a.download = outName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const isEmoji = mode === 'emoji';
  const HeadIcon = isEmoji ? IconSparkles : IconScissors;

  return (
    <>
      <div className="head">
        <div className="head-icon"><HeadIcon size={20} strokeWidth={2.25} /></div>
        <div className="head-text">
          <h2>{isEmoji ? 'Create Emoji' : 'Remove Background'}</h2>
          <p>
            {isEmoji
              ? 'Drop an image — get a square emoji-ready PNG with transparent bg.'
              : 'Drop an image — get the same image with the background cut out.'}
          </p>
        </div>
        <button
          className="ghost-btn"
          onClick={reset}
          aria-label="Clear"
          disabled={!file && !error}
        ><IconX size={18} /></button>
      </div>

      {!file ? (
        <div
          className={`dropzone${dragOver ? ' drag' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <IconImage size={32} strokeWidth={1.5} className="dz-icon" />
          <div className="dz-title">Choose an image or drag &amp; drop it here.</div>
          <div className="dz-hint">JPG, PNG, WebP — up to 25 MB.</div>
          <button className="browse-btn" type="button" onClick={() => inputRef.current?.click()}>
            Browse Image
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => { setNewFile(e.target.files?.[0]); e.target.value = ''; }}
          />
        </div>
      ) : (
        <div className="img-compare">
          <figure>
            <figcaption>Original</figcaption>
            <div className="img-thumb"><img src={preview} alt="" /></div>
          </figure>
          <figure>
            <figcaption>Result</figcaption>
            <div className="img-thumb checker">
              {outUrl ? (
                <img src={outUrl} alt="" />
              ) : busy ? (
                <span className="img-placeholder"><IconLoader size={20} className="spin" /> Working…</span>
              ) : (
                <span className="img-placeholder">Click {isEmoji ? '"Create"' : '"Remove"'} below</span>
              )}
            </div>
          </figure>
        </div>
      )}

      {file && isEmoji && (
        <div className="seg" style={{ marginTop: 12 }}>
          {[128, 256, 512].map((s) => (
            <button
              key={s}
              className={`seg-opt${size === s ? ' active' : ''}`}
              onClick={() => setSize(s)}
            >
              {s}px
            </button>
          ))}
        </div>
      )}

      {error && <div className="msg-err">{error}</div>}

      {file && (
        <div className="img-actions">
          <button className="browse-btn" onClick={reset} disabled={busy}>
            Choose another
          </button>
          {outUrl ? (
            <button className="primary-btn" onClick={download}>
              <IconDownload size={14} /> Download PNG
            </button>
          ) : (
            <button className="primary-btn" onClick={run} disabled={busy}>
              {busy
                ? <><IconLoader size={14} className="spin" /> Working…</>
                : isEmoji
                  ? <><IconSparkles size={14} /> Create emoji</>
                  : <><IconScissors size={14} /> Remove background</>}
            </button>
          )}
        </div>
      )}
    </>
  );
}

/* ── QR Generator ─────────────────────────────────────── */
function QRPanel() {
  const [text, setText] = useState('https://digitools.app');
  const [size, setSize] = useState(512);
  const [fg, setFg] = useState('#0f172a');
  const [bg, setBg] = useState('#ffffff');
  const [transparent, setTransparent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outUrl, setOutUrl] = useState(null);

  useEffect(() => () => { if (outUrl) URL.revokeObjectURL(outUrl); }, [outUrl]);

  const generate = async () => {
    if (!text.trim()) return;
    setBusy(true); setError('');
    try {
      const r = await fetch(`${API_BASE}/qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          size,
          fg,
          bg: transparent ? 'transparent' : bg,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || `Failed (${r.status})`);
      }
      const blob = await r.blob();
      if (outUrl) URL.revokeObjectURL(outUrl);
      setOutUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!outUrl) return;
    const a = document.createElement('a');
    a.href = outUrl;
    a.download = `qr-${size}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <>
      <div className="head">
        <div className="head-icon"><IconQR size={20} strokeWidth={2.25} /></div>
        <div className="head-text">
          <h2>QR Generator</h2>
          <p>Turn any text or URL into a QR code.</p>
        </div>
        <button className="ghost-btn" aria-label="Help"><IconHelp size={16} /></button>
      </div>

      <label className="qr-field">
        <span className="qr-label">Text or URL</span>
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="https://example.com"
          className="qr-textarea"
          maxLength={4000}
        />
      </label>

      <div className="qr-row">
        <label className="qr-field">
          <span className="qr-label">Foreground</span>
          <span className="qr-color">
            <input type="color" value={fg} onChange={(e) => setFg(e.target.value)} />
            <span>{fg.toUpperCase()}</span>
          </span>
        </label>
        <label className="qr-field">
          <span className="qr-label">Background</span>
          <span className={`qr-color${transparent ? ' is-disabled' : ''}`}>
            <input
              type="color"
              value={bg}
              onChange={(e) => setBg(e.target.value)}
              disabled={transparent}
            />
            <span>{transparent ? 'transparent' : bg.toUpperCase()}</span>
          </span>
        </label>
      </div>

      <label className="qr-check">
        <input
          type="checkbox"
          checked={transparent}
          onChange={(e) => setTransparent(e.target.checked)}
        />
        <span>Transparent background</span>
      </label>

      <div className="seg" style={{ marginTop: 12 }}>
        {[128, 256, 512, 1024].map((s) => (
          <button
            key={s}
            className={`seg-opt${size === s ? ' active' : ''}`}
            onClick={() => setSize(s)}
          >
            {s}px
          </button>
        ))}
      </div>

      {error && <div className="msg-err">{error}</div>}

      {outUrl && (
        <div className="qr-preview">
          <div className="qr-thumb"><img src={outUrl} alt="QR preview" /></div>
        </div>
      )}

      <div className="img-actions">
        {outUrl && (
          <button className="browse-btn" onClick={() => { URL.revokeObjectURL(outUrl); setOutUrl(null); }} disabled={busy}>
            Clear
          </button>
        )}
        {outUrl ? (
          <button className="primary-btn" onClick={download}>
            <IconDownload size={14} /> Download PNG
          </button>
        ) : (
          <button className="primary-btn" onClick={generate} disabled={busy || !text.trim()}>
            {busy
              ? <><IconLoader size={14} className="spin" /> Generating…</>
              : <><IconQR size={14} /> Generate QR</>}
          </button>
        )}
      </div>
    </>
  );
}

/* ── Footer (Playflow style, ported from Portfolio) ───── */
function FooterTwitter() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.5 5.5c-.8.4-1.7.6-2.6.7a4.5 4.5 0 0 0 2-2.5 9 9 0 0 1-2.9 1.1 4.5 4.5 0 0 0-7.7 4.1A12.7 12.7 0 0 1 2 4.6a4.5 4.5 0 0 0 1.4 6 4.5 4.5 0 0 1-2-.6v.1a4.5 4.5 0 0 0 3.6 4.4 4.5 4.5 0 0 1-2 .1 4.5 4.5 0 0 0 4.2 3.1A9 9 0 0 1 1 19.5a12.8 12.8 0 0 0 6.9 2c8.3 0 12.8-6.9 12.8-12.8v-.6a9.2 9.2 0 0 0 2.3-2.3l-.5-.3z" />
    </svg>
  );
}
function FooterGitHub() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.7.5.5 5.7.5 12a11.5 11.5 0 0 0 7.9 10.9c.6.1.8-.2.8-.6v-2.2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.7.4-1.3.7-1.6-2.5-.3-5.2-1.3-5.2-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3 0 0 1-.3 3.2 1.2.9-.3 1.9-.4 2.9-.4s2 .1 2.9.4c2.2-1.5 3.2-1.2 3.2-1.2.6 1.5.2 2.7.1 3 .8.8 1.2 1.9 1.2 3.1 0 4.4-2.7 5.4-5.2 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.5 11.5 0 0 0 23.5 12C23.5 5.7 18.3.5 12 .5z" />
    </svg>
  );
}
function FooterTelegram() {
  return (
    <svg viewBox="0 0 496 512" fill="currentColor" aria-hidden="true">
      <path d="M248,8C111.033,8,0,119.033,0,256S111.033,504,248,504,496,392.967,496,256,384.967,8,248,8ZM362.952,176.66c-3.732,39.215-19.881,134.378-28.1,178.3-3.476,18.584-10.322,24.816-16.948,25.425-14.4,1.326-25.338-9.517-39.287-18.661-21.827-14.308-34.158-23.215-55.346-37.177-24.485-16.135-8.612-25,5.342-39.5,3.652-3.793,67.107-61.51,68.335-66.746.153-.655.3-3.1-1.154-4.384s-3.59-.849-5.135-.5q-3.283.746-104.608,69.142-14.845,10.194-26.894,9.934c-8.855-.191-25.888-5.006-38.551-9.123-15.531-5.048-27.875-7.717-26.8-16.291q.84-6.7,18.45-13.7,108.446-47.248,144.628-62.3c68.872-28.647,83.183-33.623,92.511-33.789,2.052-.034,6.639.474,9.61,2.885a10.452,10.452,0,0,1,3.53,6.716A43.765,43.765,0,0,1,362.952,176.66Z" />
    </svg>
  );
}
function FooterYouTube() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.6 3.6 12 3.6 12 3.6s-7.6 0-9.4.5A3 3 0 0 0 .5 6.2C0 8 0 12 0 12s0 4 .5 5.8a3 3 0 0 0 2.1 2.1c1.8.5 9.4.5 9.4.5s7.6 0 9.4-.5a3 3 0 0 0 2.1-2.1C24 16 24 12 24 12s0-4-.5-5.8zM9.6 15.6V8.4l6.4 3.6-6.4 3.6z" />
    </svg>
  );
}
function FooterShield() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
    </svg>
  );
}
function FooterLock() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
function FooterStar() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="12 2 15.1 8.6 22 9.6 17 14.5 18.2 21.5 12 18.2 5.8 21.5 7 14.5 2 9.6 8.9 8.6" />
    </svg>
  );
}
function FooterHeart() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 22l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  );
}

const FOOTER_COLUMNS = [
  { title: 'Product',  links: [
    { label: 'PDF to Word',     href: '#' },
    { label: 'Media Download',  href: '#' },
    { label: 'Pricing',         href: '#' },
    { label: 'Changelog',       href: '#' },
    { label: 'Roadmap',         href: '#' },
  ]},
  { title: 'Company',  links: [
    { label: 'About Us',        href: '#' },
    { label: 'Careers',         href: '#' },
    { label: 'Blog',            href: '#' },
    { label: 'Press Kit',       href: '#' },
    { label: 'Contact',         href: '#' },
  ]},
  { title: 'Resources', links: [
    { label: 'Documentation',   href: '#' },
    { label: 'Help Center',     href: '#' },
    { label: 'API Reference',   href: '#' },
    { label: 'Community',       href: '#' },
    { label: 'Tutorials',       href: '#' },
  ]},
  { title: 'Legal',    links: [
    { label: 'Privacy',         href: '#' },
    { label: 'Terms',           href: '#' },
    { label: 'Security',        href: '#' },
    { label: 'Cookies',         href: '#' },
    { label: 'Compliance',      href: '#' },
  ]},
];

const FOOTER_SOCIALS = [
  { name: 'Twitter',  Icon: FooterTwitter,  href: '#' },
  { name: 'GitHub',   Icon: FooterGitHub,   href: '#' },
  { name: 'Telegram', Icon: FooterTelegram, href: 'https://t.me/Lethean_Seourn' },
  { name: 'YouTube',  Icon: FooterYouTube,  href: '#' },
];

const FOOTER_META = [
  { label: 'Status',        href: '#' },
  { label: 'Sitemap',       href: '#' },
  { label: 'Accessibility', href: '#' },
];

function Footer() {
  const [email, setEmail] = useState('');
  const [subState, setSubState] = useState('idle');
  const year = new Date().getFullYear();

  const onSubmit = (e) => {
    e.preventDefault();
    if (subState !== 'idle') return;
    setSubState('loading');
    setTimeout(() => setSubState('done'), 4000);
    setTimeout(() => { setSubState('idle'); setEmail(''); }, 5500);
  };

  return (
    <footer className="footer footer-playflow">
      <div className="container">
        <div className="footer-pf-grid">
          <div className="footer-pf-brand">
            <div className="footer-pf-logo">
              <img src="/l1.png" alt="Digitools" className="footer-pf-brand-img" />
            </div>
            <p className="footer-pf-tagline">
              The all-in-one digital toolbox. Convert PDFs, download videos and audio
              from 1000+ sites — fast, private, no sign-up.
            </p>
            <div className="footer-pf-socials">
              {FOOTER_SOCIALS.map(({ name, Icon, href }) => (
                <a key={name} href={href} className="footer-pf-social" aria-label={name}>
                  <Icon />
                </a>
              ))}
            </div>
          </div>

          {FOOTER_COLUMNS.map((c) => (
            <div key={c.title} className="footer-pf-col">
              <p className="footer-pf-col-title">{c.title}</p>
              <ul>
                {c.links.map((l) => (
                  <li key={l.label}><a href={l.href}>{l.label}</a></li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="footer-pf-trust">
          <div className="footer-pf-badges">
            <span className="footer-pf-badge"><FooterShield /> SOC 2 Certified</span>
            <span className="footer-pf-badge"><FooterLock /> GDPR Compliant</span>
            <span className="footer-pf-badge">
              <span className="footer-pf-stars" aria-hidden="true">
                <FooterStar /><FooterStar /><FooterStar /><FooterStar /><FooterStar />
              </span>
              4.9/5 Rating
            </span>
          </div>

          <form className="footer-pf-subscribe" onSubmit={onSubmit}>
            <input
              type="email"
              className="footer-pf-input"
              placeholder="Get product updates..."
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button
              type="submit"
              className={`btn-talk btn-delivery footer-pf-btn${subState === 'loading' ? ' is-loading' : ''}${subState === 'done' ? ' is-done' : ''}`}
            >
              <span className="btn-delivery-label">Subscribe</span>
              <span className="btn-delivery-bike" aria-hidden="true">
                <img src="/delivery1.png" alt="" />
                <span className="btn-delivery-dust" />
                <span className="btn-delivery-dust" />
                <span className="btn-delivery-dust" />
              </span>
              <span className="btn-delivery-done">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Subscribed!
              </span>
            </button>
          </form>
        </div>

        <div className="footer-pf-bottom">
          <p className="footer-pf-copy">
            © {year} Digitools. Made with <FooterHeart /> In Cambodia
          </p>
          <ul className="footer-pf-meta">
            {FOOTER_META.map((l, i) => (
              <li key={l.label}>
                {i > 0 && <span className="footer-pf-meta-sep">•</span>}
                <a href={l.href}>{l.label}</a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}

function Navbar() {
  return (
    <header className="nav">
      <div className="nav-inner">
        <a className="nav-brand" href="/" aria-label="Digitools home">
          <span className="nav-brand-text">Digitools</span>
        </a>
        <div className="nav-actions">
          <button className="ghost-btn" aria-label="Help"><IconHelp size={18} /></button>
        </div>
      </div>
    </header>
  );
}

/* ── PDF panel ───────────────────────────────────────── */
function UploadPanel() {
  const [items, setItems] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);
  const xhrs = useRef(new Map());

  const updateItem = (id, patch) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const startUpload = (item) => {
    const xhr = new XMLHttpRequest();
    xhrs.current.set(item.id, xhr);
    xhr.open('POST', `${API_BASE}/convert`);
    xhr.responseType = 'blob';
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      updateItem(item.id, { uploaded: e.loaded });
    };
    xhr.upload.onload = () => {
      updateItem(item.id, { uploaded: item.file.size, status: 'converting' });
    };
    xhr.onload = async () => {
      xhrs.current.delete(item.id);
      if (xhr.status >= 200 && xhr.status < 300) {
        const cd = xhr.getResponseHeader('Content-Disposition');
        const fallback = item.file.name.replace(/\.pdf$/i, '.docx');
        const filename = filenameFromContentDisposition(cd, fallback);
        triggerDownload(xhr.response, filename);
        updateItem(item.id, { status: 'completed', uploaded: item.file.size });
      } else {
        let msg = `Failed (${xhr.status})`;
        try {
          const text = await xhr.response.text();
          const j = JSON.parse(text);
          if (j.detail) msg = j.detail;
        } catch (_) {}
        updateItem(item.id, { status: 'error', error: msg });
      }
    };
    xhr.onerror = () => {
      xhrs.current.delete(item.id);
      updateItem(item.id, { status: 'error', error: 'Network error' });
    };
    xhr.onabort = () => xhrs.current.delete(item.id);
    const form = new FormData();
    form.append('file', item.file);
    xhr.send(form);
  };

  const addFiles = (fileList) => {
    const files = Array.from(fileList || []);
    const fresh = [];
    for (const f of files) {
      if (!f.name.toLowerCase().endsWith('.pdf')) {
        fresh.push({ id: nextId++, file: f, uploaded: 0, status: 'error', error: 'Only PDF files.' });
        continue;
      }
      if (f.size > MAX_BYTES) {
        fresh.push({ id: nextId++, file: f, uploaded: 0, status: 'error', error: 'Over 50 MB.' });
        continue;
      }
      fresh.push({ id: nextId++, file: f, uploaded: 0, status: 'uploading', error: '' });
    }
    setItems((prev) => [...prev, ...fresh]);
    fresh.filter((it) => it.status === 'uploading').forEach(startUpload);
  };

  const removeItem = (id) => {
    const xhr = xhrs.current.get(id);
    if (xhr) { xhr.abort(); xhrs.current.delete(id); }
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }, []);

  return (
    <>
      <div className="head">
        <div className="head-icon"><IconCloudUpload size={20} strokeWidth={2.25} /></div>
        <div className="head-text">
          <h2>Upload files</h2>
          <p>Convert PDF documents to Word</p>
        </div>
        <button className="ghost-btn" aria-label="Help"><IconHelp size={16} /></button>
      </div>

      <div
        className={`dropzone${dragOver ? ' drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <IconCloudUpload size={32} strokeWidth={1.5} className="dz-icon" />
        <div className="dz-title">Choose a file or drag &amp; drop it here.</div>
        <div className="dz-hint">PDF format, up to 50 MB.</div>
        <button className="browse-btn" type="button" onClick={() => inputRef.current?.click()}>
          Browse File
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {items.length > 0 && (
        <ul className="list">
          {items.map((it) => (
            <FileRow key={it.id} item={it} onRemove={() => removeItem(it.id)} />
          ))}
        </ul>
      )}
    </>
  );
}

function FileRow({ item, onRemove }) {
  const total = item.file.size;
  const done = item.status === 'completed';
  const failed = item.status === 'error';
  const converting = item.status === 'converting';
  const pct = total === 0 ? 0 : Math.min(100, Math.round((item.uploaded / total) * 100));
  const barWidth = done ? 100 : converting ? 100 : pct;

  return (
    <li className={`row${failed ? ' is-error' : ''}`}>
      <div className="pdf-badge">PDF</div>
      <div className="row-body">
        <div className="row-top">
          <span className="filename" title={item.file.name}>{item.file.name}</span>
          <button className="ghost-btn small" onClick={onRemove} aria-label={done ? 'Remove' : 'Cancel'}>
            {done ? <IconTrash size={16} /> : <IconX size={16} />}
          </button>
        </div>
        <div className="row-meta">
          {failed ? (
            <span className="meta-err">{item.error}</span>
          ) : (
            <>
              <span>{formatSize(done ? total : item.uploaded)} of {formatSize(total)}</span>
              <span className="dot">·</span>
              {done ? (
                <span className="ok"><span className="check-pip"><IconCheck size={10} strokeWidth={3} /></span> Completed</span>
              ) : converting ? (
                <span className="working"><IconLoader size={12} className="spin" /> Converting…</span>
              ) : (
                <span className="working"><IconLoader size={12} className="spin" /> Uploading…</span>
              )}
            </>
          )}
        </div>
        {!failed && (
          <div className="bar">
            <div className={`bar-fill${converting ? ' indeterminate' : ''}`} style={{ width: `${barWidth}%` }} />
          </div>
        )}
      </div>
    </li>
  );
}

/* ── Media panel ─────────────────────────────────────── */
function MediaPanel() {
  const [url, setUrl] = useState('');
  const [info, setInfo] = useState(null);
  const [fmt, setFmt] = useState('video');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const fetchInfo = async (u) => {
    if (!u) return;
    setError('');
    setInfo(null);
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/media/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || `Fetch failed (${r.status})`);
      }
      const data = await r.json();
      setInfo(data);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const onPaste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) {
        setUrl(t);
        fetchInfo(t);
      }
    } catch (_) {}
  };

  const startDownload = async () => {
    if (!url || !info) return;
    setDownloading(true);
    setError('');
    try {
      const r = await fetch(`${API_BASE}/media/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, format: fmt }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || `Download failed (${r.status})`);
      }
      const blob = await r.blob();
      const cd = r.headers.get('Content-Disposition');
      const fallback = `${info.title || 'media'}.${fmt === 'audio' ? 'mp3' : 'mp4'}`;
      triggerDownload(blob, filenameFromContentDisposition(cd, fallback));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <div className="head">
        <div className="head-icon"><IconLink size={20} strokeWidth={2.25} /></div>
        <div className="head-text">
          <h2>Media Download</h2>
          <p>Paste a video or audio link from any supported site</p>
        </div>
        <button className="ghost-btn" aria-label="Help"><IconHelp size={16} /></button>
      </div>

      <div className="url-row">
        <div className="url-input">
          <IconLink size={16} className="url-input-icon" />
          <input
            type="url"
            placeholder="Paste URL (TikTok, Instagram, YouTube, …)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') fetchInfo(url); }}
          />
          {url && (
            <button className="ghost-btn small" onClick={() => { setUrl(''); setInfo(null); setError(''); }} aria-label="Clear">
              <IconX size={14} />
            </button>
          )}
        </div>
        <button className="browse-btn" type="button" onClick={onPaste} title="Paste from clipboard">
          <IconClipboard size={14} /> Paste
        </button>
        <button
          className="primary-btn"
          type="button"
          disabled={!url || loading}
          onClick={() => fetchInfo(url)}
        >
          {loading ? <IconLoader size={14} className="spin" /> : <IconCheck size={14} />}
          {loading ? 'Fetching…' : 'Get info'}
        </button>
      </div>

      {error && <div className="msg-err">{error}</div>}

      {info && (
        <div className="preview">
          {info.thumbnail && (
            <img src={info.thumbnail} alt="" className="thumb" referrerPolicy="no-referrer" />
          )}
          <div className="preview-body">
            <div className="preview-title" title={info.title}>{info.title}</div>
            <div className="preview-meta">
              {info.uploader && <span>{info.uploader}</span>}
              {info.duration && <><span className="dot">·</span><span>{formatDuration(info.duration)}</span></>}
              {info.extractor && <><span className="dot">·</span><span className="src">{info.extractor}</span></>}
            </div>

            <div className="seg">
              <button
                className={`seg-opt${fmt === 'video' ? ' active' : ''}`}
                onClick={() => setFmt('video')}
              >
                <IconPlay size={14} /> Video MP4
              </button>
              <button
                className={`seg-opt${fmt === 'audio' ? ' active' : ''}`}
                onClick={() => setFmt('audio')}
              >
                <IconMusic size={14} /> Audio MP3
              </button>
            </div>

            <button
              className="primary-btn full"
              type="button"
              disabled={downloading}
              onClick={startDownload}
            >
              {downloading
                ? (<><IconLoader size={16} className="spin" /> Downloading…</>)
                : (<><IconDownload size={16} /> Download {fmt === 'video' ? 'video' : 'audio'}</>)
              }
            </button>
          </div>
        </div>
      )}
    </>
  );
}
