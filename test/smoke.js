// Smoke test: loads the bundled extension against a fake `vscode` module
// (test/mock/vscode) and drives it through ready, scroll, edit, reveal and
// the title-bar commands. Run with `npm test`.
const vscode = require('vscode');
// Mirrors serializeWebviewMessage/deserializeWebviewMessage in VS Code.
function vscodeTransfer(message) {
  const buffers = [];
  const json = JSON.stringify(message, (_k, v) => {
    if (v instanceof ArrayBuffer) { buffers.push(v); return { $$ref: buffers.length - 1 }; }
    if (ArrayBuffer.isView(v)) { buffers.push(v.buffer); return { $$ref: buffers.length - 1, off: v.byteOffset, len: v.byteLength }; }
    return v;
  });
  return JSON.parse(json, (_k, v) => (v && typeof v === 'object' && '$$ref' in v)
    ? (v.len !== undefined ? new Uint8Array(buffers[v.$$ref].slice(0), v.off, v.len) : buffers[v.$$ref]) : v);
}
const ext = require('../dist/extension.js');
const fs = require('fs');
const nb = JSON.parse(fs.readFileSync(__dirname + '/fixtures/sample.ipynb', 'utf8'));
const enc = new TextEncoder();
const cells = nb.cells.map((c) => ({
  kind: c.cell_type === 'markdown' ? 1 : 2,
  document: { languageId: c.cell_type === 'markdown' ? 'markdown' : 'python', getText: () => [].concat(c.source).join('') },
  executionSummary: c.execution_count ? { executionOrder: c.execution_count } : undefined,
  outputs: (c.outputs || []).map((o) => ({ metadata: {}, items: o.output_type === 'stream'
    ? [{ mime: 'application/vnd.code.notebook.stdout', data: Buffer.from([].concat(o.text).join('')) }]
    : Object.entries(o.data || {}).map(([m, v]) => ({ mime: m, data: m === 'image/png' ? Buffer.from(v, 'base64') : Buffer.from(enc.encode(typeof v === 'string' ? v : JSON.stringify(v))) })) })),
}));
const notebook = { uri: { path: '/x/03_lcryo_kidney_pH.ipynb', toString() { return 'file:///x/03_lcryo_kidney_pH.ipynb'; } }, cellCount: cells.length, getCells: () => cells };
const editor = { notebook, viewColumn: 1, visibleRanges: [new vscode.NotebookRange(9, 11)], selections: [new vscode.NotebookRange(10, 11)] };

ext.activate({ subscriptions: [], extensionUri: { path: '/ext' }, extension: { id: 'local.notebook-minimap' } });
const posted = []; let onMsg;
const view = { visible: true, webview: { cspSource: 'vscode-resource:', options: {}, html: '', asWebviewUri: (u) => u.path,
  onDidReceiveMessage: (f) => { onMsg = f; }, postMessage: async (m) => { posted.push(vscodeTransfer(m)); return true; } }, onDidDispose() {} };
vscode.__provider.resolveWebviewView(view);
if (!view.webview.html.includes("script-src 'nonce-")) throw new Error('missing CSP');
vscode.window.activeNotebookEditor = editor; vscode.window.visibleNotebookEditors = [editor];
onMsg({ type: 'ready' });
const types = posted.map((m) => m.type);
console.log('headings:', JSON.stringify(posted.find((m) => m.type === 'render').headings.slice(0, 3)));
console.log('config:', JSON.stringify(posted.find((m) => m.type === 'config'), ['factor', 'columns', 'headingSize', 'headingMaxLines', 'markdownTextSize', 'headingStripFontSize']));
console.log('messages after ready:', types.join(', '), '| view description:', view.description);
const render = posted.find((m) => m.type === 'render');
const imgs = posted.find((m) => m.type === 'images');
if (render.cells.length !== cells.length || imgs.images.length !== 7) throw new Error('bad render');
for (const img of imgs.images) {
  const ok = img.data instanceof Uint8Array && img.data[0] === 0x89 && img.data[1] === 0x50;
  if (!ok) throw new Error('image arrived broken in webview: ' + JSON.stringify(img.data).slice(0, 60));
}
console.log('all', imgs.images.length, 'images arrive as PNG bytes');

// scrolling the editor sends only a viewport update
posted.length = 0; editor.visibleRanges = [new vscode.NotebookRange(14, 16)];
vscode.__fire('ranges', { notebookEditor: editor });
console.log('on scroll:', posted.map((m) => m.type + JSON.stringify(m.ranges || '')).join(', '));

// editing re-renders after debounce, without resending images
posted.length = 0; vscode.__fire('doc', { notebook });
setTimeout(async () => {
  console.log('after edit:', posted.map((m) => m.type).join(', '));
  if (posted.some((m) => m.type === 'images')) throw new Error('images resent');
  onMsg({ type: 'reveal', index: 17 });
  await new Promise((r) => setTimeout(r, 10));
  console.log('reveal ->', JSON.stringify(vscode.__revealed));
  posted.length = 0;
  await vscode.__commands['notebookMinimap.zoomOut']();
  console.log('zoom-out button ->', JSON.stringify(posted));
  onMsg({ type: 'setFactor', value: 3 });
  console.log('setFactor ->', JSON.stringify(vscode.__updated));
  await vscode.__commands['notebookMinimap.toggleColumns']();
  console.log('columns button ->', JSON.stringify(vscode.__updated));
  await vscode.__commands['notebookMinimap.openSettings']();
  console.log('settings button ->', JSON.stringify(vscode.__executed));
  console.log('SMOKE OK');
}, 400);
