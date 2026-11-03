# Changelog

## 0.4.0

- Columns no longer get cropped when a fixed zoom factor is set; the zoom is limited to the column width.
- New settings: `headingMaxLines`, `markdownTextSize`, `headingStripFontSize`.
- Settings button in the view title.

## 0.3.0

- Columns: the notebook can flow into 2–3 columns side by side.
- Headings inside the minimap at a readable, zoom-independent size (`headingSize`).

## 0.2.1

- Fix: plots did not appear because output data was sent to the view in the wrong format.
- Interactive widgets without a static image show a labelled placeholder.

## 0.2.0

- Interactive ipympl (`%matplotlib widget`) figures are shown.
- Clearer highlight of the selected cell; the minimap keeps it in view.
- Section headings above the minimap.
- Fills the panel width by default.

## 0.1.0

- First version: rendered preview, viewport box, click to navigate, zoom.
