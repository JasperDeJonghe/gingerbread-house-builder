// node test/run.js OUTDIR [nSeeds]  -> builds random houses, writes STEP/STL/DXF/SVG + expected volumes
const fs = require('fs'), path = require('path');
const GB = require('../gen.js');
const out = process.argv[2] || 'out';
const n = +(process.argv[3] || 12);
fs.mkdirSync(out, { recursive: true });
const ringArea = r => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const expected = {};
let worst = 0;
global.minA = { v: Infinity }; global.minT = { v: Infinity };
for (let s = 1; s <= n; s++) {
  const types = Object.keys(GB.TYPES), extra = JSON.parse(process.argv[4] || '{}');
  const type = extra.type || types[s % types.length];
  const params = Object.assign(s === 1 && !extra.type ? Object.assign({}, GB.DEFAULTS) : GB.randomParams(s * 101, { type }), extra);
  if (s % 4 === 0) { params.cutWindows = true; params.cutDoor = true; }
  const t0 = Date.now();
  const house = GB.build(params);
  const ms = Date.now() - t0;
  worst = Math.max(worst, ms);
  const dir = path.join(out, 'h' + s);
  fs.mkdirSync(dir, { recursive: true });
  const all = [];
  // the white border must stay whole: no slot zone may reach into the border band
  const pc = require('polygon-clipping');
  const mpArea = mp => mp.reduce((a, poly) => a + poly.reduce((b, r, i) => b + (i ? -1 : 1) * Math.abs(ringArea(r.slice(0, -1))), 0), 0);
  // printability: smallest and thinnest icing island
  for (const pt of house.parts) for (const poly of pt.icing) {
    const A = poly.reduce((a, r, i) => a + (i ? -1 : 1) * Math.abs(ringArea(r)), 0);
    let per = 0;
    for (const r of poly) for (let i = 0; i < r.length; i++) per += Math.hypot(r[(i + 1) % r.length][0] - r[i][0], r[(i + 1) % r.length][1] - r[i][1]);
    if (A < global.minA.v) global.minA = { v: A, where: `h${s} ${pt.id}` };
    if (2 * A / per < global.minT.v) global.minT = { v: 2 * A / per, where: `h${s} ${pt.id}` };
  }
  for (const pt of house.parts) {
    if (!pt.check) continue;
    const ov = mpArea(pc.intersection(pt.check.band, pt.check.slots));
    if (ov > 1e-4) console.log(`  BORDER CUT h${s} ${pt.id}: ${ov.toFixed(4)} mm2`);
  }
  const lay = GB.layout(house.parts, 220);
  for (const pt of house.parts) {
    fs.writeFileSync(path.join(dir, pt.id + '.step'), GB.toSTEP(pt));
    const m = GB.meshPart(pt);
    fs.writeFileSync(path.join(dir, pt.id + '.stl'), Buffer.from(GB.toSTL([m.plaat, m.glazuur], pt.id)));
    fs.writeFileSync(path.join(dir, pt.id + '.dxf'), GB.toDXF(pt));
    fs.writeFileSync(path.join(dir, pt.id + '.svg'), GB.toSVG(pt));
    const mm = GB.meshPart(pt, lay.frames[pt.id]);
    all.push(mm.plaat, mm.glazuur);
    let vol = 0;
    for (const b of pt.bodies) {
      const A = rs => rs.reduce((a, r) => a + ringArea(r), 0);
      vol += (A(b.poly) + A(b.top || b.poly)) / 2 * (b.c1 - b.c0);
    }
    // assembled plate (no icing) per part, for the interference test
    fs.mkdirSync(path.join(dir, 'asm'), { recursive: true });
    const pa = GB.meshPart(pt, pt.place);
    fs.writeFileSync(path.join(dir, 'asm', pt.id + '.stl'), Buffer.from(GB.toSTL([pa.plaat], pt.id)));
    expected[`h${s}/${pt.id}`] = { vol, solids: pt.bodies.length };
  }
  fs.writeFileSync(path.join(dir, 'alles_printplaat.stl'), Buffer.from(GB.toSTL(all, 'alles')));
  // assembled house as one STL for a visual sanity check
  const asm = [];
  for (const pt of house.parts) { const m = GB.meshPart(pt, pt.place); asm.push(m.plaat, m.glazuur); }
  fs.writeFileSync(path.join(dir, 'in_elkaar.stl'), Buffer.from(GB.toSTL(asm, 'huis')));
  const r = house.resolved;
  console.log(`h${s}: ${r.type} ${ms}ms parts=${house.parts.length} gevel=${r.gable} deur=${r.door}/${r.doorPos} extra=${r.extraDoor} dak=${r.roofPattern} rand=${r.border} muur=${r.wallPattern} ` +
    `icingIslands=${house.parts.map(p => p.icing.length).join(',')} layout=${lay.size.map(v => v.toFixed(0)).join('x')}`);
}
fs.writeFileSync(path.join(out, 'expected.json'), JSON.stringify(expected, null, 1));
console.log('slowest build', worst, 'ms');
console.log(`smallest icing island ${global.minA.v.toFixed(3)} mm2 (${global.minA.where}), thinnest ${global.minT.v.toFixed(3)} mm (${global.minT.where})`);
