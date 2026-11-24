import sys, glob, os, trimesh, numpy as np
for f in sorted(glob.glob(os.path.join(sys.argv[1], "*.stl"))):
    m = trimesh.load(f)
    edges = m.edges_sorted
    uniq, cnt = np.unique(edges, axis=0, return_counts=True)
    bad = uniq[cnt != 2]
    print(f"{os.path.basename(f):24s} watertight={m.is_watertight} winding={m.is_winding_consistent} volume={m.is_volume} "
          f"badEdges={len(bad)} vol={m.volume:.1f}")
    if len(bad) and "--v" in sys.argv:
        print("   e.g.", np.round(m.vertices[bad[:4]], 3).tolist())
