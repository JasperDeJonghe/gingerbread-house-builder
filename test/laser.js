// node test/laser.js OUTDIR -> laser-mode builds of every type, writes laser_sheet.svg/.dxf per type and checks them
const fs = require('fs'), path = require('path');
const GB = require('../gen.js');
const out = process.argv[2] || 'test/laser_out';
fs.mkdirSync(out, { recursive: true });
for (const ty of Object.keys(GB.TYPES)) {
  const P = Object.assign({}, GB.DEFAULTS, GB.TYPES[ty].preset, { type: ty, mode: 'laser', chimney: true, sheet: 3 });
  const h = GB.build(P);
  const items = GB.laserSheet(h.parts, 300);
  const svg = GB.laserSVG(items), dxf = GB.laserDXF(items);
  fs.writeFileSync(path.join(out, `laser_${ty}.svg`), svg);
  fs.writeFileSync(path.join(out, `laser_${ty}.dxf`), dxf);
  const size = svg.match(/width="([^"]+)" height="([^"]+)"/);
  const cut = (dxf.match(/\nCUT\n/g) || []).length, eng = (dxf.match(/\nENGRAVE\n/g) || []).length;
  const thick = Math.max(...h.parts.map(p => Math.max(...p.bodies.filter(b => b.role === 'plaat').map(b => b.c1 - b.c0))));
  console.log(`${ty.padEnd(10)} parts=${h.parts.length} chimney=${h.parts.some(p => p.id === '08_chimney')} sheet=${size[1]} x ${size[2]} ` +
    `plate thickness=${thick} cut-entities=${cut} engrave-entities=${eng} roof bevel=${h.parts.find(p => p.id === '05_roof_left').bodies[0].top.some((r, i) => r.some((q, j) => q[1] !== h.parts.find(p => p.id === '05_roof_left').bodies[0].poly[i][j][1]))}`);
}
