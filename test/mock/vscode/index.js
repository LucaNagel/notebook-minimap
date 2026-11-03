// Minimal fake of the parts of the vscode API the extension uses (for test/smoke.js).
const listeners = {};
const on = (name) => (fn) => { (listeners[name] ||= []).push(fn); return { dispose() {} }; };
const fire = (name, e) => (listeners[name] || []).forEach((f) => f(e));
class NotebookRange { constructor(s, e) { this.start = s; this.end = e; } }
const config = { get: (_k, d) => d, update: async (k, v) => { exports.__updated = [k, v]; } };
const Uri = { joinPath: (u, ...p) => ({ path: [u.path, ...p].join('/'), toString() { return this.path; } }) };
exports.NotebookRange = NotebookRange;
exports.NotebookCellKind = { Markup: 1, Code: 2 };
exports.NotebookEditorRevealType = { AtTop: 3 };
exports.ConfigurationTarget = { Global: 1 };
exports.Uri = Uri;
exports.__fire = fire;
exports.window = {
  activeNotebookEditor: undefined, visibleNotebookEditors: [],
  registerWebviewViewProvider: (id, p) => { exports.__provider = p; return { dispose() {} }; },
  onDidChangeActiveNotebookEditor: on('active'), onDidChangeVisibleNotebookEditors: on('visible'),
  onDidChangeNotebookEditorVisibleRanges: on('ranges'), onDidChangeNotebookEditorSelection: on('selection'),
  showNotebookDocument: async (nb, o) => { exports.__shown = o; return { revealRange: (r, t) => { exports.__revealed = [r, t]; } }; },
};
exports.workspace = {
  getConfiguration: () => config, onDidChangeNotebookDocument: on('doc'),
  onDidCloseNotebookDocument: on('close'), onDidChangeConfiguration: on('config'),
};
exports.commands = { executeCommand: async (...a) => { exports.__executed = a; }, registerCommand: (id, fn) => { (exports.__commands ||= {})[id] = fn; return { dispose() {} }; } };
