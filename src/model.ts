// Plain data model the renderer works on. Kept free of the `vscode` module
// so the renderer can be tested outside VS Code.

export interface MiniOutputItem {
  mime: string;
  data: Uint8Array;
}

export interface MiniOutput {
  items: MiniOutputItem[];
  metadata?: Record<string, unknown>;
}

export interface MiniCell {
  kind: 'code' | 'markup';
  language: string;
  source: string;
  executionCount?: number;
  outputs: MiniOutput[];
}

export interface RenderOptions {
  /** Same meaning as VS Code's `notebook.output.textLineLimit`. */
  textLineLimit: number;
  renderHtml: boolean;
  maxHtmlChars: number;
}

export interface ImagePayload {
  id: string;
  mime: string;
  data: Uint8Array;
}

export interface Heading {
  level: number;
  text: string;
}

export interface RenderedCell {
  kind: 'code' | 'markup';
  html: string;
  images: ImagePayload[];
  /** Markdown headings in this cell, in order (markup cells only). */
  headings: Heading[];
}
