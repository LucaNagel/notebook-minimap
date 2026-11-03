import * as vscode from 'vscode';
import type { MiniCell, RenderOptions } from './model';
import { renderCell } from './render';

const VIEW_ID = 'notebookMinimap.view';

export function activate(context: vscode.ExtensionContext) {
  const provider = new MinimapProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('notebookMinimap.refresh', () => provider.refresh(true)),
    // The webview knows the effective zoom (it depends on the panel size), so
    // it picks the next step and answers with `setFactor`.
    vscode.commands.registerCommand('notebookMinimap.zoomIn', () => provider.zoom(-1)),
    vscode.commands.registerCommand('notebookMinimap.zoomOut', () => provider.zoom(+1)),
    vscode.commands.registerCommand('notebookMinimap.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`),
    ),
    vscode.commands.registerCommand('notebookMinimap.toggleColumns', () => {
      const config = vscode.workspace.getConfiguration('notebookMinimap');
      const next = (config.get<number>('columns', 1) % 3) + 1; // 1 → 2 → 3 → 1
      return config.update('columns', next, vscode.ConfigurationTarget.Global);
    }),
    provider,
  );
}

export function deactivate() {}

function toMiniCell(cell: vscode.NotebookCell): MiniCell {
  return {
    kind: cell.kind === vscode.NotebookCellKind.Markup ? 'markup' : 'code',
    language: cell.document.languageId,
    source: cell.document.getText(),
    executionCount: cell.executionSummary?.executionOrder,
    outputs: cell.outputs.map((o) => ({
      metadata: o.metadata,
      items: o.items.map((i) => ({ mime: i.mime, data: i.data })),
    })),
  };
}

class MinimapProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private ready = false;
  private editor?: vscode.NotebookEditor;
  private docKey?: string;
  /** Images the webview already holds, keyed by content hash. */
  private sentImages = new Set<string>();
  private renderTimer?: ReturnType<typeof setTimeout>;
  private readonly disposables: vscode.Disposable[] = [];
  private log?: vscode.OutputChannel;

  constructor(private readonly extensionUri: vscode.Uri) {
    const w = vscode.window;
    this.disposables.push(
      w.onDidChangeActiveNotebookEditor(() => this.trackEditor()),
      w.onDidChangeVisibleNotebookEditors(() => this.trackEditor()),
      w.onDidChangeNotebookEditorVisibleRanges((e) => {
        if (e.notebookEditor === this.editor) this.postViewport();
      }),
      w.onDidChangeNotebookEditorSelection((e) => {
        if (e.notebookEditor === this.editor) this.postViewport();
      }),
      vscode.workspace.onDidChangeNotebookDocument((e) => {
        if (e.notebook === this.editor?.notebook) this.scheduleRender();
      }),
      vscode.workspace.onDidCloseNotebookDocument(() => this.trackEditor()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('notebookMinimap') || e.affectsConfiguration('editor') || e.affectsConfiguration('notebook')) {
          this.postConfig();
          this.scheduleRender(0);
        }
      }),
    );
  }

  dispose() {
    this.log?.dispose();
    this.disposables.forEach((d) => d.dispose());
    if (this.renderTimer) clearTimeout(this.renderTimer);
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    this.ready = false;
    this.sentImages.clear();
    this.docKey = undefined;

    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview, media);

    view.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    view.onDidDispose(() => {
      this.view = undefined;
      this.ready = false;
    });
  }

  zoom(direction: number) {
    this.post({ type: 'zoom', direction });
  }

  /** Re-render everything, optionally dropping the webview's image cache. */
  refresh(hard = false) {
    if (hard) {
      this.docKey = undefined;
    }
    this.trackEditor(true);
  }

  // ------------------------------------------------------------ tracking

  private pickEditor(): vscode.NotebookEditor | undefined {
    const active = vscode.window.activeNotebookEditor;
    if (active) return active;
    // Focus moved to a text editor or panel: keep showing the last notebook
    // as long as it is still on screen.
    const visible = vscode.window.visibleNotebookEditors;
    if (this.editor && visible.includes(this.editor)) return this.editor;
    return visible[0];
  }

  private trackEditor(forceRender = false) {
    const next = this.pickEditor();
    const key = next?.notebook.uri.toString();
    const docChanged = key !== this.docKey;
    this.editor = next;

    if (docChanged) {
      this.docKey = key;
      this.sentImages.clear();
      if (this.view) this.view.description = next ? basename(next.notebook.uri) : undefined;
      this.post({ type: 'reset' });
      this.render();
    } else if (forceRender) {
      this.render();
    } else {
      this.postViewport();
    }
  }

  // ----------------------------------------------------------- rendering

  private scheduleRender(delay = 300) {
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => this.render(), delay);
  }

  private renderOptions(): RenderOptions {
    const mm = vscode.workspace.getConfiguration('notebookMinimap');
    return {
      textLineLimit: vscode.workspace.getConfiguration('notebook.output').get<number>('textLineLimit', 30),
      renderHtml: mm.get<boolean>('renderHtmlOutputs', true),
      maxHtmlChars: mm.get<number>('maxHtmlOutputLength', 20000),
    };
  }

  private render() {
    if (!this.view || !this.ready) return;
    const editor = this.editor;
    if (!editor) {
      this.post({ type: 'render', cells: [], headings: [], usedImages: [] });
      return;
    }

    const opts = this.renderOptions();
    const cells: { kind: string; html: string }[] = [];
    const headings: { index: number; level: number; text: string }[] = [];
    const newImages: { id: string; mime: string; data: Uint8Array }[] = [];
    const used = new Set<string>();

    editor.notebook.getCells().forEach((cell, index) => {
      const r = renderCell(toMiniCell(cell), opts);
      cells.push({ kind: r.kind, html: r.html });
      for (const h of r.headings) headings.push({ index, ...h });
      for (const img of r.images) {
        used.add(img.id);
        if (!this.sentImages.has(img.id)) newImages.push(img);
      }
    });

    // The webview drops images that are no longer referenced; mirror that here.
    this.sentImages = used;
    if (newImages.length) this.post({ type: 'images', images: newImages });
    this.post({ type: 'render', cells, headings, usedImages: [...used] });
    this.postViewport();
  }

  private postViewport() {
    const editor = this.editor;
    if (!editor) return;
    this.post({
      type: 'viewport',
      ranges: editor.visibleRanges.map((r) => ({ start: r.start, end: r.end })),
      selections: editor.selections.map((r) => ({ start: r.start, end: r.end })),
    });
  }

  private postConfig() {
    const mm = vscode.workspace.getConfiguration('notebookMinimap');
    const ed = vscode.workspace.getConfiguration('editor');
    const fontSize = ed.get<number>('fontSize', 14);
    const rawLineHeight = ed.get<number>('lineHeight', 0);
    const ratio = process.platform === 'darwin' ? 1.5 : 1.35;
    const lineHeight =
      rawLineHeight <= 0 ? Math.round(fontSize * ratio) : rawLineHeight < 8 ? Math.round(fontSize * rawLineHeight) : rawLineHeight;
    const markupFontSize = vscode.workspace.getConfiguration('notebook.markup').get<number>('fontSize', 0);

    this.post({
      type: 'config',
      factor: mm.get<number>('contextFactor', 0),
      showHeadings: mm.get<boolean>('showHeadings', true),
      columns: mm.get<number>('columns', 1),
      headingSize: mm.get<number>('headingSize', 12),
      headingMaxLines: mm.get<number>('headingMaxLines', 2),
      markdownTextSize: mm.get<number>('markdownTextSize', 0),
      headingStripFontSize: mm.get<number>('headingStripFontSize', 12),
      viewportHeight: mm.get<number>('estimatedViewportHeight', 1000),
      contentWidth: mm.get<number>('notebookWidth', 1000),
      fontFamily: ed.get<string>('fontFamily'),
      fontSize,
      lineHeight,
      markupFontSize: markupFontSize > 0 ? markupFontSize : Math.round(fontSize * 1.2),
    });
  }

  // ----------------------------------------------------------- messaging

  private onMessage(msg: any) {
    switch (msg?.type) {
      case 'ready':
        this.ready = true;
        this.sentImages.clear();
        this.docKey = undefined;
        this.postConfig();
        this.trackEditor(true);
        break;
      case 'reveal':
        void this.reveal(msg.index);
        break;
      case 'imageError':
        this.log ??= vscode.window.createOutputChannel('Notebook Minimap');
        this.log.appendLine(`Image could not be displayed: ${msg.id} (${msg.bytes ?? '?'} bytes received)`);
        break;
      case 'setFactor':
        if (typeof msg.value === 'number' && msg.value >= 0) {
          void vscode.workspace
            .getConfiguration('notebookMinimap')
            .update('contextFactor', msg.value, vscode.ConfigurationTarget.Global);
        }
        break;
    }
  }

  private async reveal(index: number) {
    const editor = this.editor;
    if (!editor || typeof index !== 'number' || index < 0 || index >= editor.notebook.cellCount) return;
    const range = new vscode.NotebookRange(index, index + 1);
    const shown = await vscode.window.showNotebookDocument(editor.notebook, {
      viewColumn: editor.viewColumn,
      selections: [range],
      preserveFocus: false,
    });
    shown.revealRange(range, vscode.NotebookEditorRevealType.AtTop);
  }

  private post(message: unknown) {
    if (this.view && this.ready) void this.view.webview.postMessage(message);
  }

  private html(webview: vscode.Webview, media: vscode.Uri): string {
    const nonce = makeNonce();
    const script = webview.asWebviewUri(vscode.Uri.joinPath(media, 'minimap.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(media, 'minimap.css'));
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} blob: data: https:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${style}">
  <title>Notebook Minimap</title>
</head>
<body>
  <div id="empty">Open a Jupyter notebook to see its minimap.</div>
  <div id="sticky" hidden></div>
  <div id="scroller">
    <div id="stage"></div>
    <div id="spacer"></div>
  </div>
  <div id="badge"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

function basename(uri: vscode.Uri): string {
  return uri.path.split('/').pop() ?? uri.path;
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
