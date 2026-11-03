# Notebook Minimap

A rendered minimap for Jupyter notebooks in VS Code. It shows a scaled-down preview of the whole notebook – Markdown, highlighted code, plots and outputs – in the sidebar and marks where you are.

VS Code's built-in minimap doesn't work across a notebook's cells, and the Outline only lists headings. Notebook Minimap shows the notebook itself, so you can find the plot or cell you are looking for by its shape.

## Features

- **Rendered preview** of Markdown, code (syntax highlighted), images and plots (including interactive ipympl / `%matplotlib widget` figures), text output, errors and HTML tables.
- **Viewport box** marking the cells visible in the editor; everything else is slightly dimmed. The selected cell is highlighted.
- **Follows the editor** as you scroll, and **click to jump** to any cell.
- **Section headings** of the current position above the minimap (like sticky scroll); click one to jump to it.
- **Readable headings and text** inside the minimap at a fixed screen size, however far it is zoomed out.
- **Columns:** let the notebook flow into 2 or 3 columns side by side, like pages – useful in a tall, narrow sidebar.
- **Zoom** with the title-bar buttons or Ctrl/Cmd + mouse wheel.

## Usage

Open a Jupyter notebook. The **Notebook Minimap** view appears in the Explorer; drag it anywhere, e.g. into the secondary sidebar.

Title-bar buttons, from left: columns (1 → 2 → 3), less context, more context, refresh, settings. The badge in the corner shows the current zoom; click it to return to "fit width".

To try it out, open [`examples/minimap-demo.ipynb`](examples/minimap-demo.ipynb): a long notebook with about 30 plots and synthetic data.

## Settings

| Setting | Default | Description |
|---|---|---|
| `notebookMinimap.columns` | `1` | Number of columns (1–6). |
| `notebookMinimap.contextFactor` | `0` | Notebook shown, as a multiple of the editor height. `0` fits the column width. Never zooms wider than a column. |
| `notebookMinimap.headingSize` | `12` | Screen size (px) of headings in the minimap, independent of zoom. `0` = natural scaled size. |
| `notebookMinimap.headingMaxLines` | `2` | Cut long headings after this many lines. `0` = never. |
| `notebookMinimap.markdownTextSize` | `0` | Screen size (px) of Markdown body text. `0` = natural scaled size. |
| `notebookMinimap.showHeadings` | `true` | Show the current section's headings above the minimap. |
| `notebookMinimap.headingStripFontSize` | `12` | Font size (px) of those headings. |
| `notebookMinimap.notebookWidth` | `1000` | Width (px) the minimap lays the notebook out at; set it to roughly your notebook editor's width. |
| `notebookMinimap.estimatedViewportHeight` | `1000` | Approximate height (px) of the visible notebook area, used by `contextFactor`. |
| `notebookMinimap.renderHtmlOutputs` | `true` | Render `text/html` outputs such as pandas tables. |
| `notebookMinimap.maxHtmlOutputLength` | `20000` | Longer HTML outputs (e.g. xarray reprs) are shown as plain text. |

Fonts and line height follow `editor.fontFamily`, `editor.fontSize` and `editor.lineHeight`; long text outputs are cut like in the notebook (`notebook.output.textLineLimit`).

## Known limitations

- VS Code tells extensions *which* cells are visible, not the scroll position inside a cell, so the viewport box works per cell. For a very tall cell it covers the whole cell.
- The minimap renders the notebook itself, so cell heights differ slightly from the editor; enlarged headings make Markdown cells taller.
- Interactive ipympl figures show their state when the cell ran. Plotly, other widgets and Vega charts appear as placeholders. Math in Markdown is not typeset.

## License

MIT
