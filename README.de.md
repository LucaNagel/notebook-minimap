# Notebook Minimap

Zeigt im Explorer-Seitenbereich eine verkleinerte, gerenderte Vorschau des aktiven Jupyter-Notebooks (Markdown, Code mit Syntax-Highlighting, Plots inkl. interaktiver ipympl-Plots, Text- und Fehler-Outputs). Ein blauer Rahmen markiert die Zellen, die gerade im Editor sichtbar sind, der Rest ist leicht abgedunkelt; die ausgewählte Zelle ist blau hinterlegt. Oben stehen die Markdown-Überschriften des aktuellen Abschnitts, und auch in der Minimap selbst sind Überschriften in lesbarer Größe dargestellt. Auf Wunsch fließt das Notebook in 2–3 Spalten nebeneinander. Die Vorschau scrollt automatisch mit.

## Installieren

**Fertiges Paket:** In VS Code `Cmd+Shift+P` → **Extensions: Install from VSIX…** → `notebook-minimap-0.4.0.vsix` wählen (ersetzt eine ältere Version). Danach erscheint im Explorer ein neuer Abschnitt **Notebook Minimap** (lässt sich wie die Outline per Drag & Drop verschieben, z. B. in die rechte Seitenleiste).

**Aus dem Quellcode / zum Weiterentwickeln:**

```bash
npm install
npm run build        # bündelt nach dist/extension.js
npm run package      # erzeugt die .vsix
```

Zum Debuggen den Ordner in VS Code öffnen und **F5** drücken; es startet ein zweites VS-Code-Fenster mit der Extension.

**Tests:**

```bash
npm test               # baut, Renderer-Tests + Smoke-Test gegen eine nachgebaute VS-Code-API
npm run test:webview   # zusätzlich die Webview im Headless-Chrome (pip install playwright)
npm run fixtures       # Testnotebook neu erzeugen (braucht numpy + matplotlib)
```

## Bedienung

- **Klick** auf eine Zelle oder eine Überschrift oben springt im Notebook dorthin.
- **Spalten-Button** (erster Button in der Titelleiste): wechselt zwischen 1, 2 und 3 Spalten. Das Notebook läuft vom unteren Ende einer Spalte oben in der nächsten weiter. Mit mehreren Spalten bleibt die „Seite“ stehen, solange deine Position darauf zu sehen ist, und blättert erst weiter, wenn sie sie verlässt.
- Standardmäßig füllt die Minimap die **volle Breite** des Panels bzw. jeder Spalte; das Badge unten rechts zeigt dann z. B. `fit · 1.3×` (so viel Editorhöhe passt hinein). Für mehr Kontext das Panel höher ziehen oder zoomen.
- **Zahnrad-Button** in der Titelleiste öffnet alle Einstellungen der Minimap.
- **Lupen-Buttons** in der Titelleiste des Abschnitts oder **Cmd/Strg + Mausrad** über der Minimap: mehr oder weniger Kontext. Ein Klick auf das Badge kehrt zur vollen Breite zurück.
- Wer selbst in der Minimap scrollt, pausiert das automatische Mitlaufen für 2 Sekunden.

## Einstellungen

| Einstellung | Standard | Bedeutung |
|---|---|---|
| `notebookMinimap.columns` | `1` | Anzahl Spalten (1–6); der Spalten-Button schaltet 1 → 2 → 3. |
| `notebookMinimap.contextFactor` | `0` | Wie viel vom Notebook sichtbar ist, als Vielfaches der Editorhöhe. `0` = an Spaltenbreite anpassen. Breiter als eine Spalte wird nie gezoomt. |
| `notebookMinimap.headingSize` | `12` | Bildschirmgröße (px) der Überschriften in der Minimap, unabhängig vom Zoom (`h1` etwas größer, `h4`+ etwas kleiner). `0` = natürliche, verkleinerte Größe. |
| `notebookMinimap.headingMaxLines` | `2` | Längere Überschriften werden nach so vielen Zeilen mit „…“ gekürzt. `0` = immer vollständig. |
| `notebookMinimap.markdownTextSize` | `0` | Bildschirmgröße (px) von normalem Markdown-Text (Absätze, Listen). `0` = natürliche, verkleinerte Größe. |
| `notebookMinimap.showHeadings` | `true` | Überschriften des aktuellen Abschnitts oben anzeigen. |
| `notebookMinimap.headingStripFontSize` | `12` | Schriftgröße (px) der Überschriftenleiste über der Minimap. |
| `notebookMinimap.estimatedViewportHeight` | `1000` | Geschätzte Höhe (px) des sichtbaren Notebook-Bereichs. VS Code verrät sie Extensions nicht; bei einem großen Monitor ggf. erhöhen. |
| `notebookMinimap.notebookWidth` | `1000` | Breite (px), mit der die Vorschau layoutet. Auf die Breite des Notebook-Editors setzen, damit Bilder und Markdown ähnlich umbrechen. |
| `notebookMinimap.renderHtmlOutputs` | `true` | HTML-Outputs (z. B. pandas-Tabellen) rendern. |
| `notebookMinimap.maxHtmlOutputLength` | `20000` | Längere HTML-Outputs (z. B. xarray-Reprs) werden als Text gezeigt. |

Schrift und Zeilenhöhe übernimmt die Minimap aus `editor.fontFamily`, `editor.fontSize` und `editor.lineHeight`, lange Text-Outputs werden wie im Notebook nach `notebook.output.textLineLimit` Zeilen gekürzt.

## Bekannte Grenzen (Stufe 1)

- **Kasten nur auf Zellebene.** VS Code meldet Extensions nur, *welche* Zellen sichtbar sind, nicht die Scrollposition innerhalb einer Zelle. Bei sehr langen Zellen umfasst der Kasten die ganze Zelle und springt erst weiter, wenn die nächste Zelle ins Bild kommt.
- **Nachbau statt Screenshot.** Die Vorschau rendert das Notebook selbst; Zellhöhen weichen etwas vom Original ab. Vergrößerte Überschriften machen Markdown-Zellen in der Minimap höher als im Original.
- Interaktive ipympl-Plots zeigen den Stand beim Ausführen der Zelle (spätere Zoom-/Pan-Änderungen im Plot nicht). Plotly-, sonstige Widget- und Vega-Outputs erscheinen als Platzhalter in typischer Höhe. LaTeX in Markdown wird nicht gesetzt, Bilder mit relativem Pfad in Markdown fehlen.
- Eingeklappte Abschnitte im Notebook werden in der Minimap trotzdem ausgeklappt gezeigt.

## Aufbau

- `src/extension.ts` – registriert die Sidebar-View, hört auf Editor-, Scroll- und Dokumentänderungen, schickt gerenderte Zellen und den sichtbaren Bereich an die Webview.
- `src/render.ts` – macht aus einer Zelle HTML (markdown-it, highlight.js, Output-Auswahl, Bildgrößen aus dem PNG/JPEG-Header). Bilder werden per Inhalts-Hash nur einmal übertragen.
- `media/minimap.js` / `minimap.css` – Webview: Layout in Notebook-Breite, Skalierung, Spalten (Spalte 2+ zeigen Kopien des gerenderten Notebooks, je um eine Spaltenhöhe versetzt), Kasten, Mitlaufen, Klick-Navigation, HTML-Sanitizing.
- `test/` – `run.ts` (Renderer-Tests), `smoke.js` + `mock/vscode` (Extension gegen nachgebaute VS-Code-API), `harness.html` + `shoot.py` (Webview im Browser, Screenshots nach `test/out/`), `make_notebook.py` (erzeugt `fixtures/sample.ipynb`).
- `README.md` ist die englische Seite für den Marketplace, `README.de.md` diese Anleitung.
