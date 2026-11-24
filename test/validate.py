"""Import every generated STEP with OpenCascade: check validity, solid count and volume."""
import sys, os, json, glob
import cadquery as cq
from OCP.BRepCheck import BRepCheck_Analyzer
import trimesh

out = sys.argv[1]
exp = json.load(open(os.path.join(out, "expected.json")))
bad = 0
for key, e in sorted(exp.items()):
    f = os.path.join(out, key + ".step")
    shp = cq.importers.importStep(f).val()
    solids = shp.Solids() if hasattr(shp, "Solids") else []
    ok = BRepCheck_Analyzer(shp.wrapped).IsValid()
    vol = sum(s.Volume() for s in solids)
    rel = abs(vol - e["vol"]) / max(e["vol"], 1e-9)
    neg = [s for s in solids if s.Volume() <= 0]
    m = trimesh.load(f[:-5] + ".stl")
    mrel = abs(m.volume - e["vol"]) / e["vol"]
    flag = (not ok) or rel > 1e-4 or neg or len(solids) != e["solids"] or mrel > 1e-3
    bad += bool(flag)
    if flag or "--all" in sys.argv:
        print(f"{'BAD ' if flag else 'ok  '}{key:32s} valid={ok} solids={len(solids)}/{e['solids']} vol={vol:.2f} exp={e['vol']:.2f} rel={rel:.2e} neg={len(neg)} stlrel={mrel:.1e}")
print(f"checked {len(exp)} parts, {bad} problems")
