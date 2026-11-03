"""Renders the webview in headless Chrome, checks behaviour and writes screenshots.

Usage: python3 test/shoot.py [repo-root] [screenshot-dir]   (defaults: . and test/out)
Needs `pip install playwright` and a Chromium (`playwright install chromium`),
or set CHROME_PATH to an installed Chrome.
"""
import functools, http.server, json, sys, threading
from playwright.sync_api import sync_playwright

import os
root = sys.argv[1] if len(sys.argv) > 1 else "."
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, "test", "out")
os.makedirs(out, exist_ok=True)
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)
handler.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{srv.server_port}/test/harness.html"
fixture = json.load(open(f"{root}/test/out/fixture.json"))

cfg = {"type": "config", "factor": 0, "viewportHeight": 1000, "contentWidth": 1000, "showHeadings": True,
       "fontFamily": "DejaVu Sans Mono", "fontSize": 13, "lineHeight": 20, "markupFontSize": 16}
W, H = 330, 440  # about the size of the panel in the user's screenshot


def rect(page, sel):
    return page.evaluate(f"(() => {{ const r = document.querySelector('{sel}').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }})()")


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
    page = b.new_page(viewport={"width": W, "height": H}, device_scale_factor=2)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    assert page.evaluate("window.__posted")[0] == {"type": "ready"}
    page.evaluate("cfg => send(cfg)", cfg)
    page.evaluate("""f => {
        // half as real bytes, half in the {type:'Buffer'} JSON shape
        send({type: 'images', images: f.images.map((i, n) => {
            const bytes = Uint8Array.from(atob(i.data), c => c.charCodeAt(0));
            return {...i, data: n % 2 ? {type: 'Buffer', data: Array.from(bytes)} : bytes};
        })});
        send({type: 'render', cells: f.cells, headings: f.headings, usedImages: f.usedImages});
    }""", fixture)
    page.evaluate("send({type:'viewport', ranges:[{start:9,end:13}], selections:[{start:12,end:13}]})")
    page.wait_for_timeout(700)
    page.screenshot(path=f"{out}/v2_dark.png")

    # 1. ipympl snapshot is shown as an image
    img = page.evaluate("""(() => { const i = document.querySelector('.cell[data-index="10"] img');
        return i && {loaded: i.complete && i.naturalWidth > 0, w: i.getBoundingClientRect().width}; })()""")
    print("ipympl image:", img)
    assert img and img["loaded"] and 100 < img["w"] <= W - 8

    loaded = page.evaluate("[...document.querySelectorAll('img[data-img]')].map(i => i.complete && i.naturalWidth > 0)")
    print("images loaded:", loaded)
    assert loaded and all(loaded)
    assert not [m for m in page.evaluate("window.__posted") if m.get("type") == "imageError"]

    # 2. selection overlay sits on the selected cell
    sel, cell = rect(page, ".sel-cell"), rect(page, '.cell[data-index="12"]')
    print("selection", sel, "cell", cell)
    assert abs(sel[1] - cell[1]) < 2 and abs(sel[3] - cell[3]) < 2

    # 3. headings strip shows the path to the selected cell
    crumbs = page.evaluate("[...document.querySelectorAll('#sticky .crumb')].map(c => c.textContent)")
    print("headings:", crumbs)
    assert crumbs == ["Plot linear cryo in vivo kidney pH imaging", "Fitting",
                      "Compare the fit results of the Lorentzian and Voigt fitting"]

    # the selected cell is in view even though the first visible cell is huge
    vis = page.evaluate("""(() => { const s = document.querySelector('.sel-cell').getBoundingClientRect();
        const v = document.getElementById('scroller').getBoundingClientRect(); return s.top >= v.top && s.bottom <= v.bottom; })()""")
    assert vis, "selected cell must be scrolled into view"

    # 4. fills the width (fit mode): no empty bands left and right
    stage, scr = rect(page, "#stage"), rect(page, "#scroller")
    inner = page.evaluate("document.getElementById('scroller').clientWidth")
    print("stage", stage, "scroller inner width", inner)
    assert stage[2] - stage[0] >= inner - 8 - 1

    # headings follow the editor when the selection is off screen
    page.evaluate("send({type:'viewport', ranges:[{start:16,end:19}], selections:[{start:2,end:3}]})")
    page.wait_for_timeout(500)
    crumbs = page.evaluate("[...document.querySelectorAll('#sticky .crumb')].map(c => c.textContent)")
    print("headings later:", crumbs)
    assert crumbs[-1] == "Add 1st kidney peak"

    # clicking a heading navigates to its cell
    page.evaluate("window.__posted = []")
    page.locator("#sticky .crumb").last.click()
    assert {"type": "reveal", "index": 15} in page.evaluate("window.__posted"), page.evaluate("window.__posted")

    # zoom out from fit asks the extension for a larger factor
    page.evaluate("window.__posted = []; send({type:'zoom', direction: 1})")
    posted = page.evaluate("window.__posted")
    eff = page.evaluate("document.getElementById('badge').textContent")
    print("zoom out ->", posted, "badge was", eff)
    assert posted[0]["type"] == "setFactor" and posted[0]["value"] > 1.0

    # explicit factor: badge becomes a 'back to fit' button
    page.evaluate("cfg => send({...cfg, factor: 3})", cfg)
    page.evaluate("send({type:'viewport', ranges:[{start:9,end:13}], selections:[{start:12,end:13}]})")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{out}/v2_factor3.png")
    page.evaluate("window.__posted = []")
    page.locator("#badge").click()
    assert {"type": "setFactor", "value": 0} in page.evaluate("window.__posted")

    # light theme
    page.evaluate("cfg => send(cfg)", cfg)
    page.evaluate("""() => {
        const r = document.documentElement.style;
        r.setProperty('--vscode-sideBar-background', '#f8f8f8'); r.setProperty('--vscode-editor-background', '#ffffff');
        r.setProperty('--vscode-editor-foreground', '#1f1f1f'); r.setProperty('--vscode-foreground', '#1f1f1f');
        r.setProperty('--vscode-notebook-cellEditorBackground', '#f8f8f8'); r.setProperty('--vscode-notebook-cellBorderColor', '#e5e5e5');
        r.setProperty('--vscode-descriptionForeground', '#717171');
    }""")
    page.evaluate("send({type:'viewport', ranges:[{start:9,end:13}], selections:[{start:12,end:13}]})")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{out}/v2_light.png")

    # sanitizer
    page.evaluate("""() => send({type:'render', usedImages: [], headings: [], cells:[{kind:'markup', html:'<h1 onclick="alert(1)">Hi</h1><img src=x onerror="window.pwned=1"><script>window.pwned=2</script>'}]})""")
    page.wait_for_timeout(200)
    assert page.evaluate("window.pwned") is None

    print("page errors:", errors)
    assert not errors

    # ---------------------------------------------------------- columns
    # Narrow, tall panel as in the user's screenshot; notebook repeated 3x so
    # it is long enough to scroll.
    page = b.new_page(viewport={"width": 250, "height": 640}, device_scale_factor=2)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    n = len(fixture["cells"])
    long_cells = fixture["cells"] * 3
    long_heads = [{**h, "index": h["index"] + r * n} for r in range(3) for h in fixture["headings"]]
    page.evaluate("cfg => send(cfg)", {**cfg, "columns": 2, "headingSize": 12})
    page.evaluate("""f => {
        send({type: 'images', images: f.images.map(i => ({...i, data: Uint8Array.from(atob(i.data), c => c.charCodeAt(0))}))});
        send({type: 'render', cells: f.cells, headings: f.headings, usedImages: f.usedImages});
    }""", {**fixture, "cells": long_cells, "headings": long_heads})
    page.evaluate("send({type:'viewport', ranges:[{start:9,end:13}], selections:[{start:12,end:13}]})")
    page.wait_for_timeout(700)
    page.screenshot(path=f"{out}/v3_two_columns.png")

    cols = page.evaluate("""[...document.querySelectorAll('.col')].map(c => { const r = c.getBoundingClientRect();
        return {left: r.left, right: r.right, top: r.top, bottom: r.bottom,
                strip: new DOMMatrix(getComputedStyle(c.querySelector('.strip')).transform).m42,
                imgs: [...c.querySelectorAll('img[data-img]')].map(i => i.complete && i.naturalWidth > 0)}; })""")
    print("columns:", [{k: (round(v, 1) if isinstance(v, float) else v) for k, v in c.items() if k != "imgs"} for c in cols])
    assert len(cols) == 2 and cols[0]["right"] <= cols[1]["left"], "two columns side by side"
    assert cols[0]["right"] - cols[0]["left"] > 100, "columns use the width"
    col_h = cols[0]["bottom"] - cols[0]["top"]
    assert abs((cols[0]["strip"] - cols[1]["strip"]) - col_h) < 1, "column 2 continues where column 1 ends"
    assert all(cols[1]["imgs"]) and len(cols[1]["imgs"]) == 21, "plots load in the cloned column too"

    # headings are readable: about 12-16 px on screen instead of ~2 px
    h = page.evaluate("""(() => { const el = document.querySelector('.col .cell[data-index="11"] h3');
        const r = el.getBoundingClientRect(); return {h: r.height, w: r.width}; })()""")
    print("h3 on screen:", h)
    assert 12 <= h["h"] <= 40

    # page stays still while the focus moves within it, turns when it leaves
    st0 = page.evaluate("document.getElementById('scroller').scrollTop")
    page.evaluate("send({type:'viewport', ranges:[{start:14,end:16}], selections:[{start:14,end:15}]})")
    page.wait_for_timeout(400)
    st1 = page.evaluate("document.getElementById('scroller').scrollTop")
    page.evaluate("send({type:'viewport', ranges:[{start:55,end:58}], selections:[{start:56,end:57}]})")
    page.wait_for_timeout(900)
    st2 = page.evaluate("document.getElementById('scroller').scrollTop")
    print("scrollTop:", st0, st1, st2)
    assert st1 == st0 and st2 > st1
    page.screenshot(path=f"{out}/v3_two_columns_later.png")
    on_screen = page.evaluate("""(() => { const v = document.getElementById('scroller').getBoundingClientRect();
        return [...document.querySelectorAll('.sel-cell')].some(s => { const r = s.getBoundingClientRect();
          const c = s.closest('.col').getBoundingClientRect(); return r.bottom > c.top && r.top < c.bottom; }); })()""")
    assert on_screen, "selection visible after page turn"

    # clicking a cell in the second column navigates to it
    page.evaluate("window.__posted = []")
    idx = page.evaluate("""(() => { const c = document.querySelectorAll('.col')[1].getBoundingClientRect();
        const el = document.elementFromPoint(c.left + 30, c.top + c.height / 2).closest('.cell'); return Number(el.dataset.index); })()""")
    c1 = cols[1]
    page.mouse.click(c1["left"] + 30, (c1["top"] + c1["bottom"]) / 2)
    posted = page.evaluate("window.__posted")
    print("click in column 2 ->", posted)
    assert {"type": "reveal", "index": idx} in posted

    # fixed zoom factor with columns: never crop the notebook (bug in 0.3.0)
    page.evaluate("cfg => send(cfg)", {**cfg, "columns": 2, "factor": 4, "headingSize": 12})
    page.wait_for_timeout(400)
    widths = page.evaluate("""[...document.querySelectorAll('.col')].map(c =>
        [c.getBoundingClientRect().width, c.querySelector('.doc').getBoundingClientRect().width])""")
    print("factor 4, 2 cols (col, page):", widths)
    assert all(abs(cw - pw) < 1 for cw, pw in widths), "page must fit its column"

    # text size settings
    page.evaluate("cfg => send(cfg)", {**cfg, "columns": 2, "headingSize": 14, "headingMaxLines": 0,
                                       "markdownTextSize": 10, "headingStripFontSize": 15})
    page.wait_for_timeout(400)
    sizes = page.evaluate("""(() => {
        const sc = s => { const el = document.querySelector(s); const r = el.getBoundingClientRect();
                          return {h: r.height, lines: Math.round(el.scrollHeight / parseFloat(getComputedStyle(el).lineHeight))}; };
        const p = document.querySelector('.col .cell[data-index="4"] .md p');
        return {h3: sc('.col .cell[data-index="11"] h3'),
                p_px: p.getBoundingClientRect().height / Math.max(1, Math.round(p.scrollHeight / parseFloat(getComputedStyle(p).lineHeight))),
                strip: getComputedStyle(document.querySelector('#sticky .crumb')).fontSize}; })()""")
    print("text sizes:", sizes)
    assert sizes["h3"]["lines"] >= 3, "headingMaxLines 0 shows the full heading"
    assert 11 <= sizes["p_px"] <= 15, "Markdown text is ~10px on screen (line height 1.3)"
    assert sizes["strip"] == "15px"
    page.screenshot(path=f"{out}/v4_text_sizes.png")

    # three columns, natural heading size
    page.evaluate("cfg => send(cfg)", {**cfg, "columns": 3, "headingSize": 0})
    page.wait_for_timeout(500)
    assert page.evaluate("document.querySelectorAll('.col').length") == 3
    assert "3 cols" in page.evaluate("document.getElementById('badge').textContent")
    page.screenshot(path=f"{out}/v3_three_columns.png")
    print("page errors:", errors)
    assert not errors
    b.close()
srv.shutdown()
print("HARNESS OK")
