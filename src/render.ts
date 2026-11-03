import { createHash } from 'crypto';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';
import type { Heading, ImagePayload, MiniCell, MiniOutput, MiniOutputItem, RenderOptions, RenderedCell } from './model';

const md = new MarkdownIt({ html: true, linkify: false, breaks: false });
const decoder = new TextDecoder();

const MIME_ERROR = 'application/vnd.code.notebook.error';
const MIME_STDOUT = 'application/vnd.code.notebook.stdout';
const MIME_STDERR = 'application/vnd.code.notebook.stderr';
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml'];

/** Rich-to-plain order used to pick one representation per output. */
const PRIORITY = [
  MIME_ERROR,
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
  'text/html',
  'text/markdown',
  'text/latex',
  // Interactive outputs VS Code draws large; prefer a sized placeholder over
  // their one-line text/plain fallback so the proportions stay right.
  'application/vnd.plotly.v1+json',
  'application/vnd.jupyter.widget-view+json',
  'application/vnd.vegalite.v5+json',
  'application/vnd.vegalite.v4+json',
  'application/vnd.vega.v5+json',
  MIME_STDOUT,
  MIME_STDERR,
  'text/plain',
];

/** Mime types we cannot draw, with the rough height VS Code gives them. */
const PLACEHOLDER_HEIGHTS: Record<string, number> = {
  'application/vnd.plotly.v1+json': 450,
  'application/vnd.jupyter.widget-view+json': 60,
  'application/vnd.vegalite.v4+json': 300,
  'application/vnd.vegalite.v5+json': 300,
  'application/vnd.vega.v5+json': 300,
};

const PLACEHOLDER_LABELS: Record<string, string> = {
  'application/vnd.plotly.v1+json': 'Plotly figure',
  'application/vnd.jupyter.widget-view+json': 'Interactive widget',
  'application/vnd.vegalite.v4+json': 'Vega-Lite chart',
  'application/vnd.vegalite.v5+json': 'Vega-Lite chart',
  'application/vnd.vega.v5+json': 'Vega chart',
};

// ---------------------------------------------------------------- helpers

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

/** Small bounded cache so re-rendering after each keystroke stays cheap. */
class Cache<V> {
  private map = new Map<string, V>();
  constructor(private max: number) {}
  get(key: string, make: () => V): V {
    const hit = this.map.get(key);
    if (hit !== undefined) {
      this.map.delete(key);
      this.map.set(key, hit);
      return hit;
    }
    const value = make();
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    return value;
  }
}

const codeCache = new Cache<string>(1000);

/** VS Code's stable API has no output ids, so images are keyed by content. */
const hashCache = new WeakMap<Uint8Array, string>();
function contentId(mime: string, data: Uint8Array): string {
  let hash = hashCache.get(data);
  if (!hash) {
    hash = createHash('sha1').update(data).digest('hex');
    hashCache.set(data, hash);
  }
  return `${mime}:${hash}`;
}
const mdCache = new Cache<string>(1000);

function highlight(source: string, language: string): string {
  return codeCache.get(language + '\u0000' + source, () => {
    if (language && hljs.getLanguage(language)) {
      try {
        return hljs.highlight(source, { language, ignoreIllegals: true }).value;
      } catch {
        /* fall through */
      }
    }
    return escapeHtml(source);
  });
}

function renderMarkdown(source: string): string {
  return mdCache.get(source, () => md.render(source));
}

const headingCache = new Cache<Heading[]>(1000);

/** Headings of a Markdown cell, as plain text (ignores `#` inside code fences). */
export function extractHeadings(source: string): Heading[] {
  return headingCache.get(source, () => {
    const tokens = md.parse(source, {});
    const out: Heading[] = [];
    tokens.forEach((t, i) => {
      if (t.type !== 'heading_open') return;
      const inline = tokens[i + 1];
      const text = (inline?.children ?? [])
        .filter((c) => c.type === 'text' || c.type === 'code_inline')
        .map((c) => c.content)
        .join('')
        .trim();
      if (text) out.push({ level: Number(t.tag.slice(1)), text });
    });
    return out;
  });
}

function limitLines(text: string, limit: number): { text: string; hidden: number } {
  const lines = text.replace(/\n$/, '').split('\n');
  if (limit > 0 && lines.length > limit) {
    return { text: lines.slice(0, limit).join('\n'), hidden: lines.length - limit };
  }
  return { text: lines.join('\n'), hidden: 0 };
}

// ------------------------------------------------------------ image sizes

interface Size {
  w: number;
  h: number;
}

export function imageSize(mime: string, data: Uint8Array): Size | undefined {
  try {
    if (mime === 'image/png' && data.length > 24 && data[0] === 0x89 && data[1] === 0x50) {
      const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
      return { w: v.getUint32(16), h: v.getUint32(20) };
    }
    if (mime === 'image/gif' && data.length > 10) {
      const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
      return { w: v.getUint16(6, true), h: v.getUint16(8, true) };
    }
    if (mime === 'image/jpeg') {
      return jpegSize(data);
    }
    if (mime === 'image/svg+xml') {
      const head = decoder.decode(data.subarray(0, 4096));
      const tag = /<svg\b[^>]*>/i.exec(head)?.[0];
      if (!tag) return undefined;
      const num = (name: string) => {
        const m = new RegExp(`\\b${name}\\s*=\\s*["']\\s*([0-9.]+)(px|pt)?\\s*["']`, 'i').exec(tag);
        if (!m) return undefined;
        return parseFloat(m[1]) * (m[2] === 'pt' ? 4 / 3 : 1);
      };
      let w = num('width');
      let h = num('height');
      const vb = /\bviewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i.exec(tag);
      if ((w === undefined || h === undefined) && vb) {
        w = w ?? parseFloat(vb[1]);
        h = h ?? parseFloat(vb[2]);
      }
      if (w && h) return { w: Math.round(w), h: Math.round(h) };
    }
  } catch {
    /* unreadable header: let the browser size it */
  }
  return undefined;
}

function jpegSize(d: Uint8Array): Size | undefined {
  if (d[0] !== 0xff || d[1] !== 0xd8) return undefined;
  let i = 2;
  while (i + 9 < d.length) {
    if (d[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = d[i + 1];
    const len = (d[i + 2] << 8) | d[i + 3];
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { h: (d[i + 5] << 8) | d[i + 6], w: (d[i + 7] << 8) | d[i + 8] };
    }
    i += 2 + len;
  }
  return undefined;
}

/** Jupyter stores e.g. `{ "image/png": { width, height } }` for retina plots. */
function metadataSize(output: MiniOutput, mime: string): Size | undefined {
  const meta = output.metadata as Record<string, any> | undefined;
  const candidates = [meta?.[mime], meta?.metadata?.[mime]];
  for (const c of candidates) {
    if (c && typeof c.width === 'number' && typeof c.height === 'number') {
      return { w: c.width, h: c.height };
    }
    if (c && typeof c.width === 'number') {
      return { w: c.width, h: NaN };
    }
  }
  return undefined;
}

// ------------------------------------------------- embedded data images

const DATA_URI_RE = /data:image\/[a-z+]+;base64,[A-Za-z0-9+/=\s]+/g;
const DATA_IMG_RE =
  /<img\b([^>]*?)\bsrc\s*=\s*(["'])data:(image\/(?:png|jpeg|gif|svg\+xml));base64,([A-Za-z0-9+/=\s]+)\2([^>]*)>/gi;
const SIZE_ATTR_RE = /\b(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

/**
 * Replaces `<img src="data:image/...">` in HTML outputs with references to
 * image payloads, so large plots (ipympl, pandas Styler, HTML reports) are sent
 * to the webview once, by content hash, with a known size.
 */
export function extractDataImages(html: string, images: ImagePayload[]): string {
  return html.replace(DATA_IMG_RE, (_all, before: string, _q, mime: string, b64: string, after: string) => {
    const data = new Uint8Array(Buffer.from(b64, 'base64'));
    const id = contentId(mime, data);
    images.push({ id, mime, data });

    const attrs = `${before} ${after}`.replace(/\/\s*$/, '');
    const attr = (name: string) => {
      const m = new RegExp(`\\b${name}\\s*=\\s*["']?\\s*([0-9.]+)`, 'i').exec(attrs);
      return m ? parseFloat(m[1]) : NaN;
    };
    let w = attr('width');
    let h = attr('height');
    const natural = imageSize(mime, data);
    if (natural) {
      if (Number.isNaN(w) && Number.isNaN(h)) {
        w = natural.w;
        h = natural.h;
      } else if (Number.isNaN(h)) {
        h = (natural.h * w) / natural.w;
      } else if (Number.isNaN(w)) {
        w = (natural.w * h) / natural.h;
      }
    }
    const dims = w > 0 && h > 0 ? ` width="${Math.round(w)}" height="${Math.round(h)}"` : '';
    const rest = attrs.replace(SIZE_ATTR_RE, '').replace(/\s*\/\s*$/, '').trim();
    return `<img data-img="${escapeHtml(id)}"${dims}${rest ? ' ' + rest : ''}>`;
  });
}

// ---------------------------------------------------------------- outputs

function pickItem(output: MiniOutput, opts: RenderOptions): MiniOutputItem | undefined {
  const byMime = new Map(output.items.map((i) => [i.mime, i]));
  for (const mime of PRIORITY) {
    const item = byMime.get(mime);
    if (!item) continue;
    if (mime === 'text/html') {
      // Embedded images (e.g. ipympl's static snapshot) are extracted later,
      // so they don't count towards the size limit.
      const tooBig = decoder.decode(item.data).replace(DATA_URI_RE, '').length > opts.maxHtmlChars;
      if ((!opts.renderHtml || tooBig) && byMime.has('text/plain')) continue;
    }
    return item;
  }
  return output.items[0];
}

function renderOutput(output: MiniOutput, opts: RenderOptions, images: ImagePayload[]): string {
  const item = pickItem(output, opts);
  if (!item) return '';
  const { mime } = item;

  if (IMAGE_MIMES.includes(mime)) {
    const id = contentId(mime, item.data);
    // VS Code hands outputs over as Node Buffers. A Buffer would be turned into
    // {type: 'Buffer', data: [...]} by JSON.stringify before VS Code's binary
    // transfer sees it, so send a plain Uint8Array copy instead.
    images.push({ id, mime, data: new Uint8Array(item.data) });
    const natural = imageSize(mime, item.data);
    const meta = metadataSize(output, mime);
    let size = natural;
    if (meta && natural) {
      size = { w: meta.w, h: Number.isNaN(meta.h) ? Math.round((natural.h * meta.w) / natural.w) : meta.h };
    }
    const dims = size ? ` width="${size.w}" height="${size.h}"` : '';
    return `<div class="out out-image"><img data-img="${escapeHtml(id)}"${dims} alt=""></div>`;
  }

  const text = () => decoder.decode(item.data);

  switch (mime) {
    case MIME_ERROR: {
      let err: { name?: string; message?: string; stack?: string } = {};
      try {
        err = JSON.parse(text());
      } catch {
        err = { message: text() };
      }
      const body = err.stack ? stripAnsi(err.stack) : `${err.name ?? 'Error'}: ${err.message ?? ''}`;
      const { text: shown, hidden } = limitLines(body, 200);
      return `<div class="out out-error"><pre>${escapeHtml(shown)}</pre>${moreLines(hidden)}</div>`;
    }
    case MIME_STDOUT:
    case MIME_STDERR:
    case 'text/plain':
    case 'text/latex': {
      const { text: shown, hidden } = limitLines(stripAnsi(text()), opts.textLineLimit);
      const cls = mime === MIME_STDERR ? 'out out-text out-stderr' : 'out out-text';
      return `<div class="${cls}"><pre>${escapeHtml(shown)}</pre>${moreLines(hidden)}</div>`;
    }
    case 'text/html':
      // Sanitised in the webview, and the webview's CSP blocks scripts anyway.
      return `<div class="out out-html">${extractDataImages(text(), images)}</div>`;
    case 'text/markdown':
      return `<div class="out out-md md">${renderMarkdown(text())}</div>`;
    default: {
      const height = PLACEHOLDER_HEIGHTS[mime] ?? 40;
      const label = PLACEHOLDER_LABELS[mime] ?? mime;
      return `<div class="out out-placeholder" style="height:${height}px">${escapeHtml(label)}</div>`;
    }
  }
}

function moreLines(hidden: number): string {
  return hidden > 0 ? `<div class="out-trunc">… ${hidden} more line${hidden === 1 ? '' : 's'}</div>` : '';
}

// ------------------------------------------------------------------ cells

export function renderCell(cell: MiniCell, opts: RenderOptions): RenderedCell {
  if (cell.kind === 'markup') {
    const html = cell.source.trim()
      ? `<div class="md">${renderMarkdown(cell.source)}</div>`
      : '<div class="md md-empty"></div>';
    return { kind: 'markup', html, images: [], headings: extractHeadings(cell.source) };
  }

  const images: ImagePayload[] = [];
  const count = cell.executionCount ?? ' ';
  const code = highlight(cell.source, cell.language);
  const outputs = cell.outputs.map((o) => renderOutput(o, opts, images)).join('');

  const html =
    `<div class="input"><div class="gutter">[${count}]</div>` +
    `<pre class="code"><code>${code || ' '}</code></pre></div>` +
    (outputs ? `<div class="outputs">${outputs}</div>` : '');

  return { kind: 'code', html, images, headings: [] };
}
