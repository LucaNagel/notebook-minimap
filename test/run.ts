// Renderer tests plus a fixture for the webview harness.
// Usage: node out/run.js <notebook.ipynb> <fixture-out.json>
import * as assert from 'assert';
import * as fs from 'fs';
import { renderCell, imageSize, stripAnsi } from '../src/render';
import type { RenderOptions } from '../src/model';
import { loadNotebook } from './ipynb';

const [nbPath, outPath] = process.argv.slice(2);
const opts: RenderOptions = { textLineLimit: 30, renderHtml: true, maxHtmlChars: 20000 };
const cells = loadNotebook(JSON.parse(fs.readFileSync(nbPath, 'utf8')));
const rendered = cells.map((c) => renderCell(c, opts));

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log('  ok  ' + name);
}

check('every cell renders', () => assert.strictEqual(rendered.length, cells.length));

check('markdown headings become HTML headings', () => {
  assert.match(rendered[0].html, /<h1>Plot linear cryo/);
  assert.match(rendered.find((r) => r.html.includes('Add 3rd kidney peak'))!.html, /<h3>/);
});

check('python is syntax highlighted', () => assert.match(rendered[2].html, /hljs-keyword">import</));

check('images carry their pixel size for stable layout', () => {
  const html = rendered[3].html;
  assert.match(html, /<img data-img="image\/png:[0-9a-f]{40}" width="600" height="400"/);
  assert.strictEqual(rendered[3].images.length, 1);
});

check('identical image bytes get the same id', () => {
  const again = renderCell(cells[3], opts);
  assert.strictEqual(again.images[0].id, rendered[3].images[0].id);
});

check('long stdout is truncated like notebook.output.textLineLimit', () => {
  const html = rendered.find((r) => r.html.includes('voxel 0: SNR'))!.html;
  assert.match(html, /… 25 more lines/);
});

check('errors are shown without ANSI codes', () => {
  const html = rendered.find((r) => r.html.includes('out-error'))!.html;
  assert.ok(!html.includes('\x1b'));
  assert.match(html, /ValueError/);
});

check('pandas-style HTML tables are kept', () => assert.ok(rendered.some((r) => r.html.includes('<table'))));

check('oversized HTML falls back to text/plain', () => {
  const big = renderCell(
    {
      kind: 'code', language: 'python', source: 'ds', outputs: [{
        items: [
          { mime: 'text/html', data: new TextEncoder().encode('<div>' + 'x'.repeat(30000) + '</div>') },
          { mime: 'text/plain', data: new TextEncoder().encode('<xarray.Dataset>') },
        ],
      }],
    },
    opts,
  );
  assert.match(big.html, /&lt;xarray.Dataset&gt;/);
});

check('ipympl widget plots show their embedded snapshot', () => {
  const r = rendered.find((x) => x.html.includes('Figure 96'))!;
  assert.ok(!r.html.includes('base64'), 'data URL must be extracted');
  assert.match(r.html, /<img data-img="image\/png:[0-9a-f]{40}" width="1200" height="240">/);
  assert.strictEqual(r.images.length, 1);
  assert.ok(!r.html.includes('out-placeholder'));
});

check('plotly gets a sized placeholder', () => {
  assert.ok(rendered.some((r) => r.html.includes('out-placeholder" style="height:450px">Plotly figure')));
});

check('markdown headings are extracted as plain text', () => {
  const r = renderCell({ kind: 'markup', language: 'markdown', source: '## Fit **ZOMPD1** and `ZOMPD5_3`\n```\n# not a heading\n```\n### Apply masks', outputs: [] }, opts);
  assert.deepStrictEqual(r.headings, [{ level: 2, text: 'Fit ZOMPD1 and ZOMPD5_3' }, { level: 3, text: 'Apply masks' }]);
});

check('code is escaped', () => {
  const r = renderCell({ kind: 'code', language: 'unknown-lang', source: '<script>x</script>', outputs: [] }, opts);
  assert.ok(!r.html.includes('<script>'));
});

check('jpeg, gif and svg sizes are read', () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"></svg>');
  assert.deepStrictEqual(imageSize('image/svg+xml', svg), { w: 320, h: 240 });
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00, 0, 0]);
  assert.deepStrictEqual(imageSize('image/gif', gif), { w: 320, h: 240 });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xf0, 0x01, 0x40, 0x03]);
  assert.deepStrictEqual(imageSize('image/jpeg', jpeg), { w: 320, h: 240 });
});

check('stripAnsi removes colour codes', () => assert.strictEqual(stripAnsi('\x1b[0;31mErr\x1b[0m'), 'Err'));

console.log(`${passed} checks passed`);

if (outPath) {
  const images = new Map<string, { id: string; mime: string; data: string }>();
  for (const r of rendered) {
    for (const img of r.images) images.set(img.id, { id: img.id, mime: img.mime, data: Buffer.from(img.data).toString('base64') });
  }
  fs.writeFileSync(
    outPath,
    JSON.stringify({
      images: [...images.values()],
      cells: rendered.map((r) => ({ kind: r.kind, html: r.html })),
      headings: rendered.flatMap((r, index) => r.headings.map((h) => ({ index, ...h }))),
      usedImages: [...images.keys()],
    }),
  );
}
