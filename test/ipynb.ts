// Converts an .ipynb file into the renderer's model the same way the Jupyter
// extension maps nbformat outputs onto VS Code's notebook API.
import type { MiniCell, MiniOutput, MiniOutputItem } from '../src/model';

const enc = new TextEncoder();
const text = (v: string | string[]) => (Array.isArray(v) ? v.join('') : v);

function outputItems(o: any): MiniOutputItem[] {
  switch (o.output_type) {
    case 'stream':
      return [{
        mime: o.name === 'stderr' ? 'application/vnd.code.notebook.stderr' : 'application/vnd.code.notebook.stdout',
        data: enc.encode(text(o.text)),
      }];
    case 'error':
      return [{
        mime: 'application/vnd.code.notebook.error',
        data: enc.encode(JSON.stringify({ name: o.ename, message: o.evalue, stack: (o.traceback ?? []).join('\n') })),
      }];
    default:
      return Object.entries(o.data ?? {}).map(([mime, value]) => {
        if (mime.startsWith('image/') && mime !== 'image/svg+xml') {
          return { mime, data: new Uint8Array(Buffer.from(text(value as string), 'base64')) };
        }
        const str = typeof value === 'string' || Array.isArray(value) ? text(value as string) : JSON.stringify(value);
        return { mime, data: enc.encode(str) };
      });
  }
}

export function loadNotebook(json: any): MiniCell[] {
  const language = json.metadata?.language_info?.name ?? 'python';
  return json.cells.map((c: any): MiniCell => ({
    kind: c.cell_type === 'markdown' ? 'markup' : 'code',
    language: c.cell_type === 'markdown' ? 'markdown' : language,
    source: text(c.source),
    executionCount: c.execution_count ?? undefined,
    outputs: (c.outputs ?? []).map((o: any): MiniOutput => ({
      items: outputItems(o),
      metadata: { outputType: o.output_type, metadata: o.metadata ?? {} },
    })),
  }));
}
