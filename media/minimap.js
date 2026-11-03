// Webview side of the Notebook Minimap. Receives pre-rendered cell HTML from
// the extension, lays it out at notebook width, scales it down to the panel
// (optionally flowing into several columns), marks the cells visible in the
// editor and the selected cell, and shows the current section's headings.
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const scroller = $('scroller');
  const stage = $('stage');
  const spacer = $('spacer');
  const sticky = $('sticky');
  const badge = $('badge');
  const root = document.documentElement;

  const PAD = 4; // inset of the columns inside the view
  const GAP = 6; // between columns
  const FOLLOW_PAUSE_MS = 2000;
  const MAX_HEADING_LINES = 4;
  const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12];

  // factor 0 = fill the panel width
  let cfg = { factor: 0, viewportHeight: 1000, contentWidth: 1000, showHeadings: true, columns: 1, headingSize: 12,
    headingMaxLines: 2, markdownTextSize: 0, headingStripFontSize: 12 };
  let scale = 1;
  /** Height of one column in screen px, and how far the strip can scroll. */
  let colHeight = 100;
  let colWidth = 100;
  let maxScroll = 0;
  /** True when the width, not the zoom factor, limits the scale. */
  let fitted = true;

  /** The original rendered notebook; columns 2.. show clones of it. */
  const doc = document.createElement('div');
  doc.className = 'doc';
  /** [{ col, strip, page, box, sel }] */
  let columns = [];
  let clonesStale = true;
  let cellEls = [];
  let cellHtml = [];
  let headings = [];
  let viewport = null;
  /** image id -> blob: URL */
  const blobs = new Map();
  /** image id -> byte length, for error reports */
  const sizes = new Map();
  const reported = new Set();

  // ------------------------------------------------------------ messages

  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg && msg.type) {
      case 'config':
        applyConfig(msg);
        break;
      case 'reset':
        reset();
        break;
      case 'images':
        addImages(msg.images);
        break;
      case 'render':
        headings = msg.headings || [];
        stickyKey = null;
        render(msg.cells, msg.usedImages);
        break;
      case 'viewport':
        viewport = msg;
        updateMarks(false);
        break;
      case 'zoom':
        zoom(msg.direction);
        break;
    }
  });

  function applyConfig(m) {
    cfg = Object.assign({}, cfg, m);
    if (m.fontFamily) root.style.setProperty('--mm-code-font', m.fontFamily);
    if (m.fontSize) root.style.setProperty('--mm-code-size', m.fontSize + 'px');
    if (m.lineHeight) root.style.setProperty('--mm-code-line', m.lineHeight + 'px');
    if (m.markupFontSize) root.style.setProperty('--mm-md-size', m.markupFontSize + 'px');
    root.style.setProperty('--mm-h-lines', String(cfg.headingMaxLines > 0 ? cfg.headingMaxLines : 'none'));
    root.style.setProperty('--mm-strip-size', (cfg.headingStripFontSize || 12) + 'px');
    document.body.classList.toggle('clamp-headings', cfg.headingMaxLines > 0);
    stickyKey = null;
    scheduleLayout(true);
  }

  function reset() {
    for (const url of blobs.values()) URL.revokeObjectURL(url);
    blobs.clear();
    doc.textContent = '';
    clonesStale = true;
    cellEls = [];
    cellHtml = [];
    headings = [];
    viewport = null;
    stickyKey = null;
    placed = false;
    for (const c of columns) {
      c.box.hidden = true;
      c.sel.textContent = '';
    }
    sticky.hidden = true;
    scroller.scrollTop = 0;
    document.body.classList.remove('has-cells');
  }

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (Array.isArray(data)) return Uint8Array.from(data);
    // A Node Buffer serialised to JSON
    if (data && data.type === 'Buffer' && Array.isArray(data.data)) return Uint8Array.from(data.data);
    if (data && typeof data === 'object') return Uint8Array.from(Object.values(data));
    return new Uint8Array();
  }

  function addImages(images) {
    for (const img of images || []) {
      const old = blobs.get(img.id);
      if (old) URL.revokeObjectURL(old);
      const bytes = toBytes(img.data);
      sizes.set(img.id, bytes.length);
      blobs.set(img.id, URL.createObjectURL(new Blob([bytes], { type: img.mime })));
    }
  }

  // -------------------------------------------------------------- render

  function render(cells, usedImages) {
    const used = new Set(usedImages || []);
    for (const [id, url] of blobs) {
      if (!used.has(id)) {
        URL.revokeObjectURL(url);
        blobs.delete(id);
      }
    }

    cells.forEach((cell, i) => {
      let el = cellEls[i];
      if (!el) {
        el = document.createElement('div');
        el.dataset.index = String(i);
        doc.appendChild(el);
        cellEls[i] = el;
        cellHtml[i] = null;
      }
      if (cellHtml[i] !== cell.html || el.dataset.kind !== cell.kind) {
        el.className = 'cell cell-' + cell.kind;
        el.dataset.kind = cell.kind;
        el.replaceChildren(sanitize(cell.html));
        cellHtml[i] = cell.html;
      }
      attachImages(el);
    });

    while (cellEls.length > cells.length) {
      cellEls.pop().remove();
      cellHtml.pop();
    }

    clonesStale = true;
    document.body.classList.toggle('has-cells', cells.length > 0);
    scheduleLayout(false);
  }

  function attachImages(el) {
    for (const img of el.querySelectorAll('img[data-img]')) {
      const url = blobs.get(img.dataset.img);
      if (url && img.getAttribute('src') !== url) img.src = url;
    }
  }

  const BLOCKED = new Set([
    'SCRIPT', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE',
    'STYLE', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'NOSCRIPT', 'TEMPLATE',
    'AUDIO', 'VIDEO',
  ]);
  const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction']);

  /** Markdown and HTML outputs are untrusted; the CSP blocks scripts as well. */
  function sanitize(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT);
    const doomed = [];
    let node;
    while ((node = walker.nextNode())) {
      const tag = node.tagName.toUpperCase();
      if (BLOCKED.has(tag)) {
        doomed.push(node);
        continue;
      }
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) node.removeAttribute(attr.name);
        else if (URL_ATTRS.has(name) && /^\s*javascript:/i.test(attr.value)) node.removeAttribute(attr.name);
      }
      // A click anywhere in the minimap navigates; links must not open.
      if (tag === 'A') node.removeAttribute('href');
    }
    doomed.forEach((n) => n.remove());
    return tpl.content;
  }

  // -------------------------------------------------------------- layout

  let layoutQueued = false;
  let layoutInstant = false;

  function scheduleLayout(instant) {
    layoutInstant = layoutInstant || !!instant;
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(() => {
      layoutQueued = false;
      const instantNow = layoutInstant;
      layoutInstant = false;
      layout(instantNow);
    });
  }

  function columnCount() {
    return Math.max(1, Math.min(6, Math.round(cfg.columns || 1)));
  }

  /** Uses the whole view height, so the heading strip doesn't change the zoom. */
  function zoomHeight() {
    return Math.max(40, document.body.clientHeight - 2 * PAD);
  }

  function ensureColumns(n) {
    if (columns.length !== n) {
      stage.textContent = '';
      columns = [];
      for (let k = 0; k < n; k++) {
        const col = document.createElement('div');
        col.className = 'col';
        const strip = document.createElement('div');
        strip.className = 'strip';
        const box = document.createElement('div');
        box.className = 'box';
        box.hidden = true;
        const sel = document.createElement('div');
        strip.append(k === 0 ? doc : document.createElement('div'), box, sel);
        col.appendChild(strip);
        stage.appendChild(col);
        columns.push({ col, strip, page: strip.firstChild, box, sel });
      }
      clonesStale = true;
    }
    if (clonesStale) {
      for (const c of columns.slice(1)) {
        const clone = doc.cloneNode(true);
        c.strip.replaceChild(clone, c.page);
        c.page = clone;
      }
      clonesStale = false;
    }
  }

  function layout(instant) {
    const n = columnCount();
    const viewH = Math.max(40, scroller.clientHeight);
    const availW = Math.max(40, scroller.clientWidth - 2 * PAD);
    const slotW = Math.max(20, (availW - (n - 1) * GAP) / n);
    colHeight = Math.max(20, viewH - 2 * PAD);

    // factor 0: fill the column width; otherwise show factor × editor height
    // spread over all columns. Never wider than a column: a cropped notebook
    // (only the left third of each cell) is useless, especially in columns.
    const fitScale = slotW / cfg.contentWidth;
    const factorScale = cfg.factor > 0 ? (n * zoomHeight()) / (cfg.factor * cfg.viewportHeight) : Infinity;
    scale = Math.max(0.02, Math.min(fitScale, factorScale, 3));
    fitted = factorScale >= fitScale;

    // Sizes given in screen pixels become notebook pixels divided by the zoom.
    const big = cfg.headingSize > 0;
    document.body.classList.toggle('big-headings', big);
    if (big) root.style.setProperty('--mm-h-base', cfg.headingSize / scale + 'px');
    const bigText = cfg.markdownTextSize > 0;
    document.body.classList.toggle('big-text', bigText);
    if (bigText) root.style.setProperty('--mm-t-base', cfg.markdownTextSize / scale + 'px');

    ensureColumns(n);

    colWidth = Math.min(cfg.contentWidth * scale, slotW);
    const groupW = n * colWidth + (n - 1) * GAP;
    const left0 = PAD + Math.max(0, (availW - groupW) / 2);
    columns.forEach((c, k) => {
      c.page.style.width = cfg.contentWidth + 'px';
      c.page.style.transform = 'scale(' + scale + ')';
      c.col.style.left = left0 + k * (colWidth + GAP) + 'px';
      c.col.style.top = PAD + 'px';
      c.col.style.width = colWidth + 'px';
      c.col.style.height = colHeight + 'px';
    });

    stage.style.height = viewH + 'px';
    maxScroll = Math.max(0, doc.offsetHeight * scale - n * colHeight);
    spacer.style.height = maxScroll + 'px';
    applyScroll();
    updateBadge();
    updateMarks(instant);
  }

  /** Column k shows the strip from scrollTop + k × column height. */
  function applyScroll() {
    const top = Math.min(scroller.scrollTop, maxScroll);
    columns.forEach((c, k) => {
      c.strip.style.transform = 'translateY(' + -(top + k * colHeight) + 'px)';
    });
  }

  function effectiveFactor() {
    return (columnCount() * zoomHeight()) / (scale * cfg.viewportHeight);
  }

  function formatFactor(f) {
    return (f >= 10 ? Math.round(f) : Math.round(f * 10) / 10) + '×';
  }

  function updateBadge() {
    const prefix = columnCount() > 1 ? columnCount() + ' cols · ' : '';
    if (cfg.factor > 0 && !fitted) {
      badge.textContent = prefix + formatFactor(cfg.factor);
      badge.title = 'Shows about ' + formatFactor(cfg.factor) + ' the editor height. Click to fit the panel width.';
      badge.classList.add('clickable');
    } else {
      badge.textContent = prefix + 'fit · ' + formatFactor(effectiveFactor());
      badge.title = 'Fills the panel width (about ' + formatFactor(effectiveFactor()) + ' the editor height). Zoom with Ctrl/Cmd + scroll.';
      badge.classList.toggle('clickable', cfg.factor > 0);
    }
  }

  function zoom(direction) {
    const current = effectiveFactor();
    let next;
    if (direction > 0) {
      next = ZOOM_STEPS.find((s) => s > current * 1.05);
      if (next === undefined) next = ZOOM_STEPS[ZOOM_STEPS.length - 1];
    } else {
      next = ZOOM_STEPS.slice().reverse().find((s) => s < current / 1.05);
      if (next === undefined) next = ZOOM_STEPS[0];
    }
    vscode.postMessage({ type: 'setFactor', value: next });
  }

  // ------------------------------------------- viewport, selection, headings

  function updateMarks(instant) {
    const ranges = ((viewport && viewport.ranges) || []).filter((r) => r.end > r.start);
    let first = -1;
    let last = -1;
    if (ranges.length && cellEls.length) {
      first = Math.min(...ranges.map((r) => r.start));
      last = Math.min(cellEls.length - 1, Math.max(...ranges.map((r) => r.end)) - 1);
    }

    const selected = selectedIndices();
    drawSelection(selected);

    // Headings follow the selected cell when it is on screen (like VS Code's
    // breadcrumbs), otherwise the top of the editor.
    const selectionOnScreen = selected.length > 0 && first >= 0 && selected[0] >= first && selected[0] <= last;
    let anchor = first;
    if (selected.length && (first < 0 || selectionOnScreen)) anchor = selected[0];
    drawHeadings(anchor);

    if (first < 0 || first > last || !cellEls[first]) {
      for (const c of columns) c.box.hidden = true;
      return;
    }
    const top = cellEls[first].offsetTop * scale;
    const bottom = (cellEls[last].offsetTop + cellEls[last].offsetHeight) * scale;
    // Every column has its own copy; the column clips it, so a box crossing a
    // column break shows at the bottom of one column and the top of the next.
    for (const c of columns) {
      c.box.hidden = false;
      c.box.style.top = top - 2 + 'px';
      c.box.style.height = bottom - top + 4 + 'px';
      c.box.style.width = colWidth + 'px';
    }
    const firstPlacement = !placed;
    placed = true;

    // The first visible cell can be huge and mostly scrolled past, so keep the
    // selected cell in view when it is on screen, else the middle of the box.
    if (selectionOnScreen) {
      const cell = cellEls[selected[0]];
      follow(cell.offsetTop * scale, (cell.offsetTop + cell.offsetHeight) * scale, instant || firstPlacement);
    } else {
      follow(top, bottom, instant || firstPlacement);
    }
  }

  function selectedIndices() {
    const out = new Set();
    for (const r of (viewport && viewport.selections) || []) {
      for (let i = r.start; i < r.end && out.size < 200; i++) if (cellEls[i]) out.add(i);
    }
    return [...out].sort((a, b) => a - b);
  }

  /** Drawn unscaled on top of the minimap so the outline stays crisp. */
  function drawSelection(indices) {
    for (const c of columns) {
      const layer = c.sel;
      while (layer.children.length < indices.length) {
        const el = document.createElement('div');
        el.className = 'sel-cell';
        layer.appendChild(el);
      }
      while (layer.children.length > indices.length) layer.lastChild.remove();
      indices.forEach((index, i) => {
        const cell = cellEls[index];
        const el = layer.children[i];
        el.style.top = cell.offsetTop * scale + 'px';
        el.style.height = Math.max(4, cell.offsetHeight * scale) + 'px';
        el.style.width = colWidth + 'px';
      });
    }
  }

  let stickyKey = null;

  function drawHeadings(anchor) {
    if (!cfg.showHeadings || anchor < 0 || !headings.length) {
      sticky.hidden = true;
      stickyKey = null;
      return;
    }
    const stack = [];
    for (const h of headings) {
      if (h.index > anchor) break;
      while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
      stack.push(h);
    }
    const shown = stack.slice(-MAX_HEADING_LINES);
    const key = shown.map((h) => h.index + ':' + h.level + ':' + h.text).join('\n');
    if (key === stickyKey) return;
    stickyKey = key;

    if (!shown.length) {
      sticky.hidden = true;
      return;
    }
    const minLevel = Math.min(...shown.map((h) => h.level));
    sticky.replaceChildren(
      ...shown.map((h, i) => {
        const el = document.createElement('div');
        el.className = 'crumb' + (i === shown.length - 1 ? ' current' : '');
        el.style.paddingLeft = 8 + (h.level - minLevel) * 10 + 'px';
        el.textContent = h.text;
        el.title = h.text;
        el.dataset.index = String(h.index);
        return el;
      }),
    );
    sticky.hidden = false;
  }

  // ----------------------------------------------------- auto scrolling

  let pausedUntil = 0;
  let target = null;
  let raf = 0;
  let placed = false;

  function follow(top, bottom, instant) {
    if (Date.now() < pausedUntil) return;
    const n = columnCount();
    const center = (top + bottom) / 2;
    let t;
    if (n === 1) {
      t = center - colHeight / 2;
    } else {
      // With columns, keep the page still while the focus is comfortably on
      // it (like reading), and turn the page only when it leaves; then put
      // the focus in the middle of the first (2 cols) or middle (3+) column.
      const current = target !== null ? target : scroller.scrollTop;
      const margin = colHeight * 0.1;
      const fits = bottom - top < n * colHeight - 2 * margin;
      if (fits && top >= current + margin && bottom <= current + n * colHeight - margin) return;
      const k = Math.floor((n - 1) / 2);
      t = center - (k * colHeight + colHeight / 2);
    }
    t = Math.max(0, Math.min(t, maxScroll));
    if (instant) {
      cancelAnimation();
      scroller.scrollTop = t;
    } else {
      target = t;
      if (!raf) raf = requestAnimationFrame(step);
    }
  }

  function step() {
    raf = 0;
    if (target === null) return;
    const cur = scroller.scrollTop;
    const delta = (target - cur) * 0.3;
    if (Math.abs(delta) < 1) {
      scroller.scrollTop = target;
      target = null;
      return;
    }
    scroller.scrollTop = cur + delta;
    raf = requestAnimationFrame(step);
  }

  function cancelAnimation() {
    target = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function pauseFollow() {
    pausedUntil = Date.now() + FOLLOW_PAUSE_MS;
    cancelAnimation();
  }

  // ------------------------------------------------------------- input

  let lastZoom = 0;
  scroller.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const now = Date.now();
        if (now - lastZoom > 150 && e.deltaY !== 0) {
          lastZoom = now;
          zoom(e.deltaY > 0 ? 1 : -1);
        }
        return;
      }
      pauseFollow();
    },
    { passive: false },
  );
  scroller.addEventListener('touchstart', pauseFollow, { passive: true });
  scroller.addEventListener('keydown', pauseFollow);
  scroller.addEventListener('mousedown', (e) => {
    // Dragging the scrollbar.
    if (e.offsetX >= scroller.clientWidth) pauseFollow();
  });

  function reveal(index) {
    pausedUntil = 0;
    vscode.postMessage({ type: 'reveal', index });
  }

  stage.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (cell) reveal(Number(cell.dataset.index));
  });
  sticky.addEventListener('click', (e) => {
    const crumb = e.target.closest('.crumb');
    if (crumb) reveal(Number(crumb.dataset.index));
  });
  badge.addEventListener('click', () => {
    if (cfg.factor > 0) vscode.postMessage({ type: 'setFactor', value: 0 });
  });

  // Report images that fail to decode to the extension's output channel.
  stage.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.dataset.img || reported.has(img.dataset.img)) return;
      reported.add(img.dataset.img);
      vscode.postMessage({ type: 'imageError', id: img.dataset.img, bytes: sizes.get(img.dataset.img) });
    },
    true,
  );

  scroller.addEventListener('scroll', applyScroll, { passive: true });
  new ResizeObserver(() => scheduleLayout(false)).observe(scroller);
  new ResizeObserver(() => scheduleLayout(false)).observe(doc);

  vscode.postMessage({ type: 'ready' });
})();
