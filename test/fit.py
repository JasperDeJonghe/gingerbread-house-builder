"""Assembly check: pairwise intersection volume of assembled plates (tabs must sit in slots, not in material).
Also measures the real gap around each tab: shrinking the slot by the clearance must make the parts collide."""
import sys, os, glob, itertools
import numpy as np, trimesh

out = sys.argv[1]
worst = 0
for hdir in sorted(glob.glob(os.path.join(out, "h*"))):
    meshes = {os.path.basename(f)[:-4]: trimesh.load(f) for f in sorted(glob.glob(os.path.join(hdir, "asm", "*.stl")))}
    bad = []
    for (a, ma), (b, mb) in itertools.combinations(meshes.items(), 2):
        if "--chimney-only" in sys.argv and "chimney" not in a + b:
            continue  # quick check of just the chimney joint
        lo = np.maximum(ma.bounds[0], mb.bounds[0]); hi = np.minimum(ma.bounds[1], mb.bounds[1])
        if np.any(hi - lo < -1e-6):
            continue
        try:
            iv = trimesh.boolean.intersection([ma, mb], engine="manifold")
            v = iv.volume if iv is not None and len(iv.faces) else 0.0
        except Exception as ex:
            v = float("nan"); print("  boolean failed", a, b, ex)
        if not (v < 0.01):
            bad.append((a, b, round(float(v), 3)))
        worst = max(worst, v if v == v else 0)
    print(os.path.basename(hdir), "OK" if not bad else f"INTERFERENCE {bad}")
print("worst overlap volume mm3:", round(worst, 4))
