"""Builds a realistic test notebook (with real matplotlib outputs) for the minimap tests."""
import base64, io, json, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

def png(fig, dpi=100):
    buf = io.BytesIO(); fig.savefig(buf, format="png", dpi=dpi); plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()

def md(src): return {"cell_type": "markdown", "metadata": {}, "source": src}
n = [0]
def code(src, outputs=()):
    n[0] += 1
    return {"cell_type": "code", "execution_count": n[0], "metadata": {}, "source": src, "outputs": list(outputs)}
def stream(text, name="stdout"): return {"output_type": "stream", "name": name, "text": text}
def image(b64, w=None):
    meta = {"image/png": {"width": w}} if w else {}
    return {"output_type": "display_data", "data": {"image/png": b64, "text/plain": "<Figure>"}, "metadata": meta}

rng = np.random.default_rng(0)
ppm = np.linspace(160, 190, 800)
def spectrum(peaks):
    y = sum(a / (1 + ((ppm - c) / 0.4) ** 2) for c, a in peaks)
    return y + rng.normal(0, 0.03, ppm.size)

cells = [md("# Plot linear cryo in vivo kidney pH imaging\nAnalysis of hyperpolarized ZOMPD-1 kidney data.")]
cells.append(md("## Load data"))
cells.append(code("import numpy as np\nimport matplotlib.pyplot as plt\nimport hypermri\nfrom study_config import *\n\ncsi = hypermri.load('scan_27')\nprint(csi.shape)",
                  [stream("Loading scan 27 ... done\n(8, 16, 16, 1024)\n")]))
fig, ax = plt.subplots(figsize=(6, 4)); ax.plot(ppm, spectrum([(171, 1), (175, .6), (182, .8)])); ax.invert_xaxis(); ax.set_title("Mean spectrum")
cells.append(code("plt.plot(csi.freq_axis_ppm, csi.mean_spectrum())\nplt.gca().invert_xaxis()", [image(png(fig))]))
cells.append(md("## Masking\nDraw kidney ROIs on the anatomical image."))
fig, axs = plt.subplots(1, 3, figsize=(12, 4))
for a in axs: a.imshow(rng.random((32, 32)), cmap="gray"); a.axis("off")
cells.append(code("fig, ax = plt.subplots(1, 3, figsize=(12, 4))\nfor i, a in enumerate(ax):\n    a.imshow(anat[i], cmap='gray')\n    a.contour(mask[i], colors='r')", [image(png(fig))]))
cells.append(md("## Filter CSI data"))
cells.append(code("csi_f = csi.filter(kind='gauss', lb=10)\n" + "\n".join(f"# step {i}: tweak parameter {i}" for i in range(12)),
                  [stream("\n".join(f"voxel {i}: SNR = {rng.uniform(5, 40):.1f}" for i in range(55)) + "\n")]))
cells.append(md("## Fitting"))
long = "\n".join([
    "fig, ax = plt.subplots(3, 5, figsize=(18, 10))",
    *[f"ax[{i//5}, {i%5}].plot(csi.freq_axis_ppm, np.abs(fit_results.isel(voxel={i})), color='crimson', linewidth=1)" for i in range(15)],
    "", "# for f, freq in enumerate(fit_results['fit_freqs'].values):", "#     ax.axvline(freq, color='crimson', linestyle='--')",
    *[f"ax[{i//5}, {i%5}].invert_xaxis()" for i in range(15)],
    "plt.tight_layout()", "plt.savefig('fit_comparison.png', dpi=300)"])
fig, axs = plt.subplots(3, 5, figsize=(18, 10))
for i, a in enumerate(axs.flat):
    a.plot(ppm, spectrum([(171 + i * .1, 1), (182, .5 + i * .02)]), color="gray", lw=2)
    a.plot(ppm, spectrum([(171 + i * .1, 1), (182, .5 + i * .02)]), color="crimson", lw=1); a.invert_xaxis()
plt.tight_layout()
cells.append(code(long, [image(png(fig, dpi=72), w=None)]))
# ipympl (%matplotlib widget): no image/png, only a text/html snapshot with an
# embedded data URL plus the widget view. Mirrors ipympl's _repr_mimebundle_.
fig, axs = plt.subplots(1, 5, figsize=(12, 2.4), dpi=100)
for a in axs: a.imshow(rng.random((24, 32)), cmap="magma"); a.axis("off")
snap = png(fig)
ipympl_html = ('\n            <div style="display: inline-block;">\n                <div class="jupyter-widgets widget-label" style="text-align: center;">\n                    Figure 96\n                </div>\n'
               f"                <img src='data:image/png;base64,{snap}' width=1200.0/>\n            </div>\n        ")
cells.append(code("%matplotlib widget\nfig, ax = plt.subplots(1, 5, figsize=(12, 2.4))\nplt.savefig('voigt_fit_amps.svg', dpi=600)", [{
    "output_type": "display_data", "metadata": {},
    "data": {"text/plain": "Canvas(toolbar=Toolbar(toolitems=[('Home', 'Reset original view', 'home', 'home'), ('Back', 'Back to previous view', 'arrow-left', 'back')]))",
             "text/html": ipympl_html,
             "application/vnd.jupyter.widget-view+json": {"version_major": 2, "version_minor": 0, "model_id": "abc123"}}}]))
cells.append(md("### Compare the fit results of the Lorentzian and Voigt fitting"))
cells.append(code("result = compare(fit_lorentz, fit_voigt)\nresult.summary()", [{
    "output_type": "execute_result", "execution_count": n[0] + 1, "metadata": {},
    "data": {"text/plain": "table", "text/html": "<table class='dataframe'><thead><tr><th></th><th>pH</th><th>err</th></tr></thead><tbody>"
             + "".join(f"<tr><th>{i}</th><td>{7.1 + i * .02:.2f}</td><td>{.03:.2f}</td></tr>" for i in range(8)) + "</tbody></table>"}}]))
cells.append(md("## New Fitting\n### Align data to fitted ZOMPD1 frequency"))
cells.append(code("aligned = align(csi_f, ref='ZOMPD1')\nraise_if_bad(aligned)", [{
    "output_type": "error", "ename": "ValueError", "evalue": "alignment failed for 3 voxels",
    "traceback": ["\x1b[0;31m---------------------------------------------------------------------------\x1b[0m",
                  "\x1b[0;31mValueError\x1b[0m                                Traceback (most recent call last)",
                  "Cell \x1b[0;32mIn[14], line 2\x1b[0m\n      1 aligned = align(csi_f, ref='ZOMPD1')\n----> 2 raise_if_bad(aligned)",
                  "\x1b[0;31mValueError\x1b[0m: alignment failed for 3 voxels"]}]))
for k in ["1st", "2nd", "3rd"]:
    cells.append(md(f"### Add {k} kidney peak"))
    fig, ax = plt.subplots(figsize=(7, 3)); ax.plot(ppm, spectrum([(171, 1), (175 + len(k), .7)])); ax.invert_xaxis()
    cells.append(code(f"fit_{k[0]} = add_peak(fit, center=17{len(k)}, width=0.4)\nfit_{k[0]}.plot()", [image(png(fig))]))
cells.append(md("### Add ZA peak"))
cells.append(code("fig = plotly_overview(fit)", [{"output_type": "display_data", "metadata": {},
    "data": {"application/vnd.plotly.v1+json": {"data": []}, "text/plain": "Figure()"}}]))
cells.append(code(""))

nb = {"cells": cells, "metadata": {"kernelspec": {"name": "python3", "language": "python", "display_name": "Python 3"},
      "language_info": {"name": "python"}}, "nbformat": 4, "nbformat_minor": 5}
json.dump(nb, open(sys.argv[1], "w"), indent=1)
print(len(cells), "cells")
