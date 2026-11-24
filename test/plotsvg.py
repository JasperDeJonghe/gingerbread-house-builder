"""Render a laser_sheet.svg (red cut paths, black engrave fills) to PNG to eyeball it."""
import sys, re
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.path import Path
from matplotlib.patches import PathPatch

svg = open(sys.argv[1], encoding="utf-8").read()
W = float(re.search(r'width="([\d.]+)mm"', svg).group(1)); H = float(re.search(r'height="([\d.]+)mm"', svg).group(1))
fig, ax = plt.subplots(figsize=(W / 25, H / 25))
def paths(group):
    body = re.search(r'<g id="%s"[^>]*>(.*?)</g>' % group, svg, re.S).group(1)
    for d in re.findall(r' d="([^"]*)"', body):
        verts, codes = [], []
        for sub in re.findall(r"M([^Z]*)Z", d):
            pts = [tuple(map(float, p.split())) for p in sub.split("L")]
            verts += pts + [pts[0]]; codes += [Path.MOVETO] + [Path.LINETO] * (len(pts) - 1) + [Path.CLOSEPOLY]
        if verts:
            yield Path(verts, codes)
for pth in paths("engrave"):
    ax.add_patch(PathPatch(pth, facecolor="black", edgecolor="none"))
for pth in paths("cut"):
    ax.add_patch(PathPatch(pth, facecolor="none", edgecolor="red", lw=0.4))
ax.set_xlim(0, W); ax.set_ylim(H, 0); ax.set_aspect("equal"); ax.axis("off")
plt.tight_layout(); plt.savefig(sys.argv[2], dpi=90)
print("size mm", W, H)
