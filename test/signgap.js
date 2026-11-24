// Measures the sign joint of a stall: notch size in the roof vs leg size, and the narrowest gap across the ridge.
const GB = require('../gen.js');
const extra = JSON.parse(process.argv[2] || '{}');
const P = Object.assign({}, GB.DEFAULTS, GB.TYPES.kraam.preset, { type: 'kraam' }, extra);
const h = GB.build(P);
const roof = h.parts.find(p => p.id === '06_roof_right'), sign = h.parts.find(p => p.id === '08_sign');
const S = h.dims.S, t = P.t, p = P.pitch * Math.PI / 180;
// notch = the hole in the roof outline that touches the ridge edge (y = S)
const rings = roof.plate.flatMap(poly => poly);
let notch = null;
for (const r of rings) for (let i = 0; i < r.length; i++) {
  const a = r[i], b = r[(i + 1) % r.length];
  if (Math.abs(a[1] - S) < 1e-6 && Math.abs(b[1] - S) < 1e-6) continue;
}
// find notch x-extent: vertices at y == S - dn on the outer ring
const outer = roof.plate[0][0];
const low = outer.filter(q => q[1] < S - 1e-6 && q[1] > S - 3);
const ys = [...new Set(low.map(q => +q[1].toFixed(4)))];
const xs = low.map(q => q[0]).sort((a, b) => a - b);
const dn = S - Math.min(...low.map(q => q[1]));
const notchW = xs.length >= 2 ? xs[1] - xs[0] : NaN;
// legs: the sign outline below y = 0
const so = sign.plate[0][0], legPts = so.filter(q => q[1] < -0.01);
const legXs = legPts.map(q => q[0]).sort((a, b) => a - b);
const legW = legXs.length >= 2 ? Math.max(...legPts.filter(q => q[0] < 0).map(q => q[0])) - Math.min(...legPts.filter(q => q[0] < 0).map(q => q[0])) : NaN;
const legLen = -Math.min(...legPts.map(q => q[1]));
const gapBottom = 2 * dn * Math.cos(p);       // across the ridge, at the roof's underside (narrowest)
console.log(JSON.stringify({
  notchAlongRidge: +notchW.toFixed(3), legWidth: +legW.toFixed(3), playAlongRidgePerSide: +((notchW - legW) / 2).toFixed(3),
  narrowestGapAcrossRidge: +gapBottom.toFixed(3), legThickness: t, playAcrossPerSide: +((gapBottom - t) / 2).toFixed(3),
  legLength: +legLen.toFixed(2), notchDepthAlongSlope: +dn.toFixed(3),
}, null, 1));
