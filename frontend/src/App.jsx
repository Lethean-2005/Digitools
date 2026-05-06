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
const IconText = (p) => (
  <Icon {...p}>
    <path d="M4 6h16" />
    <path d="M4 12h10" />
    <path d="M4 18h16" />
  </Icon>
);
const IconCopy = (p) => (
  <Icon {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8v-2a2 2 0 0 0 -2 -2h-8a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h2" />
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
const IconLanguage = (p) => (
  <Icon {...p}>
    <path d="M4 5h7" /><path d="M9 3v2c0 4.418 -2.239 8 -5 8" />
    <path d="M5 9c0 2.144 2.952 3.908 6.7 4" />
    <path d="M12 20l4 -9l4 9" /><path d="M19.1 18h-6.2" />
  </Icon>
);
const IconMd = (p) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M7 15v-6l2 2l2 -2v6" /><path d="M14 13l2 2l2 -2" /><path d="M16 9v6" />
  </Icon>
);
const IconResize = (p) => (
  <Icon {...p}>
    <path d="M4 8v-4h4" /><path d="M20 16v4h-4" />
    <path d="M4 4l16 16" />
  </Icon>
);
const IconGif = (p) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M7 9v6" /><path d="M11 9h-2v6h2" /><path d="M11 12h-2" />
    <path d="M14 15v-6h2" /><path d="M14 12h2" />
  </Icon>
);
const IconPdfTool = (p) => (
  <Icon {...p}>
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M5 8v-3a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2h-3" />
    <path d="M3 13v6" /><path d="M7 13v6" /><path d="M3 16h4" />
  </Icon>
);

/* ── App shell ───────────────────────────────────────── */
const TOOLS = [
  { id: 'pdf',     label: 'PDF → Word',       desc: 'Convert PDF to Word',           Icon: IconCloudUpload },
  { id: 'pdfedit', label: 'PDF Tools',        desc: 'Merge / split / rotate PDFs',   Icon: IconPdfTool },
  { id: 'md',      label: 'Markdown → PDF',   desc: 'Render markdown text to a PDF', Icon: IconMd },
  { id: 'media',   label: 'Media Download',   desc: 'Download video/audio from URL', Icon: IconDownload },
  { id: 'gif',     label: 'Video → GIF',      desc: 'Make a short GIF from a clip',  Icon: IconGif },
  { id: 'remove',  label: 'Remove Background', desc: 'Cut out the background of any image', Icon: IconScissors },
  { id: 'emoji',   label: 'Create Emoji',     desc: 'Make a 128/256/512 px emoji from an image', Icon: IconSparkles },
  { id: 'ocr',     label: 'Extract Text',     desc: 'Pull text out of any image (OCR)', Icon: IconText },
  { id: 'imgedit', label: 'Image Edit',       desc: 'Compress, resize, or convert',   Icon: IconResize },
  { id: 'translate', label: 'Translate',      desc: 'Translate text between languages', Icon: IconLanguage },
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
        badge: '3',
        children: [
          { id: 'pdf',     label: 'PDF → Word' },
          { id: 'pdfedit', label: 'PDF Tools' },
          { id: 'md',      label: 'Markdown → PDF' },
        ],
      },
      {
        type: 'group',
        id: 'media-group',
        label: 'Media',
        Icon: IconDownload,
        badge: '3',
        children: [
          { id: 'media-video', label: 'Video Download', target: 'media' },
          { id: 'media-audio', label: 'Audio Download', target: 'media' },
          { id: 'gif',         label: 'Video → GIF' },
        ],
      },
      {
        type: 'group',
        id: 'images-group',
        label: 'Images',
        Icon: IconImage,
        badge: '4',
        children: [
          { id: 'remove',  label: 'Remove Background' },
          { id: 'emoji',   label: 'Create Emoji' },
          { id: 'ocr',     label: 'Extract Text' },
          { id: 'imgedit', label: 'Image Edit' },
        ],
      },
      {
        type: 'group',
        id: 'gen-group',
        label: 'Generators',
        Icon: IconSparkles,
        badge: '2',
        children: [
          { id: 'qr',        label: 'QR Generator' },
          { id: 'translate', label: 'Translate' },
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
  pdf:       { title: 'PDF → Word',        breadcrumb: ['Tools', 'Documents'] },
  pdfedit:   { title: 'PDF Tools',         breadcrumb: ['Tools', 'Documents'] },
  md:        { title: 'Markdown → PDF',    breadcrumb: ['Tools', 'Documents'] },
  media:     { title: 'Media Download',    breadcrumb: ['Tools', 'Media'] },
  gif:       { title: 'Video → GIF',       breadcrumb: ['Tools', 'Media'] },
  remove:    { title: 'Remove Background', breadcrumb: ['Tools', 'Images'] },
  emoji:     { title: 'Create Emoji',      breadcrumb: ['Tools', 'Images'] },
  ocr:       { title: 'Extract Text',      breadcrumb: ['Tools', 'Images'] },
  imgedit:   { title: 'Image Edit',        breadcrumb: ['Tools', 'Images'] },
  qr:        { title: 'QR Generator',      breadcrumb: ['Tools', 'Generators'] },
  translate: { title: 'Translate',         breadcrumb: ['Tools', 'Generators'] },
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
              {tab === 'ocr'       && <OCRPanel />}
              {tab === 'imgedit'   && <ImageEditPanel />}
              {tab === 'pdfedit'   && <PdfToolsPanel />}
              {tab === 'md'        && <MarkdownPdfPanel />}
              {tab === 'gif'       && <GifPanel />}
              {tab === 'translate' && <TranslatePanel />}
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

/* ── OCR (Image → Text) ───────────────────────────────── */
function OCRPanel() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lang, setLang] = useState('eng');
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);

  const reset = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null); setPreview(null); setText(''); setError(''); setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const setNewFile = (f) => {
    if (!f) return;
    setError('');
    if (!f.type.startsWith('image/')) { setError('Only image files are accepted.'); return; }
    if (f.size > IMG_MAX_BYTES)        { setError('Image exceeds 25 MB limit.');    return; }
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setText('');
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
      form.append('lang', lang);
      const r = await fetch(`${API_BASE}/image/ocr`, { method: 'POST', body: form });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `Failed (${r.status})`);
      setText((j.text || '').trim());
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (_) {
      setError('Could not copy to clipboard.');
    }
  };

  const downloadTxt = () => {
    if (!text) return;
    const base = (file?.name || 'extracted').replace(/\.[^.]+$/, '');
    triggerDownload(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${base}.txt`);
  };

  return (
    <>
      <div className="head">
        <div className="head-icon"><IconText size={20} strokeWidth={2.25} /></div>
        <div className="head-text">
          <h2>Extract Text</h2>
          <p>Drop an image — get the text it contains. Supports English and Khmer.</p>
        </div>
        <button
          className="ghost-btn"
          onClick={reset}
          aria-label="Clear"
          disabled={!file && !error && !text}
        ><IconX size={18} /></button>
      </div>

      {!file ? (
        <div
          className={`dropzone${dragOver ? ' drag' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <IconText size={32} strokeWidth={1.5} className="dz-icon" />
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
            <figcaption>Image</figcaption>
            <div className="img-thumb"><img src={preview} alt="" /></div>
          </figure>
          <figure>
            <figcaption>Text</figcaption>
            <div className="img-thumb" style={{ padding: 0, alignItems: 'stretch' }}>
              {text ? (
                <textarea
                  readOnly
                  value={text}
                  style={{
                    width: '100%', height: '100%', minHeight: 180,
                    border: 0, resize: 'none', padding: 12,
                    background: 'transparent', font: 'inherit', color: 'inherit',
                  }}
                />
              ) : busy ? (
                <span className="img-placeholder"><IconLoader size={20} className="spin" /> Working…</span>
              ) : (
                <span className="img-placeholder">Click "Extract" below</span>
              )}
            </div>
          </figure>
        </div>
      )}

      {file && (
        <div className="seg" style={{ marginTop: 12 }}>
          {[
            { v: 'eng',     label: 'English' },
            { v: 'khm',     label: 'Khmer' },
            { v: 'eng+khm', label: 'Both' },
          ].map((o) => (
            <button
              key={o.v}
              className={`seg-opt${lang === o.v ? ' active' : ''}`}
              onClick={() => setLang(o.v)}
            >
              {o.label}
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
          {text ? (
            <>
              <button className="browse-btn" onClick={copy}>
                <IconCopy size={14} /> {copied ? 'Copied!' : 'Copy'}
              </button>
              <button className="primary-btn" onClick={downloadTxt}>
                <IconDownload size={14} /> Download .txt
              </button>
            </>
          ) : (
            <button className="primary-btn" onClick={run} disabled={busy}>
              {busy
                ? <><IconLoader size={14} className="spin" /> Working…</>
                : <><IconText size={14} /> Extract text</>}
            </button>
          )}
        </div>
      )}
    </>
  );
}

/* ── Image Edit (compress / resize / convert) ────────── */
function ImageEditPanel() {
  const [mode, setMode] = useState('compress'); // compress | resize | convert
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [outBlob, setOutBlob] = useState(null);
  const [outName, setOutName] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [quality, setQuality] = useState(75);
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState('');
  const [target, setTarget] = useState('webp');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const reset = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null); setPreview(null); setOutBlob(null); setOutName(null);
    setError(''); setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const setNewFile = (f) => {
    if (!f) return;
    setError('');
    if (!f.type.startsWith('image/')) { setError('Only image files are accepted.'); return; }
    if (f.size > IMG_MAX_BYTES)        { setError('Image exceeds 25 MB.');           return; }
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setOutBlob(null); setOutName(null);
  };

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false);
    setNewFile(e.dataTransfer.files?.[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      let url;
      if (mode === 'compress') {
        url = `${API_BASE}/image/compress`;
        form.append('quality', String(Math.max(1, Math.min(100, Number(quality) || 75))));
      } else if (mode === 'resize') {
        url = `${API_BASE}/image/resize`;
        if (width)  form.append('width',  String(width));
        if (height) form.append('height', String(height));
      } else {
        url = `${API_BASE}/image/convert`;
        form.append('target', target);
      }
      const r = await fetch(url, { method: 'POST', body: form });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || `Failed (${r.status})`);
      }
      const blob = await r.blob();
      const fallback = (file.name.replace(/\.[^.]+$/, '') || 'image') +
        (mode === 'compress' ? '.jpg'
         : mode === 'resize' ? `-resized.${(blob.type.split('/')[1] || 'png').split(';')[0]}`
         : `.${target === 'jpeg' ? 'jpg' : target}`);
      const name = filenameFromContentDisposition(r.headers.get('Content-Disposition'), fallback);
      setOutBlob(blob); setOutName(name);
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };

  const download = () => { if (outBlob && outName) triggerDownload(outBlob, outName); };

  return (
    <>
      <div className="head">
        <div className="head-icon"><IconResize size={20} strokeWidth={2.25} /></div>
        <div className="head-text">
          <h2>Image Edit</h2>
          <p>Compress to JPEG, resize, or convert format. Up to 25 MB.</p>
        </div>
        <button className="ghost-btn" onClick={reset} aria-label="Clear" disabled={!file && !error}>
          <IconX size={18} />
        </button>
      </div>

      <div className="seg" style={{ marginBottom: 12 }}>
        {[
          { v: 'compress', label: 'Compress' },
          { v: 'resize',   label: 'Resize' },
          { v: 'convert',  label: 'Convert' },
        ].map((o) => (
          <button key={o.v} className={`seg-opt${mode === o.v ? ' active' : ''}`} onClick={() => { setMode(o.v); setOutBlob(null); }}>
            {o.label}
          </button>
        ))}
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
          <button className="browse-btn" type="button" onClick={() => inputRef.current?.click()}>Browse Image</button>
          <input ref={inputRef} type="file" accept="image/*" hidden
            onChange={(e) => { setNewFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      ) : (
        <div className="img-compare">
          <figure>
            <figcaption>Original — {formatSize(file.size)}</figcaption>
            <div className="img-thumb"><img src={preview} alt="" /></div>
          </figure>
          <figure>
            <figcaption>Result {outBlob ? `— ${formatSize(outBlob.size)}` : ''}</figcaption>
            <div className="img-thumb checker">
              {outBlob ? (
                <img src={URL.createObjectURL(outBlob)} alt="" />
              ) : busy ? (
                <span className="img-placeholder"><IconLoader size={20} className="spin" /> Working…</span>
              ) : (
                <span className="img-placeholder">Click run below</span>
              )}
            </div>
          </figure>
        </div>
      )}

      {file && (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          {mode === 'compress' && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Quality: <input type="range" min="1" max="100" value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
                <span style={{ width: 28 }}>{quality}</span>
              </label>
            </>
          )}
          {mode === 'resize' && (
            <>
              <label>Width <input type="number" min="1" value={width} onChange={(e) => setWidth(e.target.value)} style={{ width: 90 }} /></label>
              <label>Height <input type="number" min="1" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="auto" style={{ width: 90 }} /></label>
            </>
          )}
          {mode === 'convert' && (
            <div className="seg">
              {['png','jpg','webp','gif','bmp'].map((f) => (
                <button key={f} className={`seg-opt${target === f ? ' active' : ''}`} onClick={() => setTarget(f)}>{f.toUpperCase()}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <div className="msg-err">{error}</div>}

      {file && (
        <div className="img-actions">
          <button className="browse-btn" onClick={reset} disabled={busy}>Choose another</button>
          {outBlob ? (
            <button className="primary-btn" onClick={download}><IconDownload size={14} /> Download</button>
          ) : (
            <button className="primary-btn" onClick={run} disabled={busy}>
              {busy ? <><IconLoader size={14} className="spin" /> Working…</> : <><IconResize size={14} /> Run</>}
            </button>
          )}
        </div>
      )}
    </>
  );
}


/* ── PDF Tools (merge / split / rotate) ───────────────── */
function PdfToolsPanel() {
  const [mode, setMode] = useState('merge');
  const [files, setFiles] = useState([]);
  const [ranges, setRanges] = useState('1-3');
  const [degrees, setDegrees] = useState(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outBlob, setOutBlob] = useState(null);
  const [outName, setOutName] = useState(null);
  const inputRef = useRef(null);

  const reset = () => {
    setFiles([]); setError(''); setOutBlob(null); setOutName(null); setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onSelect = (list) => {
    setError('');
    const arr = Array.from(list || []);
    for (const f of arr) {
      if (!/\.pdf$/i.test(f.name)) { setError(`Not a PDF: ${f.name}`); return; }
      if (f.size > MAX_BYTES)      { setError(`${f.name} > 50 MB`);    return; }
    }
    if (mode === 'merge') setFiles((prev) => [...prev, ...arr]);
    else                  setFiles(arr.slice(0, 1));
    setOutBlob(null); setOutName(null);
  };

  const remove = (i) => setFiles((p) => p.filter((_, idx) => idx !== i));

  const run = async () => {
    if (!files.length) return;
    setBusy(true); setError('');
    try {
      const form = new FormData();
      let url, fallback;
      if (mode === 'merge') {
        if (files.length < 2) throw new Error('Select at least 2 PDFs.');
        files.forEach((f) => form.append('files', f, f.name));
        url = `${API_BASE}/pdf/merge`;
        fallback = 'merged.pdf';
      } else if (mode === 'split') {
        form.append('file', files[0], files[0].name);
        form.append('ranges', ranges);
        url = `${API_BASE}/pdf/split`;
        fallback = (files[0].name.replace(/\.pdf$/i, '') || 'split') + '.zip';
      } else {
        form.append('file', files[0], files[0].name);
        form.append('degrees', String(degrees));
        url = `${API_BASE}/pdf/rotate`;
        fallback = (files[0].name.replace(/\.pdf$/i, '') || 'rotated') + `-rot${degrees}.pdf`;
      }
      const r = await fetch(url, { method: 'POST', body: form });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || `Failed (${r.status})`);
      }
      const blob = await r.blob();
      const name = filenameFromContentDisposition(r.headers.get('Content-Disposition'), fallback);
      setOutBlob(blob); setOutName(name);
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="head">
        <div className="head-icon"><IconPdfTool size={20} strokeWidth={2.25} /></div>
        <div className="head-text">
          <h2>PDF Tools</h2>
          <p>Merge multiple PDFs, split by ranges, or rotate pages.</p>
        </div>
        <button className="ghost-btn" onClick={reset} aria-label="Clear" disabled={!files.length && !error}>
          <IconX size={18} />
        </button>
      </div>

      <div className="seg" style={{ marginBottom: 12 }}>
        {[
          { v: 'merge',  label: 'Merge' },
          { v: 'split',  label: 'Split' },
          { v: 'rotate', label: 'Rotate' },
        ].map((o) => (
          <button key={o.v} className={`seg-opt${mode === o.v ? ' active' : ''}`}
            onClick={() => { setMode(o.v); setFiles([]); setOutBlob(null); }}>
            {o.label}
          </button>
        ))}
      </div>

      <div className="dropzone">
        <IconFile size={32} strokeWidth={1.5} className="dz-icon" />
        <div className="dz-title">{mode === 'merge' ? 'Add 2 or more PDFs' : 'Choose 1 PDF'}</div>
        <div className="dz-hint">Up to 50 MB per file.</div>
        <button className="browse-btn" type="button" onClick={() => inputRef.current?.click()}>
          {mode === 'merge' ? 'Add PDFs' : 'Browse PDF'}
        </button>
        <input ref={inputRef} type="file" accept="application/pdf" multiple={mode === 'merge'} hidden
          onChange={(e) => { onSelect(e.target.files); e.target.value = ''; }} />
      </div>

      {files.length > 0 && (
        <ul style={{ marginTop: 12, listStyle: 'none', padding: 0 }}>
          {files.map((f, i) => (
            <li key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', borderBottom: '1px solid var(--border, #eee)' }}>
              <span>{f.name} <small>({formatSize(f.size)})</small></span>
              <button className="ghost-btn" onClick={() => remove(i)} aria-label="Remove"><IconTrash size={14} /></button>
            </li>
          ))}
        </ul>
      )}

      {mode === 'split' && files.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <label>Ranges <input value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="e.g. 1-3,5,7-10" style={{ width: 220 }} /></label>
        </div>
      )}
      {mode === 'rotate' && files.length > 0 && (
        <div className="seg" style={{ marginTop: 12 }}>
          {[90, 180, 270].map((d) => (
            <button key={d} className={`seg-opt${degrees === d ? ' active' : ''}`} onClick={() => setDegrees(d)}>{d}°</button>
          ))}
        </div>
      )}

      {error && <div className="msg-err">{error}</div>}

      {files.length > 0 && (
        <div className="img-actions">
          <button className="browse-btn" onClick={reset} disabled={busy}>Reset</button>
          {outBlob ? (
            <button className="primary-btn" onClick={() => triggerDownload(outBlob, outName)}>
              <IconDownload size={14} /> Download
            </button>
          ) : (
            <button className="primary-btn" onClick={run} disabled={busy || (mode === 'merge' && files.length < 2)}>
              {busy ? <><IconLoader size={14} className="spin" /> Working…</> : <><IconPdfTool size={14} /> Run</>}
            </button>
          )}
        </div>
      )}
    </>
  );
}


/* ── Markdown → PDF ─────────────────────────────────── */
function MarkdownPdfPanel() {
  const [text, setText] = useState('# Hello\n\nThis is **markdown**.\n\n- Item 1\n- Item 2\n');
  const [title, setTitle] = useState('Document');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    if (!text.trim()) return;
    setBusy(true); setError('');
    try {
      const r = await fetch(`${API_BASE}/doc/md2pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, title }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || `Failed (${r.status})`);
      }
      const blob = await r.blob();
      const fallback = (title || 'document').replace(/[^A-Za-z0-9._-]+/g, '_') + '.pdf';
      const name = filenameFromContentDisposition(r.headers.get('Content-Disposition'), fallback);
      triggerDownload(blob, name);
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="head">
        <div className="head-icon"><IconMd size={20} strokeWidth={2.25} /></div>
        <div className="head-text">
          <h2>Markdown → PDF</h2>
          <p>Paste markdown, get a PDF. Supports headings, lists, tables, code blocks.</p>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        <label>Title <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: '100%', maxWidth: 320 }} /></label>
        <label>Markdown
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={14}
            style={{ width: '100%', fontFamily: 'monospace', resize: 'vertical', padding: 8 }} />
        </label>
      </div>
      {error && <div className="msg-err">{error}</div>}
      <div className="img-actions">
        <button className="primary-btn" onClick={run} disabled={busy || !text.trim()}>
          {busy ? <><IconLoader size={14} className="spin" /> Rendering…</> : <><IconDownload size={14} /> Render PDF</>}
        </button>
      </div>
    </>
  );
}


/* ── Video → GIF ───────────────────────────────────── */
function GifPanel() {
  const [file, setFile] = useState(null);
  const [start, setStart] = useState(0);
  const [duration, setDuration] = useState(5);
  const [width, setWidth] = useState(480);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outBlob, setOutBlob] = useState(null);
  const [outName, setOutName] = useState(null);
  const inputRef = useRef(null);

  const reset = () => {
    setFile(null); setOutBlob(null); setOutName(null); setError(''); setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const setNew = (f) => {
    if (!f) return;
    setError('');
    if (!f.type.startsWith('video/')) { setError('Send a video file.'); return; }
    if (f.size > 50 * 1024 * 1024)    { setError('Video exceeds 50 MB.'); return; }
    setFile(f); setOutBlob(null); setOutName(null);
  };

  const run = async () => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('start',    String(start));
      form.append('duration', String(duration));
      form.append('width',    String(width));
      const r = await fetch(`${API_BASE}/media/gif`, { method: 'POST', body: form });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || `Failed (${r.status})`);
      }
      const blob = await r.blob();
      const name = (file.name.replace(/\.[^.]+$/, '') || 'clip') + '.gif';
      setOutBlob(blob); setOutName(name);
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="head">
        <div className="head-icon"><IconGif size={20} strokeWidth={2.25} /></div>
        <div className="head-text">
          <h2>Video → GIF</h2>
          <p>Make a short GIF from a clip. Up to 30s, 50 MB input.</p>
        </div>
        <button className="ghost-btn" onClick={reset} aria-label="Clear" disabled={!file && !error}>
          <IconX size={18} />
        </button>
      </div>

      {!file ? (
        <div className="dropzone" onClick={() => inputRef.current?.click()} style={{ cursor: 'pointer' }}>
          <IconGif size={32} strokeWidth={1.5} className="dz-icon" />
          <div className="dz-title">Choose a video</div>
          <div className="dz-hint">MP4, MOV, WEBM — up to 50 MB.</div>
          <button className="browse-btn" type="button" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>Browse Video</button>
          <input ref={inputRef} type="file" accept="video/*" hidden
            onChange={(e) => { setNew(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <p>{file.name} <small>({formatSize(file.size)})</small></p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
            <label>Start (s) <input type="number" min="0" step="0.5" value={start} onChange={(e) => setStart(Number(e.target.value))} style={{ width: 90 }} /></label>
            <label>Duration (s) <input type="number" min="1" max="30" value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={{ width: 90 }} /></label>
            <label>Width (px) <input type="number" min="64" max="1280" value={width} onChange={(e) => setWidth(Number(e.target.value))} style={{ width: 90 }} /></label>
          </div>
          {outBlob && (
            <div style={{ marginTop: 12 }}>
              <img src={URL.createObjectURL(outBlob)} alt="GIF preview" style={{ maxWidth: '100%', borderRadius: 8 }} />
            </div>
          )}
        </div>
      )}

      {error && <div className="msg-err">{error}</div>}

      {file && (
        <div className="img-actions">
          <button className="browse-btn" onClick={reset} disabled={busy}>Reset</button>
          {outBlob ? (
            <button className="primary-btn" onClick={() => triggerDownload(outBlob, outName)}>
              <IconDownload size={14} /> Download GIF
            </button>
          ) : (
            <button className="primary-btn" onClick={run} disabled={busy}>
              {busy ? <><IconLoader size={14} className="spin" /> Rendering…</> : <><IconGif size={14} /> Make GIF</>}
            </button>
          )}
        </div>
      )}
    </>
  );
}


/* ── Translate ─────────────────────────────────────── */
const TR_LANGS = [
  { code: 'auto', label: 'Auto-detect' },
  { code: 'en',   label: 'English' },
  { code: 'km',   label: 'Khmer' },
  { code: 'zh-CN', label: 'Chinese (Simplified)' },
  { code: 'zh-TW', label: 'Chinese (Traditional)' },
  { code: 'th',   label: 'Thai' },
  { code: 'vi',   label: 'Vietnamese' },
  { code: 'fr',   label: 'French' },
  { code: 'es',   label: 'Spanish' },
  { code: 'de',   label: 'German' },
  { code: 'ja',   label: 'Japanese' },
  { code: 'ko',   label: 'Korean' },
];

function TranslatePanel() {
  const [text, setText] = useState('');
  const [target, setTarget] = useState('km');
  const [source, setSource] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [out, setOut] = useState('');
  const [engine, setEngine] = useState('');

  const run = async () => {
    if (!text.trim()) return;
    setBusy(true); setError(''); setOut('');
    try {
      const r = await fetch(`${API_BASE}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, target, source }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `Failed (${r.status})`);
      setOut(j.text || ''); setEngine(j.engine || '');
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };

  const copy = async () => {
    if (!out) return;
    try { await navigator.clipboard.writeText(out); } catch (_) {}
  };

  const swap = () => {
    if (source === 'auto') return;
    setSource(target); setTarget(source);
    setText(out); setOut('');
  };

  return (
    <>
      <div className="head">
        <div className="head-icon"><IconLanguage size={20} strokeWidth={2.25} /></div>
        <div className="head-text">
          <h2>Translate</h2>
          <p>Translate text between languages. Up to 5,000 characters.</p>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginTop: 8 }}>
        <label>From
          <select value={source} onChange={(e) => setSource(e.target.value)} style={{ display: 'block', minWidth: 180 }}>
            {TR_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
        <button className="ghost-btn" type="button" onClick={swap} disabled={source === 'auto'} title="Swap languages">⇄</button>
        <label>To
          <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ display: 'block', minWidth: 180 }}>
            {TR_LANGS.filter((l) => l.code !== 'auto').map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10}
          placeholder="Type or paste text…" style={{ width: '100%', resize: 'vertical', padding: 8 }} />
        <textarea value={out} readOnly rows={10}
          placeholder={busy ? 'Translating…' : 'Translation appears here'} style={{ width: '100%', resize: 'vertical', padding: 8, background: 'rgba(127,127,127,0.06)' }} />
      </div>
      {error && <div className="msg-err">{error}</div>}
      <div className="img-actions">
        <button className="primary-btn" onClick={run} disabled={busy || !text.trim()}>
          {busy ? <><IconLoader size={14} className="spin" /> Translating…</> : <><IconLanguage size={14} /> Translate</>}
        </button>
        {out && (
          <button className="browse-btn" onClick={copy}><IconCopy size={14} /> Copy</button>
        )}
        {engine && <small style={{ alignSelf: 'center', opacity: 0.6 }}>via {engine}</small>}
      </div>
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
