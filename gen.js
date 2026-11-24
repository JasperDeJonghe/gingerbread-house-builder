/* Peperkoekhuis generator: geometry, icing patterns and exporters (STEP, STL, DXF, SVG).
   Runs in the browser (window.GB) and in Node (module.exports) for testing.
   Units: millimetres. Every part is a plate (z 0..t) with icing on top (z t..t+ih),
   except the roof plates (ridge miter) and the chimney (a thick block). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('polygon-clipping'), require('earcut'));
  else root.GB = factory(root.polygonClipping, root.earcut);
})(typeof self !== 'undefined' ? self : this, function (pcIn, earcutIn) {
  'use strict';
  const pc = pcIn && pcIn.default ? pcIn.default : pcIn;
  const earcut = earcutIn && earcutIn.default ? earcutIn.default : earcutIn;
  const TAU = Math.PI * 2;

  // ------------------------------------------------------------------ random
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash32(x) {
    x = (x >>> 0) ^ 0x9e3779b9;
    x = Math.imul(x ^ x >>> 16, 0x85ebca6b); x = Math.imul(x ^ x >>> 13, 0xc2b2ae35);
    return (x ^ x >>> 16) >>> 0;
  }
  function Rnd(seed) {
    const r = mulberry32(hash32(seed));
    for (let i = 0; i < 3; i++) r();
    return {
      f: r,
      range: (a, b) => a + (b - a) * r(),
      int: (a, b) => a + Math.floor(r() * (b - a + 1)),
      pick: arr => arr[Math.floor(r() * arr.length)],
      chance: p => r() < p,
    };
  }

  // ------------------------------------------------------------------ 2D shapes (open rings)
  const segs = r => Math.max(10, Math.min(64, Math.ceil(TAU * r / 0.35)));
  function circle(cx, cy, r, n) {
    n = n || segs(r); const p = [];
    for (let i = 0; i < n; i++) { const a = i / n * TAU; p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return p;
  }
  function ellipse(cx, cy, rx, ry, rot) {
    const n = segs(Math.max(rx, ry)), c = Math.cos(rot || 0), s = Math.sin(rot || 0), p = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU, x = rx * Math.cos(a), y = ry * Math.sin(a);
      p.push([cx + x * c - y * s, cy + x * s + y * c]);
    }
    return p;
  }
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  function arc(cx, cy, r, a0, a1, step) {
    const n = Math.max(3, Math.ceil(Math.abs(a1 - a0) * r / (step || 0.3))), p = [];
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return p;
  }
  function roundRect(x0, y0, x1, y1, r) {
    const p = [];
    p.push(...arc(x1 - r, y0 + r, r, -Math.PI / 2, 0));
    p.push(...arc(x1 - r, y1 - r, r, 0, Math.PI / 2));
    p.push(...arc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI));
    p.push(...arc(x0 + r, y0 + r, r, Math.PI, 1.5 * Math.PI));
    return dedupe(p, true);
  }
  // rectangle with a semicircular top; total height h, bottom at y0
  function archShape(cx, y0, w, h) {
    const r = w / 2, ys = y0 + Math.max(h - r, 0.05);
    return dedupe([[cx - r, y0], [cx + r, y0], ...arc(cx, ys, r, 0, Math.PI)], true);
  }
  function heart(cx, cy, s) {
    const p = [];
    for (let i = 0; i < 56; i++) {
      const t = i / 56 * TAU, x = 16 * Math.pow(Math.sin(t), 3);
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      p.push([cx + x * s / 34, cy + (y + 2.5) * s / 34]);
    }
    return ccw(p);
  }
  function star(cx, cy, ro, ri, n) {
    const p = [];
    for (let i = 0; i < 2 * n; i++) {
      const a = Math.PI / 2 + i * Math.PI / n, r = i % 2 ? ri : ro;
      p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return p;
  }

  // ------------------------------------------------------------------ ring utilities
  function area(r) {
    let a = 0;
    for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
    return a / 2;
  }
  const ccw = r => (area(r) < 0 ? r.slice().reverse() : r);
  function dedupe(pts, closed) {
    const out = [];
    for (const p of pts) {
      const q = out[out.length - 1];
      if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4) out.push(p);
    }
    if (closed && out.length > 1) {
      const a = out[0], b = out[out.length - 1];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-4) out.pop();
    }
    return out;
  }
  // remove near-collinear vertices (keeps exports lean)
  function simplify(r, tol) {
    tol = tol || 1e-4;
    let pts = dedupe(r, true), changed = true;
    while (changed && pts.length > 3) {
      changed = false;
      const out = [];
      for (let i = 0, n = pts.length; i < n; i++) {
        const a = out.length ? out[out.length - 1] : pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
        const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
        const d = L < 1e-9 ? 0 : Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / L;
        if (d < tol && L > 1e-9) { changed = true; continue; }
        out.push(b);
      }
      pts = out;
    }
    return pts;
  }
  // offset a ring: d > 0 grows, d < 0 shrinks (miter joins, bevel on spikes)
  function offsetRing(r, d) {
    r = ccw(dedupe(r, true));
    const n = r.length, out = [];
    for (let i = 0; i < n; i++) {
      const a = r[(i - 1 + n) % n], b = r[i], c = r[(i + 1) % n];
      const e1x = b[0] - a[0], e1y = b[1] - a[1], e2x = c[0] - b[0], e2y = c[1] - b[1];
      const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
      const n1x = e1y / l1, n1y = -e1x / l1, n2x = e2y / l2, n2y = -e2x / l2;
      const k = 1 + n1x * n2x + n1y * n2y;
      if (k < 0.3) {
        out.push([b[0] + n1x * d, b[1] + n1y * d], [b[0] + n2x * d, b[1] + n2y * d]);
      } else {
        out.push([b[0] + (n1x + n2x) * d / k, b[1] + (n1y + n2y) * d / k]);
      }
    }
    return out;
  }
  function pointInRing(r, x, y) {
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i], b = r[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  function distToRing(r, x, y) {
    let d = Infinity;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[j], b = r[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      const u = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)) : 0;
      d = Math.min(d, Math.hypot(x - a[0] - u * dx, y - a[1] - u * dy));
    }
    return d;
  }
  function turnAng(a, b, c) {
    const x1 = b[0] - a[0], y1 = b[1] - a[1], x2 = c[0] - b[0], y2 = c[1] - b[1];
    return Math.atan2(x1 * y2 - y1 * x2, x1 * x2 + y1 * y2);
  }

  // ------------------------------------------------------------------ boolean geometry (polygon-clipping MultiPolygons)
  const closeR = r => { const a = r.map(p => [p[0], p[1]]); a.push([r[0][0], r[0][1]]); return a; };
  const G = ring => [[closeR(ring)]];
  const nonEmpty = g => g && g.length;
  function union(list) {
    list = list.filter(nonEmpty);
    if (!list.length) return [];
    let acc = list[0];
    for (let i = 1; i < list.length; i += 40) {
      const ch = list.slice(i, i + 40);
      try { acc = pc.union(acc, ...ch); } catch (e) {
        for (const g of ch) { try { acc = pc.union(acc, g); } catch (e2) { /* skip degenerate piece */ } }
      }
    }
    return acc;
  }
  function diff(a, ...b) {
    b = b.filter(nonEmpty);
    if (!nonEmpty(a) || !b.length) return a || [];
    try { return pc.difference(a, ...b); } catch (e) {
      let r = a;
      for (const g of b) { try { r = pc.difference(r, g); } catch (e2) { /* keep */ } }
      return r;
    }
  }
  function inter(a, b) {
    if (!nonEmpty(a) || !nonEmpty(b)) return [];
    try { return pc.intersection(a, b); } catch (e) { return []; }
  }
  // clean a MultiPolygon into open, simplified rings: [[outer(ccw), hole(cw)...], ...]
  // minThick: drop islands whose mean thickness (2 * area / perimeter) is below it (slivers that can't print)
  function cleanMP(mp, minArea, minThick) {
    const out = [];
    for (const poly of mp || []) {
      const rings = [];
      poly.forEach((ring, i) => {
        let r = simplify(ring.slice(0, -1));
        if (r.length < 3 || Math.abs(area(r)) < (minArea || 1e-3)) { if (i === 0) rings.length = 0; return; }
        r = ccw(r);
        rings.push(i === 0 ? r : r.slice().reverse());
      });
      if (!rings.length) continue;
      const A = rings.reduce((s, r, i) => s + (i ? -1 : 1) * Math.abs(area(r)), 0);
      if (A < (minArea || 1e-3)) continue;
      if (minThick) {
        let per = 0;
        for (const r of rings) for (let i = 0; i < r.length; i++) per += Math.hypot(r[(i + 1) % r.length][0] - r[i][0], r[(i + 1) % r.length][1] - r[i][1]);
        if (2 * A / per < minThick) continue;
      }
      out.push(rings);
    }
    return out;
  }

  // scale by k and move by (dx, dy): works on a geometry (MultiPolygon with closed rings)
  const xfG = (g, k, dx, dy) => (g || []).map(poly => poly.map(r => r.map(q => [q[0] * k + dx, q[1] * k + dy])));
  // optional text renderer (set by the web page): (text, maxW, maxH) -> MultiPolygon in mm centred on (0,0)
  let textRenderer = null;
  const setTextRenderer = fn => { textRenderer = fn; };

  // ------------------------------------------------------------------ strokes
  function strokeClosed(ring, w) {
    const outer = offsetRing(ring, w / 2), inner = offsetRing(ring, -w / 2);
    if (area(inner) <= 1e-4 || Math.abs(area(inner)) >= Math.abs(area(outer))) return G(outer);
    return [[closeR(ccw(outer)), closeR(ccw(inner).reverse())]];
  }
  function strokeSeg(a, b, w) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    if (L < 1e-6) return [];
    const nx = -dy / L * w / 2, ny = dx / L * w / 2;
    return G([[a[0] + nx, a[1] + ny], [a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny]]);
  }
  // open polyline with round caps; splits at sharp corners and rounds those joints
  function strokeOpen(pts, w) {
    pts = dedupe(pts, false);
    if (pts.length < 2) return [];
    const h = w / 2, out = [], runs = [];
    let cur = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      cur.push(pts[i]);
      if (i < pts.length - 1 && Math.abs(turnAng(pts[i - 1], pts[i], pts[i + 1])) > 0.7) { runs.push(cur); cur = [pts[i]]; }
    }
    runs.push(cur);
    for (const run of runs) {
      const n = run.length, L = [], Rr = [];
      for (let i = 0; i < n; i++) {
        let nx, ny;
        if (i === 0 || i === n - 1) {
          const a = run[i === 0 ? 0 : n - 2], b = run[i === 0 ? 1 : n - 1];
          const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
          nx = -dy / l; ny = dx / l;
        } else {
          const a = run[i - 1], b = run[i], c = run[i + 1];
          const d1x = b[0] - a[0], d1y = b[1] - a[1], l1 = Math.hypot(d1x, d1y) || 1;
          const d2x = c[0] - b[0], d2y = c[1] - b[1], l2 = Math.hypot(d2x, d2y) || 1;
          const n1x = -d1y / l1, n1y = d1x / l1, n2x = -d2y / l2, n2y = d2x / l2;
          const k = 1 + n1x * n2x + n1y * n2y;
          nx = (n1x + n2x) / k; ny = (n1y + n2y) / k;
        }
        L.push([run[i][0] + nx * h, run[i][1] + ny * h]);
        Rr.push([run[i][0] - nx * h, run[i][1] - ny * h]);
      }
      out.push(G(L.concat(Rr.reverse())));
    }
    out.push(G(circle(pts[0][0], pts[0][1], h)), G(circle(pts[pts.length - 1][0], pts[pts.length - 1][1], h)));
    for (let r = 1; r < runs.length; r++) out.push(G(circle(runs[r][0][0], runs[r][0][1], h)));
    return out;
  }

  // even samples along a ring (closed) with inward normals (for a ccw ring)
  function samplePath(ring, step, closed) {
    const P = closed ? ring.concat([ring[0]]) : ring.slice();
    const seg = [];
    let tot = 0;
    for (let i = 0; i < P.length - 1; i++) { const l = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); seg.push(l); tot += l; }
    const n = Math.max(1, Math.round(tot / step)), ds = tot / n, out = [];
    let si = 0, acc = 0;
    for (let k = 0; k < (closed ? n : n + 1); k++) {
      const s = Math.min(k * ds, tot - 1e-9);
      while (si < seg.length - 1 && acc + seg[si] < s) { acc += seg[si]; si++; }
      const t = seg[si] ? (s - acc) / seg[si] : 0, a = P[si], b = P[si + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      out.push({ p: [a[0] + dx * t, a[1] + dy * t], n: [-dy / l, dx / l], s });
    }
    return { pts: out, len: tot, ds };
  }

  // decorative line along a closed ring
  function borderAlong(ring, style, lw) {
    ring = ccw(ring);
    if (style === 'lijn') return [strokeClosed(ring, lw)];
    if (style === 'stippen') {
      return samplePath(ring, Math.max(2.2, lw * 2.9), true).pts.map(q => G(circle(q.p[0], q.p[1], lw * 0.72)));
    }
    if (style === 'zigzag') {
      const amp = Math.max(0.55, lw * 0.75), sm = samplePath(ring, Math.max(1.3, lw * 1.7), true);
      const pts = sm.pts.map((q, i) => { const o = (i % 2 ? 1 : -1) * amp; return [q.p[0] + q.n[0] * o, q.p[1] + q.n[1] * o]; });
      pts.push(pts[0]);
      return strokeOpen(pts, lw);
    }
    if (style === 'golf') {
      const amp = Math.max(0.5, lw * 0.7), per = Math.max(3.2, lw * 4.5), sm = samplePath(ring, 0.25, true);
      const pts = sm.pts.map(q => { const o = amp * Math.sin(TAU * q.s / per); return [q.p[0] + q.n[0] * o, q.p[1] + q.n[1] * o]; });
      pts.push(pts[0]);
      return strokeOpen(pts, lw);
    }
    if (style === 'schulp') {
      const sm = samplePath(ring, Math.max(2.4, lw * 3.2), true), P = sm.pts.map(q => q.p), pts = [];
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
        const r = L / 2, nx = -uy, ny = ux; // inward (left of ccw travel)
        for (let k = 0; k <= 8; k++) {
          const th = Math.PI * k / 8;
          pts.push([mx - ux * r * Math.cos(th) + nx * r * Math.sin(th) * 0.8, my - uy * r * Math.cos(th) + ny * r * Math.sin(th) * 0.8]);
        }
      }
      return strokeOpen(pts, lw);
    }
    return [];
  }
  const borderDepth = (style, lw) => (style === 'zigzag' ? Math.max(0.55, lw * 0.75) : style === 'golf' ? Math.max(0.5, lw * 0.7) : style === 'schulp' ? Math.max(2.4, lw * 3.2) * 0.4 : 0);

  // ------------------------------------------------------------------ fill patterns
  // Every row/element is laid out so it fits WHOLE inside the box [x0,x1]x[y0,y1]: nothing gets sliced
  // against a neighbouring border or snow edge. keep(x, y, r) can veto single elements (dots, flakes).
  function fitted(lo, hi, step) {            // evenly spread positions in [lo, hi], centred, about `step` apart
    if (hi < lo) return [];
    const n = Math.floor((hi - lo) / step + 1e-9) + 1, s0 = lo + ((hi - lo) - (n - 1) * step) / 2;
    return Array.from({ length: n }, (_, i) => s0 + i * step);
  }
  function fillPattern(style, x0, y0, x1, y1, lw, rnd, keep, opts) {
    const g = [], h = lw / 2;
    keep = keep || (() => true);
    const frame = !opts || opts.frame !== false, sc = (opts && opts.scale) || 1;
    if (style === 'schubben') {
      const r = rnd.range(1.4, 2.0), rs = r * 1.45;
      // each row is a chain of arcs hanging below y; whole arcs only, odd rows shifted half an arc
      fitted(y0 + r + h, y1 - h, rs).reverse().forEach((y, k) => {
        const shift = k % 2 ? r : 0, n = Math.floor((x1 - x0 - 2 * h - shift) / (2 * r));
        if (n < 1) return;
        const xs = x0 + h + shift + ((x1 - x0 - 2 * h - shift) - n * 2 * r) / 2, pts = [];
        for (let i = 0; i < n; i++) pts.push(...arc(xs + (2 * i + 1) * r, y, r, Math.PI, 2 * Math.PI, 0.25));
        g.push(...strokeOpen(pts, lw));
      });
    } else if (style === 'pannen' || style === 'bakstenen') {
      const brick = style === 'bakstenen';
      const rs = sc * (brick ? rnd.range(2.6, 3.2) : rnd.range(3.0, 3.8)), bw = rs * (brick ? 2.1 : 1.5), w = brick ? lw * 0.7 : lw;
      const xa = x0 + w / 2, xb = x1 - w / 2, ys = fitted(y0 + w / 2, y1 - w / 2, rs);
      if (ys.length < 2) return g;
      ys.forEach(y => g.push(strokeSeg([xa, y], [xb, y], w)));
      if (frame) for (const x of [xa, xb]) g.push(strokeSeg([x, ys[0]], [x, ys[ys.length - 1]], w));
      for (let k = 0; k < ys.length - 1; k++)
        for (let x = xa + (k % 2 ? bw / 2 : bw); x < xb - 1; x += bw) g.push(strokeSeg([x, ys[k]], [x, ys[k + 1]], w));
    } else if (style === 'planken') {
      // horizontal board siding (barns)
      const rs = sc * rnd.range(2.2, 2.6), w = lw * 0.6;
      for (const y of fitted(y0 + w / 2, y1 - w / 2, rs)) g.push(strokeSeg([x0 + w / 2, y], [x1 - w / 2, y], w));
    } else if (style === 'stippen' || style === 'sneeuwvlok') {
      const flake = style === 'sneeuwvlok';
      const dx = flake ? rnd.range(7, 9) : rnd.range(3.0, 3.8), dy = dx * 0.87, rr = flake ? 1.3 + lw * 0.35 : lw * 0.75;
      fitted(y0 + rr, y1 - rr, dy).forEach((y, k) => {
        for (const x of fitted(x0 + rr + (k % 2 ? dx / 2 : 0), x1 - rr, dx)) {
          if (!keep(x, y, rr)) continue;
          if (!flake) { g.push(G(circle(x, y, rr))); continue; }
          for (let i = 0; i < 3; i++) {
            const a = i * Math.PI / 3, r = 1.3;
            g.push(strokeSeg([x - r * Math.cos(a), y - r * Math.sin(a)], [x + r * Math.cos(a), y + r * Math.sin(a)], lw * 0.7));
          }
        }
      });
    } else if (style === 'golf') {
      const rs = sc * rnd.range(3.0, 3.8), amp = rs * 0.22, per = rs * 1.3;
      for (const y of fitted(y0 + amp + h, y1 - amp - h, rs)) {
        const pts = [];
        for (let x = x0 + h; x <= x1 - h + 1e-9; x += 0.25) pts.push([x, y + amp * Math.sin(TAU * (x - x0) / per)]);
        g.push(...strokeOpen(pts, lw));
      }
    }
    return g;
  }

  // ------------------------------------------------------------------ snow edge along the roof's eave
  // Drawn inside the box x0..x1, y0..y0+hgt (just inside the border band), so border and snow both show.
  // returns { g: geoms, top: highest y it reaches (0 = none) }
  const SNOW_EDGES = ['druppels', 'ijspegels', 'golf', 'bolletjes', 'geen'];
  function snowEdge(style, x0, x1, y0, hgt, rr) {
    const g = [];
    if (style === 'geen') return { g, top: 0 };
    if (style === 'druppels') {
      const b = hgt * 0.45;
      g.push(G(rect(x0, y0 + b, x1, y0 + hgt)));
      for (let x = x0 + 1.2; x < x1 - 1.2; x += rr.range(2.0, 3.2)) g.push(G(ellipse(x, y0 + b, rr.range(0.6, 1.0), Math.min(b - 0.05, rr.range(0.55, 1.0) * b))));
    } else if (style === 'ijspegels') {
      const b = hgt * 0.55;
      g.push(G(rect(x0, y0 + b - 0.05, x1, y0 + hgt)));
      for (let x = x0 + 1.0; x < x1 - 1.0; x += rr.range(1.6, 2.6)) {
        const w = rr.range(0.6, 0.95), tip = y0 + Math.max(0.1, b - rr.range(0.5, 1.0) * b);
        g.push(G([[x - w, y0 + b], [x, tip], [x + w, y0 + b]].reverse()));
      }
    } else if (style === 'golf') {
      const per = Math.max(3, hgt * 1.8), amp = hgt * 0.22, pts = [[x1, y0], [x1, y0 + hgt - amp]];
      for (let x = x1; x >= x0; x -= 0.25) pts.push([x, y0 + hgt - amp + amp * Math.sin(TAU * (x - x0) / per)]);
      pts.push([x0, y0 + hgt - amp], [x0, y0]);
      g.push(G(ccw(dedupe(pts, true))));
    } else if (style === 'bolletjes') {
      const r = hgt * 0.42, b = y0 + hgt - r;
      g.push(G(rect(x0, y0, x1, b)));
      for (const x of fitted(x0 + r, x1 - r, r * 1.6)) g.push(G(circle(x, b, r)));
    }
    return { g, top: y0 + hgt };
  }

  // ------------------------------------------------------------------ straight decorative line (gable divider)
  const DIVIDERS = ['golf', 'lijn', 'zigzag', 'stippen', 'schulp', 'geen'];
  // half-height of a decorLine around its centre line
  const lineDepth = (style, lw) => (style === 'schulp' ? Math.max(1.2, lw * 1.6) / 2 + lw / 2 : style === 'stippen' ? lw * 0.72 : borderDepth(style, lw) + lw / 2);
  function decorLine(x0, x1, y, style, lw) {
    const h = lw / 2;
    if (style === 'lijn') return strokeOpen([[x0 + h, y], [x1 - h, y]], lw);
    if (style === 'stippen') return fitted(x0 + lw * 0.72, x1 - lw * 0.72, Math.max(2.2, lw * 2.9)).map(x => G(circle(x, y, lw * 0.72)));
    if (style === 'zigzag') {
      const amp = Math.max(0.55, lw * 0.75), xs = fitted(x0 + h, x1 - h, Math.max(1.3, lw * 1.7));
      return strokeOpen(xs.map((x, i) => [x, y + (i % 2 ? amp : -amp)]), lw);
    }
    if (style === 'golf') {
      const amp = Math.max(0.5, lw * 0.7), per = Math.max(3.2, lw * 4.5), pts = [];
      for (let x = x0 + h; x <= x1 - h + 1e-9; x += 0.25) pts.push([x, y + amp * Math.sin(TAU * (x - x0) / per)]);
      return strokeOpen(pts, lw);
    }
    if (style === 'schulp') {
      const r = Math.max(1.2, lw * 1.6), n = Math.floor((x1 - x0 - lw) / (2 * r)), xs = x0 + h + ((x1 - x0 - lw) - n * 2 * r) / 2, pts = [];
      for (let i = 0; i < n; i++) pts.push(...arc(xs + (2 * i + 1) * r, y + r / 2, r, Math.PI, 2 * Math.PI, 0.25));
      return strokeOpen(pts, lw);
    }
    return [];
  }

  // ------------------------------------------------------------------ windows and doors
  const WINDOW_STYLES = ['kruis', 'ruitjes', 'boog', 'rond', 'luiken'];
  const shutterW = (style, w) => (style === 'luiken' ? w / 2 * 0.95 + 0.5 : 0);
  function windowParts(style, cx, cy, w, h, lw, cut) {
    const ic = [], bars = [], hw = w / 2, hh = h / 2;
    let shape;
    if (style === 'rond') {
      const r = Math.min(w, h) / 2;
      shape = circle(cx, cy, r);
      bars.push([[cx - r, cy], [cx + r, cy]], [[cx, cy - r], [cx, cy + r]]);
    } else if (style === 'boog') {
      shape = archShape(cx, cy - hh, w, h);
      const ys = cy - hh + Math.max(h - hw, 0.05);
      bars.push([[cx, cy - hh], [cx, cy + hh]], [[cx - hw, ys], [cx + hw, ys]]);
    } else {
      shape = rect(cx - hw, cy - hh, cx + hw, cy + hh);
      bars.push([[cx, cy - hh], [cx, cy + hh]]);
      if (style === 'ruitjes') bars.push([[cx - hw, cy - hh + h / 3], [cx + hw, cy - hh + h / 3]], [[cx - hw, cy - hh + 2 * h / 3], [cx + hw, cy - hh + 2 * h / 3]]);
      else bars.push([[cx - hw, cy], [cx + hw, cy]]);
    }
    const shapeG = G(shape);
    ic.push(strokeClosed(offsetRing(shape, lw / 2), lw));
    const barG = bars.map(b => inter(strokeSeg(b[0], b[1], lw * 0.85), shapeG));
    ic.push(...barG);
    const holes = cut ? [diff(G(offsetRing(shape, -0.01)), ...barG.map(b => b))] : [];
    let ext = 0;
    if (style === 'luiken') {
      const sw = hw * 0.95;
      ext = sw + 0.5 + lw;
      for (const s of [-1, 1]) {
        const xa = s < 0 ? cx - hw - lw - 0.5 - sw : cx + hw + lw + 0.5;
        const r = rect(xa, cy - hh, xa + sw, cy + hh);
        ic.push(strokeClosed(offsetRing(r, -lw / 2), lw));
        ic.push(strokeSeg([xa + lw, cy - hh + lw], [xa + sw - lw, cy + hh - lw], lw * 0.75));
      }
    }
    if (style !== 'rond') {
      const sy = cy - hh - lw * 1.4;
      ic.push(strokeSeg([cx - hw - lw * 1.6, sy], [cx + hw + lw * 1.6, sy], lw * 1.3));
    }
    const top = style === 'rond' ? cy + Math.min(w, h) / 2 : cy + hh;
    const zone = rect(cx - hw - lw * 2.2 - ext, cy - hh - lw * 3, cx + hw + lw * 2.2 + ext, top + lw * 2);
    return { ic, holes, zone, win: true };
  }

  // star window: cut out with an icing frame, or (not cut) a white icing star
  function starWindow(cx, cy, s, lw, cut) {
    const shape = star(cx, cy, s / 2, s / 4.4, 5);
    const ic = cut ? [strokeClosed(offsetRing(shape, lw / 2), lw * 0.9)] : [G(shape)];
    return { ic, holes: cut ? [G(shape)] : [], zone: circle(cx, cy, s / 2 + lw * 2.2), win: true };
  }

  const DOOR_STYLES = ['recht', 'boog', 'dubbel', 'staldeur'];
  const TREE_TAB = 5;

  // ------------------------------------------------------------------ yard figures (stand upright in the base)
  // Each returns { plate: MultiPolygon (bottom at y=0), ic: [geoms], tabs: [x], tabW }
  const FIGURES = ['kerstboom', 'sneeuwpop', 'peperkoekman', 'zuurstok', 'lantaarn', 'hekje'];
  const FIGURE_NAMES = { kerstboom: 'Christmas tree', sneeuwpop: 'Snowman', peperkoekman: 'Gingerbread man', zuurstok: 'Candy cane', lantaarn: 'Street lamp', hekje: 'Fence' };
  const FIGURE_SLUGS = { kerstboom: 'tree', sneeuwpop: 'snowman', peperkoekman: 'gingerbread_man', zuurstok: 'candy_cane', lantaarn: 'street_lamp', hekje: 'fence' };
  const ground = g => inter(g, G(rect(-200, 0, 200, 400)));            // flat bottom at y = 0
  function makeFigure(type, rnd, lw) {
    const ic = [];
    if (type === 'kerstboom') {
      const th = rnd.range(24, 34), tw = th * rnd.range(0.55, 0.68), trunkH = th * 0.12;
      const tiers = rnd.int(3, 4), polys = [], tierH = (th - trunkH) / tiers * 1.35;
      for (let k = 0; k < tiers; k++) {
        const w = tw * (1 - k * 0.22), yb = trunkH + k * (th - trunkH - tierH) / (tiers - 1 || 1);
        polys.push(G([[-w / 2, yb], [w / 2, yb], [0, yb + tierH]]));
        const sag = rnd.range(0.8, 1.6), a = [-w * 0.36, yb + tierH * 0.22], b = [w * 0.36, yb + tierH * 0.3], pts = [];
        for (let s = 0; s <= 20; s++) { const u = s / 20; pts.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u - sag * 4 * u * (1 - u)]); }
        ic.push(...strokeOpen(pts, lw));
      }
      polys.push(G(rect(-tw * 0.08, 0, tw * 0.08, trunkH + 1)));
      const topY = trunkH + (tiers - 1) * (th - trunkH - tierH) / (tiers - 1 || 1) + tierH;
      const st = star(0, topY + 1.2, 3.2, 1.4, 5);
      polys.push(G(st));
      ic.push(G(offsetRing(st, -0.55)));
      for (let k = 0; k < 9; k++) {
        const yy = rnd.range(trunkH + 2, topY - 4), half = tw / 2 * (1 - (yy - trunkH) / (topY - trunkH)) - 1.5;
        if (half > 1) ic.push(G(circle(rnd.range(-half, half), yy, rnd.range(0.6, 0.9))));
      }
      return { plate: union(polys), ic, tabs: [0], tabW: TREE_TAB };
    }
    if (type === 'sneeuwpop') {
      const H = rnd.range(20, 27), r1 = H * 0.24, r2 = H * 0.18, r3 = H * 0.13;
      const c1 = r1 * 0.85, c2 = c1 + r1 * 0.8 + r2 * 0.75, c3 = c2 + r2 * 0.8 + r3 * 0.85;
      const bodies = [circle(0, c1, r1), circle(0, c2, r2), circle(0, c3, r3)];
      const brimY = c3 + r3 * 0.6, crownH = r3 * 1.1;
      const hat = [G(rect(-r3 * 1.2, brimY, r3 * 1.2, brimY + 1)), G(rect(-r3 * 0.75, brimY + 0.5, r3 * 0.75, brimY + 1 + crownH))];
      // twig arms (brown plate), slightly raised
      const arms = [];
      for (const s of [-1, 1]) {
        const a = [s * r2 * 0.8, c2 + r2 * 0.1], b = [s * (r2 + 4.2), c2 + r2 * 0.75];
        arms.push(...strokeOpen([a, b], 1.1), ...strokeOpen([[b[0] - s * 1.4, b[1] - 0.5], [b[0] + s * 0.2, b[1] + 1.4]], 0.9));
      }
      const plate = ground(union([...bodies.map(G), ...hat, ...arms]));
      // white snow body with brown eyes, smile and buttons left open; scarf as a brown band
      const white = union(bodies.map(b => G(offsetRing(b, -0.6))));
      const holes = [
        ...[-1, 1].map(s => G(circle(s * r3 * 0.36, c3 + r3 * 0.22, Math.max(0.45, lw * 0.6)))),
        ...[0, 1, 2, 3, 4].map(k => { const a = Math.PI * (1.25 + k * 0.125); return G(circle(r3 * 0.5 * Math.cos(a), c3 - r3 * 0.05 + r3 * 0.5 * Math.sin(a), 0.35)); }),
        ...[-0.35, 0, 0.35].map(f => G(circle(0, c2 + f * r2 * 1.2, Math.max(0.5, lw * 0.65)))),
        G(rect(-r2 * 0.9, c2 + r2 * 0.62, r2 * 0.9, c2 + r2 * 0.62 + 1.1)),
        G(rect(r2 * 0.15, c2 + r2 * 0.1, r2 * 0.45, c2 + r2 * 0.65)),
      ];
      ic.push(diff(white, ...holes));
      ic.push(strokeSeg([-r3 * 0.75, brimY + 1.5], [r3 * 0.75, brimY + 1.5], lw));     // hat band
      return { plate, ic, tabs: [0], tabW: TREE_TAB };
    }
    if (type === 'peperkoekman') {
      const H = rnd.range(20, 26), hr = H * 0.17, hy = H - hr, wv = rnd.range(-0.08, 0.12) * H;
      const parts = [
        G(circle(0, hy, hr)),
        ...strokeOpen([[0, H * 0.3], [0, H * 0.62]], H * 0.36),
        ...strokeOpen([[-H * 0.34, H * 0.6 + wv], [0, H * 0.64], [H * 0.34, H * 0.6 - wv]], H * 0.16),
        ...strokeOpen([[-H * 0.17, H * 0.07], [0, H * 0.36], [H * 0.17, H * 0.07]], H * 0.18),
      ];
      const plate = ground(union(parts));
      for (const s of [-1, 1]) ic.push(G(circle(s * hr * 0.38, hy + hr * 0.2, Math.max(0.5, lw * 0.65))));
      ic.push(...strokeOpen(arc(0, hy + hr * 0.05, hr * 0.5, Math.PI * 1.2, Math.PI * 1.8, 0.2), lw * 0.8));
      for (const f of [0.55, 0.45, 0.35]) ic.push(G(circle(0, H * f, Math.max(0.6, lw * 0.8))));
      // icing squiggles at wrists and ankles
      const squig = (cx, cy, ang, len) => {
        const pts = [], ux = Math.cos(ang), uy = Math.sin(ang);
        for (let k = 0; k <= 4; k++) { const s = -len / 2 + len * k / 4, o = (k % 2 ? 0.45 : -0.45); pts.push([cx + ux * s - uy * o, cy + uy * s + ux * o]); }
        return strokeOpen(pts, lw * 0.8);
      };
      ic.push(...squig(-H * 0.27, H * 0.6 + wv * 0.8, Math.PI / 2, H * 0.14), ...squig(H * 0.27, H * 0.6 - wv * 0.8, Math.PI / 2, H * 0.14));
      ic.push(...squig(-H * 0.14, H * 0.12, 0.45, H * 0.15), ...squig(H * 0.14, H * 0.12, -0.45, H * 0.15));
      return { plate, ic, tabs: [-H * 0.16, H * 0.16], tabW: Math.min(3.4, H * 0.15) };
    }
    if (type === 'zuurstok') {
      const H = rnd.range(22, 28), w = 3.2, r = rnd.range(3.2, 4.2), x = r;
      const path = [[x, -1], [x, H - r - w / 2], ...arc(0, H - r - w / 2, r, 0, Math.PI, 0.2).slice(1), [-r, H - r - w / 2 - r * 0.6]];
      const plate = ground(union(strokeOpen(path, w)));
      const inner = ground(union(strokeOpen([[x, 0.9], ...path.slice(1)], w - 1.2)));
      const stripes = [];
      for (let k = -12; k < 20; k++) stripes.push(strokeSeg([-12, k * 2.6 - 12], [12, k * 2.6 + 12], lw * 1.1));
      ic.push(inter(union(stripes), inner));
      return { plate, ic, tabs: [x], tabW: Math.min(TREE_TAB, w + 1) };
    }
    if (type === 'lantaarn') {
      const H = rnd.range(24, 30), y0 = H * 0.66, y1 = H * 0.86, hw = 2.7;
      const plate = union([
        G(rect(-3, 0, 3, 1.6)), G(rect(-0.9, 0, 0.9, y0 + 0.5)),
        G(rect(-hw - 0.4, y0 - 0.8, hw + 0.4, y0)),                       // lamp bottom
        G(rect(-hw, y0, hw, y1)),
        G([[-hw - 1, y1], [hw + 1, y1], [0, y1 + 3]]), G(circle(0, y1 + 3.4, 0.9)),
      ]);
      ic.push(strokeClosed(rect(-hw + 0.7, y0 + 0.7, hw - 0.7, y1 - 0.7), lw * 0.8));
      ic.push(strokeSeg([0, y0 + 0.7], [0, y1 - 0.7], lw * 0.7));
      ic.push(G(offsetRing([[-hw - 1, y1], [hw + 1, y1], [0, y1 + 3]], -0.55)));   // snow on the cap
      ic.push(strokeSeg([-2.4, 0.8], [2.4, 0.8], lw * 0.8));
      return { plate, ic, tabs: [0], tabW: TREE_TAB };
    }
    // hekje: pickets with pointed tops on two rails
    const Wf = rnd.range(22, 30), Hf = rnd.range(9, 12), n = Math.max(4, Math.round(Wf / 3.4)), pw = 2.0, pieces = [];
    const xs = fitted(-Wf / 2 + pw / 2, Wf / 2 - pw / 2, (Wf - pw) / (n - 1));
    for (const x of xs) pieces.push(G([[x - pw / 2, 0], [x + pw / 2, 0], [x + pw / 2, Hf - 1.4], [x, Hf], [x - pw / 2, Hf - 1.4]]));
    for (const f of [0.3, 0.66]) pieces.push(G(rect(-Wf / 2, Hf * f - 0.7, Wf / 2, Hf * f + 0.7)));
    for (const x of xs) ic.push(G(offsetRing([[x - pw / 2, Hf - 1.4], [x + pw / 2, Hf - 1.4], [x, Hf]], -0.25)));   // snow caps
    ic.push(strokeSeg([-Wf / 2 + 0.6, Hf * 0.66 + 0.3], [Wf / 2 - 0.6, Hf * 0.66 + 0.3], lw * 0.7));
    return { plate: union(pieces), ic, tabs: [xs[0], xs[xs.length - 1]], tabW: TREE_TAB };
  }
  // cutWin: cut out only the little windows in the door (the door itself stays)
  function doorParts(style, cx, w, h, lw, cut, rnd, archDouble, cutWin) {
    const hw = w / 2, ic = [], winHoles = [];
    const arched = style === 'boog' || (style === 'dubbel' && archDouble);
    const shape = arched ? archShape(cx, 0, w, h) : rect(cx - hw, 0, cx + hw, h);
    const shapeG = G(shape);
    ic.push(strokeClosed(offsetRing(shape, lw / 2), lw));
    let topY = h;
    if (!cut) {
      const det = [], wins = [];                         // wins: { shape, bars: [[a, b], ...] }
      const knob = (x, y) => det.push(G(circle(x, y, lw * 0.95)));
      if (style === 'recht') {
        const m = Math.max(1.2, w * 0.14);
        wins.push({ shape: rect(cx - hw + m, h * 0.58, cx + hw - m, h - m), bars: [[[cx, h * 0.58], [cx, h - m]]] });
        det.push(strokeClosed(rect(cx - hw + m, m, cx + hw - m, h * 0.47), lw * 0.7));
        knob(cx + hw * 0.62, h * 0.5);
      } else if (style === 'boog') {
        const r = hw * 0.48, cy = h - hw;                // round window in the arch
        wins.push({ shape: circle(cx, cy, r), bars: [[[cx - r, cy], [cx + r, cy]], [[cx, cy - r], [cx, cy + r]]] });
        for (const f of [-1 / 3, 1 / 3]) det.push(strokeSeg([cx + f * w, 0], [cx + f * w, cy - r - 1.2], lw * 0.65));
        knob(cx + hw * 0.6, h * 0.42);
      } else if (style === 'dubbel') {
        det.push(strokeSeg([cx, 0], [cx, h], lw * 0.8));
        knob(cx - w * 0.12, h * 0.46); knob(cx + w * 0.12, h * 0.46);
        const m = Math.max(1.2, w * 0.08), yTop = arched ? h - hw - 0.4 : h - m;
        for (const s of [-1, 1]) {
          const xa = s < 0 ? cx - hw + m : cx + m * 0.6, xb = s < 0 ? cx - m * 0.6 : cx + hw - m;
          det.push(strokeClosed(rect(xa, m, xb, h * 0.38), lw * 0.6));
          if (yTop - h * 0.55 > 2.4) wins.push({ shape: rect(xa, h * 0.55, xb, yTop), bars: [] });
        }
      } else if (style === 'schuur') {
        // barn doors: two leaves, each framed with a cross brace
        det.push(strokeSeg([cx, 0], [cx, h], lw * 0.8));
        for (const s of [-1, 1]) {
          const xa = s < 0 ? cx - hw + 1.1 : cx + 1.1, xb = s < 0 ? cx - 1.1 : cx + hw - 1.1;
          det.push(strokeClosed(rect(xa, 1.1, xb, h - 1.1), lw * 0.7), strokeSeg([xa, 1.1], [xb, h - 1.1], lw * 0.7), strokeSeg([xa, h - 1.1], [xb, 1.1], lw * 0.7));
        }
      } else if (style === 'staldeur') {
        det.push(strokeSeg([cx - hw, h * 0.5], [cx + hw, h * 0.5], lw * 0.9));
        const m = Math.max(1.4, w * 0.2), y0 = h * 0.58, y1 = h - m;
        wins.push({ shape: rect(cx - hw + m, y0, cx + hw - m, y1), bars: [[[cx, y0], [cx, y1]], [[cx - hw + m, (y0 + y1) / 2], [cx + hw - m, (y0 + y1) / 2]]] });
        knob(cx + hw * 0.6, h * 0.38);
      }
      for (const wn of wins) {
        const wg = G(wn.shape), barG = wn.bars.map(b => inter(strokeSeg(b[0], b[1], lw * 0.75), wg));
        det.push(strokeClosed(offsetRing(wn.shape, lw * 0.35), lw * 0.7), ...barG);
        if (cutWin) winHoles.push(diff(G(offsetRing(wn.shape, -0.01)), ...barG));   // bars stay as plate
      }
      ic.push(inter(union(det), G(offsetRing(shape, -lw * 0.3))));
    }
    if ((style === 'recht' || style === 'staldeur') && rnd.chance(0.6)) {
      const y = h + lw * 1.6, peak = Math.min(hw * 0.55, 3.5);
      ic.push(...strokeOpen([[cx - hw - 1.8, y], [cx, y + peak], [cx + hw + 1.8, y]], lw * 1.15));
      topY = y + peak;
    }
    const zone = rect(cx - hw - lw * 2.4 - 1.8, -5, cx + hw + lw * 2.4 + 1.8, topY + lw * 2.2);
    return { ic, holes: cut ? [shapeG] : winHoles, zone, shapeG };
  }

  // ------------------------------------------------------------------ parameters
  const DEFAULTS = {
    seed: 7, W: 52, D: 48, H: 34, pitch: 45, overhang: 2, floors: 1,
    gable: 'willekeurig', door: 'willekeurig', doorPos: 'willekeurig', extraDoor: 'willekeurig',
    windowMix: 'gemengd', windowStyle: 'willekeurig', windowsPerWall: 0, topWindow: 'willekeurig',
    cutWindows: false, cutDoor: false, cutDoorWindows: true, roofWindow: 'willekeurig',
    gableDivider: 'willekeurig', chimneyPattern: 'willekeurig',
    roofPattern: 'willekeurig', roofEdge: 'willekeurig', roofEdgeH: 2.4, border: 'willekeurig', wallPattern: 'willekeurig',
    chimney: true, fig1: 'kerstboom', fig2: 'kerstboom', fig3: 'geen', fig4: 'geen', path: true, baseSnow: true,
    joints: true, clear: 0.1,   // per side, like the original kit (slot 0.2 mm larger than the tab)
    type: 'huis', balcony: false, sign: true, signText: 'Gl\u00fchwein', seller: 'willekeurig',
    t: 1.8, ih: 0.6, lw: 0.8, bed: 220,
  };
  const CHOICES = {
    gable: ['zadel', 'trap', 'klok'],
    door: DOOR_STYLES,
    doorPos: ['midden', 'links', 'rechts'],
    extraDoor: ['geen', 'achterdeur', 'zijdeur'],
    windowStyle: WINDOW_STYLES,
    topWindow: ['rond', 'hart', 'ster', 'boog', 'geen'],
    roofPattern: ['schubben', 'pannen', 'stippen', 'golf', 'geen'],
    roofEdge: SNOW_EDGES,
    roofWindow: ['ster', 'rond', 'vierkant', 'geen'],
    gableDivider: DIVIDERS,
    chimneyPattern: ['bakstenen', 'stippen', 'golf', 'geen'],
    border: ['lijn', 'stippen', 'zigzag', 'golf', 'schulp'],
    wallPattern: ['geen', 'geen', 'stippen', 'bakstenen', 'sneeuwvlok'],
  };
  // building types: a preset (applied when you pick the type) and dimension ranges for "Verras me"
  const TYPES = {
    huis: { name: 'Cottage', preset: { W: 52, D: 48, H: 34, pitch: 45, overhang: 2, floors: 1, chimney: true, balcony: false, sign: false, gable: 'willekeurig', door: 'willekeurig', topWindow: 'willekeurig', wallPattern: 'willekeurig' },
      ranges: { W: [40, 64], D: [36, 62], H: [26, 44], pitch: [35, 60] } },
    dwarshuis: { name: 'Side-gable house', preset: { W: 40, D: 62, H: 30, pitch: 45, overhang: 2, floors: 1, chimney: true, balcony: false, sign: false, gable: 'willekeurig', door: 'willekeurig', topWindow: 'willekeurig', wallPattern: 'willekeurig' },
      ranges: { W: [34, 46], D: [54, 76], H: [24, 38], pitch: [40, 55] } },
    kraam: { name: 'Gl\u00fchwein stall', preset: { W: 44, D: 56, H: 24, pitch: 38, overhang: 3, floors: 1, chimney: false, balcony: false, sign: true, gable: 'zadel', door: 'boog', topWindow: 'hart', wallPattern: 'geen' },
      ranges: { W: [38, 50], D: [48, 66], H: [22, 28], pitch: [30, 45] } },
    toren: { name: 'Tower', preset: { W: 32, D: 32, H: 56, pitch: 60, overhang: 2, floors: 3, chimney: false, balcony: false, sign: false, gable: 'willekeurig', door: 'boog', topWindow: 'klok', wallPattern: 'willekeurig' },
      ranges: { W: [28, 36], D: [28, 36], H: [48, 64], pitch: [55, 65] } },
    schuur: { name: 'Barn', preset: { W: 62, D: 54, H: 26, pitch: 45, overhang: 2, floors: 1, chimney: false, balcony: false, sign: false, gable: 'zadel', door: 'schuur', topWindow: 'hooiluik', wallPattern: 'planken' },
      ranges: { W: [56, 70], D: [46, 62], H: [22, 30], pitch: [40, 50] } },
    chalet: { name: 'Chalet', preset: { W: 58, D: 50, H: 34, pitch: 30, overhang: 6, floors: 2, chimney: true, balcony: true, sign: false, gable: 'zadel', door: 'willekeurig', topWindow: 'willekeurig', wallPattern: 'willekeurig' },
      ranges: { W: [52, 66], D: [44, 56], H: [32, 38], pitch: [25, 35] } },
  };
  function randomParams(seed, keep) {
    const r = Rnd(seed * 7919 + 13);
    const type = keep && TYPES[keep.type] ? keep.type : 'huis', T = TYPES[type], R = T.ranges;
    const H = Math.round(r.range(R.H[0], R.H[1]));
    const pitches = []; for (let a = R.pitch[0]; a <= R.pitch[1]; a += 5) pitches.push(a);
    const p = Object.assign({}, DEFAULTS, keep || {}, T.preset, {
      seed, type,
      W: Math.round(r.range(R.W[0], R.W[1])), D: Math.round(r.range(R.D[0], R.D[1])), H,
      pitch: r.pick(pitches), overhang: type === 'chalet' ? r.pick([5, 6, 7]) : r.pick([0, 1.5, 2, 3, 4]),
      floors: type === 'huis' || type === 'dwarshuis' ? (H >= 36 && r.chance(0.6) ? 2 : 1) : T.preset.floors,
      doorPos: 'willekeurig', extraDoor: 'willekeurig',
      windowMix: r.chance(0.7) ? 'gemengd' : 'zelfde', windowStyle: 'willekeurig', windowsPerWall: 0,
      roofPattern: 'willekeurig', roofEdge: 'willekeurig', roofEdgeH: r.pick([2, 2.4, 3, 3.5]), border: 'willekeurig',
      chimney: T.preset.chimney && r.chance(0.75), path: r.chance(0.8), baseSnow: r.chance(0.7),
      roofWindow: type === 'kraam' ? 'geen' : r.chance(0.6) ? 'willekeurig' : 'geen', gableDivider: 'willekeurig', chimneyPattern: 'willekeurig',
      cutDoorWindows: r.chance(0.5), seller: 'willekeurig',
      ...(() => { const n = r.int(0, 4), o = {}; for (let i = 1; i <= 4; i++) o['fig' + i] = i <= n ? 'willekeurig' : 'geen'; return o; })(),
    });
    if (type === 'huis' || type === 'dwarshuis') { p.door = 'willekeurig'; p.topWindow = 'willekeurig'; p.gable = 'willekeurig'; }
    return p;
  }

  // ------------------------------------------------------------------ frames (local -> world)
  const frame = (o, ex, ey, ez) => ({ o, ex, ey, ez });
  const ID = frame([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const apply = (F, p) => [
    F.o[0] + p[0] * F.ex[0] + p[1] * F.ey[0] + p[2] * F.ez[0],
    F.o[1] + p[0] * F.ex[1] + p[1] * F.ey[1] + p[2] * F.ez[1],
    F.o[2] + p[0] * F.ex[2] + p[1] * F.ey[2] + p[2] * F.ez[2]];
  const applyDir = (F, d) => [
    d[0] * F.ex[0] + d[1] * F.ey[0] + d[2] * F.ez[0],
    d[0] * F.ex[1] + d[1] * F.ey[1] + d[2] * F.ez[1],
    d[0] * F.ex[2] + d[1] * F.ey[2] + d[2] * F.ez[2]];
  const compose = (A, B) => frame(apply(A, B.o), applyDir(A, B.ex), applyDir(A, B.ey), applyDir(A, B.ez)); // A after B

  // ------------------------------------------------------------------ gable outlines
  function gableOutline(kind, W, H, Hp, tp, rnd, res) {
    const roof = x => H + x * tp;
    let L;
    const over = res.over || 1.6;
    if (kind === 'trap') {
      const k = res.trapSteps, topw = W * 0.2, xk = W / 2 - topw / 2, sw = xk / k;
      L = [[0, 0]];
      for (let i = 0; i < k; i++) { const y = roof((i + 1) * sw) + over; L.push([i * sw, y], [(i + 1) * sw, y]); }
      L.push([xk, Math.max(Hp + over + Math.max(2, topw * 0.35), L[L.length - 1][1] + 2)]);
    } else if (kind === 'klok') {
      const nw = W * res.neck, xs = W / 2 - nw / 2, ys = roof(xs) + over;
      const yc = Math.max(ys + 1.5, Hp + 1.2) + nw * 0.15;
      const y0 = H + over;                       // side rises straight up past the roof, then the bell curve starts
      L = [[0, 0], [0, y0]];
      const P0 = [0, y0], P1 = [0, y0 + 0.8 * Math.max(ys - y0, 0.5)], P2 = [xs * 0.3, Math.max(ys, y0 + 0.5)], P3 = [xs, ys];
      for (let i = 1; i <= 28; i++) {
        const t = i / 28, u = 1 - t;
        const x = u * u * u * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * P3[0];
        let y = u * u * u * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * P3[1];
        y = Math.max(y, roof(x) + over);
        L.push([x, y]);
      }
      L.push([xs, yc]);
      L.push(...arc(W / 2, yc, nw / 2, Math.PI, Math.PI / 2).slice(1));
    } else {
      L = [[0, 0], [0, H], [W / 2, Hp]];
    }
    const M = p => [W - p[0], p[1]];
    const ring = [[0, 0], [W, 0]];
    for (let i = 1; i < L.length; i++) ring.push(M(L[i]));
    for (let i = L.length - 1; i >= 1; i--) ring.push(L[i]);
    return dedupe(ring, true);
  }

  // ------------------------------------------------------------------ build
  function build(params) {
    const P = Object.assign({}, DEFAULTS, params);
    const rnd = Rnd(P.seed);
    const pickOr = (v, list) => (v === 'willekeurig' ? rnd.pick(list) : v);
    const res = {};
    res.gable = pickOr(P.gable, CHOICES.gable);
    res.door = pickOr(P.door, CHOICES.door);
    res.doorPos = pickOr(P.doorPos, CHOICES.doorPos);
    res.extraDoor = pickOr(P.extraDoor, ['geen', 'geen', 'achterdeur', 'zijdeur']);
    res.windowStyle = pickOr(P.windowStyle, CHOICES.windowStyle);
    res.topWindow = pickOr(P.topWindow, CHOICES.topWindow);
    res.roofPattern = pickOr(P.roofPattern, CHOICES.roofPattern);
    res.roofEdge = pickOr(P.roofEdge, CHOICES.roofEdge);
    res.roofWindow = pickOr(P.roofWindow, CHOICES.roofWindow);
    res.gableDivider = pickOr(P.gableDivider, CHOICES.gableDivider);
    res.chimneyPattern = pickOr(P.chimneyPattern, CHOICES.chimneyPattern);
    res.border = pickOr(P.border, CHOICES.border);
    res.wallPattern = pickOr(P.wallPattern, CHOICES.wallPattern);
    res.trapSteps = rnd.int(2, 4);
    res.neck = rnd.range(0.22, 0.3);
    res.archDouble = rnd.chance(0.5);
    res.seller = pickOr(P.seller, ['peperkoekman', 'sneeuwpop']);
    const winStyle = () => (P.windowMix === 'gemengd' ? rnd.pick(WINDOW_STYLES) : res.windowStyle);
    // building type: side-gable types have their long wall to the front
    const T = TYPES[P.type] ? P.type : 'huis';
    const side = T === 'dwarshuis' || T === 'kraam';
    res.type = T;

    const { W, D, H, t, ih, lw } = P;
    // icing islands must be printable: no specks (< 0.35 mm2) and no hair-thin slivers
    const cleanIcing = mp => cleanMP(mp, 0.4, lw * 0.45);
    const p = P.pitch * Math.PI / 180, tp = Math.tan(p);
    const Hp = H + W / 2 * tp;
    const m = 1.3;                       // border inset from plate edge
    const bd = borderDepth(res.border, lw);
    const parts = [];

    // ---- tab-and-slot joints (like the original kit): tab protrudes t-0.1, slot = tab + clearance per side
    const J = !!P.joints, cl = Math.max(0, +P.clear || 0), tabP = t - 0.1;
    // slots must never cut the white border: bandW = how far the border reaches in from a plate edge;
    // a slot's icing-free zone (0.7) plus clearance must start beyond it
    const bandW = m + 2 * bd + lw / 2, slotGap = bandW + cl + 1.2;
    const e = J ? Math.max(3, slotGap) : 0;               // walls sit this far in from the gable edge
    const Hw = H + e * tp;                                // wall top touches the roof's inner face
    // parapet height above the roofline so the angled roof slot stays clear of the parapet's border
    res.over = J ? (t + cl + 0.9 + bandW) / Math.cos(p) : 1.6;
    const slotEdge = J ? e + t + 2 * cl + 1.4 : m + 1.5;  // keep windows/doors clear of wall slots
    const Le = W / 2 / Math.cos(p);                       // gable roof edge length
    // roof joint position along the slope; the angled slot's zone must stay clear of the gable's side border
    let Lg = Math.min(8, Le * 0.3), s0 = Le * 0.45 - Lg / 2;
    // ...and below the roof's ridge border (lowered further when a sign stands in notches on the ridge)
    // the sign's legs pass between two tilted roof edges at once: that joint gets extra play (min 0.25 per side)
    const clSign = Math.max(cl, 0.25);
    const ridgeKeep = T === 'kraam' && P.sign ? (t / 2 + clSign) / Math.cos(p) + 0.05 + clSign + 1.1 : 0;
    {
      const sp = Math.sin(p), cp = Math.cos(p);
      const sMin = cl + (bandW + 0.3 + (t + cl) * sp + 0.7 * (cp + sp)) / cp;
      const sMax = Le - ridgeKeep - bandW - cl - 1.1;                 // top end of the slot along the slope
      if (s0 < sMin) { s0 = sMin; Lg = Math.max(3, Math.min(Lg, Le * 0.85 - s0)); }
      if (s0 + Lg > sMax) { Lg = Math.max(3, sMax - s0); if (s0 + Lg > sMax) s0 = Math.max(sMin, sMax - Lg); }
    }
    const slotRect = (x0, y0, x1, y1) => rect(x0 - cl, y0 - cl, x1 + cl, y1 + cl);
    const slotItem = ring => ({ g: G(ring), zone: G(offsetRing(ring, 0.7)) });
    // point on the left roofline of a gable: s along the slope from (0,H), n outward from the roof's inner face
    const slopePt = (s, n) => [s * Math.cos(p) - n * Math.sin(p), H + s * Math.sin(p) + n * Math.cos(p)];
    const mirrorX = r => r.map(q => [W - q[0], q[1]]).reverse();
    // wall tabs: evenly over the height that the gable side covers
    // between the gable's bottom border and its sloped/side border at the slot column
    const wtY0 = slotGap, wtY1 = H + e * tp - bandW / Math.cos(p) - cl - 1.0, wtSpan = wtY1 - wtY0;
    const nWT = Math.max(1, Math.round(wtSpan / 15)), wtLen = Math.max(3, Math.min(8, wtSpan / nWT - 3));
    const wallTabY = [];
    for (let i = 0; i < nWT; i++) { const cy = wtY0 + wtSpan * (i + 0.5) / nWT; wallTabY.push([cy - wtLen / 2, cy + wtLen / 2]); }
    const baseSlots = [];

    // sizes shared by the whole house
    const ww = Math.min(Math.max(rnd.range(6.5, 10), 5), W / 4.2);
    let wh = ww * rnd.range(1.15, 1.5);
    const fl0 = Math.max(1, Math.min(3, Math.round(+P.floors || 1)));
    const floors = fl0 === 3 && H >= 44 ? 3 : fl0 >= 2 && H >= 30 ? 2 : 1;
    wh = Math.min(wh, floors === 3 ? H * 0.2 : floors === 2 ? H * 0.3 : H * 0.5);
    const rowY = floors === 3 ? [Math.max(H * 0.2, m + 4 + wh / 2), H * 0.48, H * 0.75]
      : floors === 2 ? [Math.max(H * 0.27, m + 4 + wh / 2), H * 0.71] : [Math.max(H * 0.52, m + 4 + wh / 2)];
    const doorBase = Math.min(Math.max(W * rnd.range(0.2, 0.27), 7), 14);
    const doorW = s => (s === 'dubbel' ? Math.min(doorBase * 1.6, W * 0.42) : s === 'schuur' ? Math.min(doorBase * 2, W * 0.5) : doorBase);
    const doorH = Math.min(H * (floors === 3 ? 0.32 : floors === 2 ? 0.5 : rnd.range(0.58, 0.72)), H - 3.5);
    const doorHFor = s => (s === 'schuur' ? Math.min(H * (floors > 1 ? 0.55 : 0.78), H - 4) : doorH);

    // decorate a flat wall-like plate
    function decorate(ring, items, opts) {
      opts = opts || {};
      const slots = opts.slots || [];
      if (slots.length) {                                   // drop windows that would cut into a joint slot
        const sz = union(slots.map(s => s.zone));
        items = items.filter(it => !it.win || !inter(G(it.zone), sz).length);
      }
      // optional divider line across the plate (gables, at eave height); windows that would touch it are dropped
      let divG = null, divZone = null;
      if (opts.divider && res.gableDivider !== 'geen') {
        const { x0, x1, y } = opts.divider, dd = lineDepth(res.gableDivider, lw);
        divZone = G(rect(x0 - 0.6, y - dd - 0.8, x1 + 0.6, y + dd + 0.8));
        items = items.filter(it => !it.win || !inter(G(it.zone), divZone).length);
        divG = union(decorLine(x0, x1, y, res.gableDivider, lw));
      }
      let plateG = diff(G(ring), ...items.flatMap(it => it.holes), ...slots.map(s => s.g));
      if (opts.addPlate) plateG = union([plateG, ...opts.addPlate]);     // e.g. the seller inside the stall opening
      const zones = union([...items.map(it => G(it.zone)), ...slots.map(s => s.zone)]);
      const ic = [];
      for (const it of items) ic.push(...it.ic);
      if (divG) ic.push(diff(divG, zones));
      // border
      if (opts.border !== false) {
        const bring = offsetRing(ring, -(m + bd));
        ic.push(diff(union(borderAlong(bring, res.border, lw)), zones));
      }
      // wall pattern
      const wp = opts.pattern || 'geen';
      if (wp !== 'geen') {
        const innerRing = offsetRing(ring, -(bandW + Math.max(0.9, lw * 1.2))), inner = G(innerRing);
        const patZones = divZone ? union([zones, divZone]) : zones;
        const zoneRings = patZones.map(poly => poly[0]);
        // whole dots/flakes only: inside the free area and clear of windows, doors and slots
        const keep = (x, y, r) => pointInRing(innerRing, x, y) && distToRing(innerRing, x, y) >= r &&
          zoneRings.every(z => !pointInRing(z, x, y) && distToRing(z, x, y) >= r + 0.3);
        const xs = innerRing.map(q => q[0]), ys = innerRing.map(q => q[1]);
        const pat = union(fillPattern(wp, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), lw, rnd, keep));
        ic.push(diff(inter(pat, inner), patZones));
      }
      if (opts.extra) ic.push(...opts.extra);
      if (opts.extraIcing) ic.push(...opts.extraIcing);
      const icing = diff(inter(union(ic), plateG), zones.length && slots.length ? union(slots.map(s => s.zone)) : []);
      const full = opts.tabs && opts.tabs.length ? union([plateG, ...opts.tabs]) : plateG;   // tabs stay bare
      return { plate: cleanMP(full), icing: cleanIcing(icing), check: jointCheck(ring, slots, divZone ? [divZone] : []) };
    }
    // for tests: the border band of a plate must not overlap slot zones (or other features listed in extra)
    function jointCheck(ring, slots, extra) {
      const z = [...slots.map(s => s.zone), ...(extra || [])];
      if (!z.length) return null;
      return { band: diff(G(ring), G(offsetRing(ring, -bandW))), slots: union(z) };
    }

    // windows evenly in a row between x0..x1 at height cy
    function windowRow(x0, x1, cy, n, style, items) {
      const ext = shutterW(style, ww);
      const span = x1 - x0;
      n = Math.min(n, Math.floor(span / (ww + 2 * ext + 3)));
      for (let i = 0; i < n; i++) items.push(windowParts(style, x0 + span * (i + 0.5) / n, cy, ww, wh, lw, P.cutWindows));
      return n;
    }
    function topWin(items, W0) {
      const tri = Hp - H;
      if (res.topWindow === 'geen' || tri < 8) return;
      const s = Math.min(tri * 0.4, W0 * 0.2, 9), halfH = s * (res.topWindow === 'boog' ? 0.65 : 0.5);
      // sits above the gable divider when there is one
      const dd = res.gableDivider !== 'geen' ? lineDepth(res.gableDivider, lw) + 1.4 : 0;
      const cy = Math.max(H + tri * 0.36, H + dd + halfH + 0.6);
      const halfW = (Hp - (cy + halfH)) / tp;          // room left inside the roof triangle
      if (halfW < s / 2 + m + 1.2) return;
      if (res.topWindow === 'hart') {
        const hz = heart(W0 / 2, cy, s * 0.9);
        items.push({ ic: [G(hz)], holes: [], zone: offsetRing(hz, lw * 1.5), win: true });
      } else if (res.topWindow === 'ster') items.push(starWindow(W0 / 2, cy, s * 1.1, lw, P.cutWindows));
      else if (res.topWindow === 'klok') {
        // clock: ring, 12 hour dots and two hands
        const r = s * 0.62, ic = [strokeClosed(circle(W0 / 2, cy, r), lw)];
        for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; ic.push(G(circle(W0 / 2 + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72, k % 3 ? lw * 0.4 : lw * 0.55))); }
        ic.push(strokeSeg([W0 / 2, cy], [W0 / 2, cy + r * 0.55], lw * 0.8), strokeSeg([W0 / 2, cy], [W0 / 2 + r * 0.4, cy - r * 0.15], lw * 0.8));
        items.push({ ic, holes: [], zone: circle(W0 / 2, cy, r + lw * 1.8), win: true });
      } else if (res.topWindow === 'hooiluik') {
        // hay loft hatch: framed square with a cross brace
        const hs = s * 1.1, sq = rect(W0 / 2 - hs / 2, cy - hs / 2, W0 / 2 + hs / 2, cy + hs / 2), g = G(sq);
        items.push({ ic: [strokeClosed(offsetRing(sq, lw / 2), lw), inter(strokeSeg(sq[0], sq[2], lw * 0.8), g), inter(strokeSeg(sq[1], sq[3], lw * 0.8), g)],
          holes: [], zone: offsetRing(sq, lw * 2), win: true });
      }
      else items.push(windowParts(res.topWindow, W0 / 2, cy, s, s * (res.topWindow === 'boog' ? 1.3 : 1), lw, P.cutWindows));
    }
    // the decorate() helper adds a seller figure inside the stall opening through opts.addPlate / opts.extraIcing
    function doorAt(cx, style, items) {
      const it = doorParts(style, cx, doorW(style), doorHFor(style), lw, P.cutDoor, rnd, res.archDouble, P.cutDoorWindows);
      items.push(it);
      return it;
    }

    // ---- parts per building type ------------------------------------------------------------
    // House frame: gables A (-y) and B (+y), walls L (-x) and R (+x), ridge along y.
    // Side-gable types (dwarshuis, kraam) are rotated 90 degrees at the end so wall R faces the yard.
    const Lw = D - 2 * t;
    const names = side
      ? { A: ['01_gable_left', 'Left gable'], B: ['02_gable_right', 'Right gable'], L: ['03_back_wall', 'Back wall'], R: ['04_front_wall', 'Front wall'] }
      : { A: ['01_front_gable', 'Front gable'], B: ['02_back_gable', 'Back gable'], L: ['03_side_wall_left', 'Left side wall'], R: ['04_side_wall_right', 'Right side wall'] };
    res.front = null;                                         // { id, x }: what the garden path leads to

    // joint features shared by both gables
    const gSlots = [], gTabs = [];
    if (J) {
      for (const [y0, y1] of wallTabY)
        gSlots.push(slotItem(slotRect(e, y0, e + t, y1)), slotItem(slotRect(W - e - t, y0, W - e, y1)));
      if (res.gable === 'zadel') {            // tab on each sloped edge goes through a slot in the roof
        const tab = [slopePt(s0, -0.05), slopePt(s0 + Lg, -0.05), slopePt(s0 + Lg, tabP), slopePt(s0, tabP)];
        gTabs.push(G(tab), G(mirrorX(tab)));
      } else {                                // parapet gable: the roof's end tabs go into angled slots
        const sl = [slopePt(s0 - cl, -cl), slopePt(s0 + Lg + cl, -cl), slopePt(s0 + Lg + cl, t + cl), slopePt(s0 - cl, t + cl)];
        const roofSlots = [slotItem(sl), slotItem(mirrorX(sl))];
        gSlots.push(...roofSlots);
        res.roofSlotZone = union(roofSlots.map(s => s.zone));
      }
    }
    // gable outline; for parapet gables raise the parapet until its border is clear of the roof slots
    let gRing = gableOutline(res.gable, W, H, Hp, tp, rnd, res);
    if (J && res.gable !== 'zadel') {
      const sz = res.roofSlotZone;
      for (let k = 0; k < 24; k++) {
        const band = diff(G(gRing), G(offsetRing(gRing, -bandW)));
        if (!cleanMP(inter(band, sz), 1e-4).length) break;
        res.over += 0.5;
        gRing = gableOutline(res.gable, W, H, Hp, tp, rnd, res);
      }
    }
    // two tabs on the gable bottom into the base; slide past cut-out doors
    function bottomTabs(spans) {
      const Lb = Math.min(7, W * 0.14), geoms = [], xs = [];
      if (!J) return { geoms, xs };
      for (const sd of [0, 1]) {
        let a = sd ? W - e - 1 - Lb : e + 1;
        const hit = s => a < s[1] + 1 && a + Lb > s[0] - 1;
        const sp0 = spans.find(hit);
        if (sp0) {
          a = sd ? sp0[0] - 1.5 - Lb : sp0[1] + 1.5;
          if (spans.some(hit) || a < 1 || a + Lb > W - 1) continue;
        }
        geoms.push(G(rect(a, -tabP, a + Lb, 0.05))); xs.push([a, a + Lb]);
      }
      return { geoms, xs };
    }
    const doorSpan = (x, s) => [x - doorW(s) / 2 - lw, x + doorW(s) / 2 + lw];
    // divider across both gables at eave height, between the wall slots (or the border)
    const dvDepth = res.gableDivider !== 'geen' ? lineDepth(res.gableDivider, lw) : 0;
    const dvx = Math.max(J ? e + t + cl + 0.7 + 0.9 : bandW + 0.9,
      res.gable === 'zadel' ? (dvDepth + 0.8 + bandW / Math.cos(p) + 0.5) / tp : 0);   // clear of the sloped border
    const gDivider = { x0: dvx, x1: W - dvx, y: H };
    // front door + windows beside it on a facade of width Wf (x0..x1 usable)
    function frontFacade(items, Wf, x0, x1) {
      const style = winStyle(), dw = doorW(res.door);
      let cx = Wf / 2;
      if (res.doorPos !== 'midden') {
        const off = Math.max(dw / 2 + x0 + 1, Wf * 0.27);
        cx = res.doorPos === 'links' ? off : Wf - off;
      }
      doorAt(cx, res.door, items);
      const gap = 2.2, ext = shutterW(style, ww), dhw = dw / 2 + lw * 2.4 + gap;
      // windows fill the space beside the door
      for (const [a, b] of [[x0, cx - dhw], [cx + dhw, x1]]) {
        const n = Math.floor((b - a) / (ww + 2 * ext + 4));
        if (n >= 1) windowRow(a, b, rowY[0], n, style, items);
      }
      for (let f = 1; f < floors; f++) windowRow(x0, x1, rowY[f], rnd.int(1, Math.max(1, Math.floor((x1 - x0) / (ww * 2.6)))), style, items);
      return cx;
    }
    function upperRows(items, x0, x1, style, nMax) {
      for (let f = 1; f < floors; f++) windowRow(x0, x1, rowY[f], rnd.int(1, nMax), style, items);
    }

    // ---- balcony (front gable, upper floor): board with tabs in gable slots + railing with tabs in board slots
    let balc = null;
    if (!side && P.balcony && floors >= 2) {
      const yb = Math.max(rowY[0] + wh / 2 + 3, doorHFor(res.door) + t + cl + 3.2);
      const bwid = Math.min(W * 0.62, W - 2 * slotEdge - 2);
      balc = { yb, bx0: W / 2 - bwid / 2, bx1: W / 2 + bwid / 2, dc: 7 };
      balc.tabs = [balc.bx0 + 4, balc.bx1 - 4];
      balc.rtabs = [balc.bx0 + 4, balc.bx1 - 4];
    }

    // ---- gable A
    {
      const items = [], spans = [], slotsA = gSlots.slice();
      if (balc) for (const tx of balc.tabs) slotsA.push(slotItem(slotRect(tx - 3, balc.yb - t, tx + 3, balc.yb)));
      if (!side) {
        const cx = frontFacade(items, W, slotEdge, W - slotEdge);
        if (P.cutDoor) spans.push(doorSpan(cx, res.door));
        res.front = { id: names.A[0], x: cx };
      } else {
        const style = T === 'kraam' ? 'luiken' : winStyle();
        windowRow(slotEdge, W - slotEdge, rowY[0], T === 'kraam' ? 1 : rnd.int(1, 2), style, items);
        upperRows(items, slotEdge, W - slotEdge, style, 2);
      }
      topWin(items, W);
      const bt = bottomTabs(spans);
      const d = decorate(gRing, items, { pattern: res.wallPattern, slots: slotsA, tabs: [...gTabs, ...bt.geoms], divider: gDivider });
      parts.push({ id: names.A[0], name: names.A[1], ...d, baseTabXs: bt.xs, kind: 'flat' });
    }
    // ---- gable B
    {
      const items = [], style = winStyle(), spans = [];
      const doorHere = side ? (T === 'kraam' || res.extraDoor === 'zijdeur') : res.extraDoor === 'achterdeur';
      if (doorHere) {
        const bs = T === 'kraam' ? (res.door === 'schuur' ? 'boog' : res.door) : rnd.pick(['recht', 'staldeur', 'boog']);
        const bx = T === 'kraam' ? W / 2
          : rnd.chance(0.5) ? Math.max(W * 0.3, slotEdge + doorBase / 2 + 1) : Math.min(W * 0.7, W - slotEdge - doorBase / 2 - 1);
        doorAt(bx, bs, items);
        spans.push(doorSpan(bx, bs));
        if (T !== 'kraam') {
          const a = bx < W / 2 ? bx + doorW(bs) / 2 + 4 : slotEdge, b = bx < W / 2 ? W - slotEdge : bx - doorW(bs) / 2 - 4;
          windowRow(a, b, rowY[0], 1, style, items);
        }
      } else windowRow(slotEdge, W - slotEdge, rowY[0], rnd.int(1, 3), style, items);
      upperRows(items, slotEdge, W - slotEdge, style, 2);
      topWin(items, W);
      const bt = bottomTabs(P.cutDoor ? spans : []);
      parts.push({ id: names.B[0], name: names.B[1], ...decorate(gRing, items, { pattern: res.wallPattern, slots: gSlots, tabs: [...gTabs, ...bt.geoms], divider: gDivider }), baseTabXs: bt.xs, kind: 'flat' });
    }

    // ---- walls L and R
    const wTabs = J ? wallTabY.flatMap(([y0, y1]) => [G(rect(-tabP, y0, 0.05, y1)), G(rect(Lw - 0.05, y0, Lw + tabP, y1))]) : [];
    const sideDoorWall = !side && res.extraDoor === 'zijdeur' ? rnd.int(0, 1) : -1;
    let counter = null;
    for (let s = 0; s < 2; s++) {
      const ring = rect(0, 0, Lw, Hw), items = [], style = winStyle();
      const nm = s ? names.R : names.L;
      const ext = shutterW(style, ww);
      const nmax = Math.max(1, Math.floor((Lw - 2 * m) / (ww + 2 * ext + 4)));
      const opts = { pattern: res.wallPattern, tabs: wTabs.slice() };
      if (side && s === 1 && T === 'kraam') {
        // ---- market stall front: serving opening, seller, awning, counter slots
        const gapB = Math.max(0.9, lw * 1.2);
        const ox0 = Math.max(bandW + gapB + 2.2, 4.5), ox1 = Lw - ox0;
        const yb = Math.max(bandW + gapB + t + cl + 1.6, Hw * 0.26);           // counter top (board), below the opening
        const oy0 = yb + 1.6, oy1 = Math.min(Hw * 0.8, Hw - bandW - gapB - 5.2);
        const opening = rect(ox0, oy0, ox1, oy1);
        const awn = [...decorLine(ox0 - 1.5, ox1 + 1.5, oy1 + 2.3, 'schulp', lw), ...decorLine(ox0 - 1.5, ox1 + 1.5, oy1 + 4.0, 'lijn', lw)];
        items.push({ ic: [strokeClosed(offsetRing(opening, lw / 2), lw), ...awn], holes: [G(opening)],
          zone: rect(ox0 - lw * 2.4 - 1.6, oy0 - lw * 2.4, ox1 + lw * 2.4 + 1.6, oy1 + 4.0 + lw + 0.8) });
        // the seller stands in the opening (a figure attached to the opening's bottom edge)
        if (res.seller !== 'geen') {
          const f = makeFigure(res.seller, rnd, lw), fm = cleanMP(f.plate);
          const ys = fm.flatMap(q => q[0].map(v => v[1])), xs = fm.flatMap(q => q[0].map(v => v[0]));
          const fh = Math.max(...ys), fcx = (Math.min(...xs) + Math.max(...xs)) / 2;
          const k = (oy1 - oy0) * 1.08 / (fh * 0.7), sx = (ox0 + ox1) / 2 + rnd.range(-0.15, 0.15) * (ox1 - ox0);
          const dy = oy0 - fh * k * 0.3;                                        // lower 30 % hidden behind the wall
          const xf = g => xfG(g, k, sx - fcx * k, dy);
          const win = G(rect(ox0, oy0 - 0.3, ox1, oy1 - 0.8));
          opts.addPlate = [inter(xf(f.plate), win)];
          opts.extraIcing = [inter(union(f.ic.map(xf)), G(rect(ox0, oy0 + 0.4, ox1, oy1 - 0.8)))];
        }
        const Lc = Math.min(ox1 - ox0 + 4, Lw - 1), bx0 = (ox0 + ox1) / 2 - Lc / 2;
        counter = { yb, bx0, bx1: bx0 + Lc, dc: 8, tabs: [bx0 + 6, bx0 + Lc - 6] };
        opts.slots = counter.tabs.map(tx => slotItem(slotRect(tx - 3, yb - t, tx + 3, yb)));
        res.front = { id: nm[0], x: (ox0 + ox1) / 2, counter: true };
      } else if (side && s === 1) {
        // ---- side-gable house front: door and windows on the long wall
        const cx = frontFacade(items, Lw, m + 2.5, Lw - m - 2.5);
        res.front = { id: nm[0], x: cx };
      } else if (side && s === 0 && T === 'kraam') {
        // ---- market stall back: hearts and a star
        const cy = Hw * 0.55, sz = Math.min(Hw * 0.36, Lw * 0.2);
        for (const fx of [0.3, 0.7]) {
          const hz = heart(Lw * fx, cy - sz * 0.45, sz);
          // outline as an open stroke: it rounds the heart's sharp top and tip instead of folding over
          items.push({ ic: strokeOpen([...hz, hz[0]], lw), holes: [], zone: offsetRing(hz, lw * 1.5) });
        }
        const st = star(Lw / 2, cy, sz * 0.32, sz * 0.14, 5);
        items.push({ ic: [G(st)], holes: [], zone: offsetRing(st, lw * 1.5) });
      } else {
        let x0 = m + 2, x1 = Lw - m - 2;
        const doorHere = side ? res.extraDoor === 'achterdeur' : s === sideDoorWall;
        if (doorHere) {
          const dx = rnd.chance(0.5) ? Lw * 0.25 : Lw * 0.75, ds = rnd.pick(['recht', 'boog', 'staldeur']);
          doorAt(dx, ds, items);
          if (dx < Lw / 2) x0 = dx + doorW(ds) / 2 + 4; else x1 = dx - doorW(ds) / 2 - 4;
        }
        const want = P.windowsPerWall > 0 ? P.windowsPerWall : rnd.int(Math.max(1, nmax - 1), nmax);
        windowRow(x0, x1, rowY[0], doorHere ? Math.max(1, want - 1) : want, style, items);
        for (let f = 1; f < floors; f++) windowRow(m + 2, Lw - m - 2, rowY[f], want, style, items);
      }
      parts.push({ id: nm[0], name: nm[1], ...decorate(ring, items, opts), kind: 'flat' });
    }

    // ---- roof plates (ridge mitred so both halves meet in a vertical plane)
    const parapet = res.gable !== 'zadel';
    const ov = P.overhang;
    const ovD = J && !parapet ? Math.max(ov, slotGap) : ov;  // roof slot stays inside the roof's border
    const Lr = parapet ? D - 2 * t : D + 2 * ovD;
    const S = W / 2 / Math.cos(p) + ov;
    const bev = t * tp;
    const roofPat = rnd.int(1, 1e6), cp = Math.cos(p), sp = Math.sin(p);
    // sign on the ridge (market stall): legs go through notches in both roof halves at the ridge
    let sign = null;
    if (T === 'kraam' && P.sign) {
      const sw = Math.min(Lr * 0.72, 46), sh = Math.max(10, sw * 0.3);
      sign = { sw, sh, dleg: sw * 0.31, legW: 3 };
      sign.dn = (t / 2 + clSign) / cp + 0.05;                 // notch depth along the slope
      // the two notches form a V-shaped hole that is narrowest (t + 2 cl wide) at the roof's underside,
      // a depth of t/cos(p) + dn*sin(p) below the ridge top: the legs reach 0.6 mm past that point
      sign.legLen = t / cp + sign.dn * sp + 0.6;
      sign.ridgeKeep = ridgeKeep;                             // the roof border stays below the notches
    }
    // chimney dimensions first: the right roof gets its slot and a bare (icing-free) footprint
    let chim = null;
    if (P.chimney) {
      const cw = Math.min(Math.max(W * 0.15, 6), 11), cd = cw * 0.9, Hc = cw * tp + rnd.range(6, 10);
      const xMin = (bandW + 1.8 + (sign ? sign.ridgeKeep : 0)) * cp + t * sp + 0.5;   // below the ridge border
      const x1 = Math.max((W / 2) * rnd.range(0.2, 0.45), xMin);
      let yc = rnd.range(-Lr / 2 + cd, Lr / 2 - cd) * 0.6;
      if (sign && Math.abs(yc) < sign.sw / 2 + cd) yc = (sign.sw / 2 + cd) * (yc < 0 ? -1 : 1);   // not under the sign
      const Lt = cw * 0.5;
      chim = { cw, cd, Hc, x1, yc, ua: cw / 2 - Lt / 2, ub: cw / 2 + Lt / 2 };
    }
    // right roof: world x on the outer surface -> roof y (along the slope, from the eave)
    const roofY = xw => S - (xw - t * sp) / cp;
    const roofWin = res.roofWindow;
    for (let s = 0; s < 2; s++) {
      const ring = rect(0, 0, Lr, S), rr = Rnd(roofPat);
      const keepTop = sign ? sign.ridgeKeep : 0;
      const bRing = keepTop ? rect(0, 0, Lr, S - keepTop) : ring;           // border outline (below sign notches)
      const ic = [];
      ic.push(...borderAlong(offsetRing(bRing, -(m + bd)), res.border, lw));
      // snow edge just inside the border, then the roof pattern in the free area above it
      const gap = Math.max(0.9, lw * 1.2), gx = bandW + gap;
      const snow = snowEdge(res.roofEdge, gx, Lr - gx, gx, P.roofEdgeH, rr);
      ic.push(...snow.g);
      const py0 = snow.top ? snow.top + gap : gx, py1 = S - keepTop - gx;
      // noIce: bare plate (sign notches, chimney footprint); patFree: only the pattern stays away (roof window)
      const slots = [], tabs = [], holes = [], noIce = [], patFree = [];
      if (J && !parapet) for (const x0 of [ovD, Lr - ovD - t]) slots.push(slotItem(slotRect(x0, ov + s0, x0 + t, ov + s0 + Lg)));
      if (J && parapet) tabs.push(G(rect(-tabP, ov + s0, 0.05, ov + s0 + Lg)), G(rect(Lr - 0.05, ov + s0, Lr + tabP, ov + s0 + Lg)));
      if (sign) for (const sx of [-1, 1]) {                    // ridge notches for the sign legs
        const cx = Lr / 2 + sx * sign.dleg, hw2 = sign.legW / 2 + clSign;
        holes.push(G(rect(cx - hw2, S - sign.dn, cx + hw2, S + 1)));
        noIce.push(G(rect(cx - hw2 - 0.7, S - sign.dn - 0.7, cx + hw2 + 0.7, S + 1)));
      }
      if (s === 1 && chim) {                                   // chimney: slot for its tab, no icing underneath
        const rx0 = Lr / 2 + chim.yc - chim.cd / 2, rx1 = Lr / 2 + chim.yc + chim.cd / 2;
        noIce.push(G(rect(rx0 - 0.8, roofY(chim.x1 + chim.cw) - 0.8, rx1 + 0.8, roofY(chim.x1) + 0.8)));
        if (J) slots.push(slotItem(slotRect(rx0, roofY(chim.x1 + chim.ub), rx1, roofY(chim.x1 + chim.ua))));
      }
      if (s === 0 && roofWin !== 'geen' && py1 - py0 > 8) {   // roof window on the left roof
        const sz = Math.min((py1 - py0) * 0.45, 10, Lr * 0.2), cx = Lr * rr.range(0.38, 0.62), cy = (py0 + py1) / 2;
        const it = roofWin === 'ster' ? starWindow(cx, cy, sz, lw, P.cutWindows)
          : windowParts(roofWin === 'rond' ? 'rond' : 'kruis', cx, cy, sz, sz, lw, P.cutWindows);
        ic.push(...it.ic); holes.push(...it.holes); patFree.push(G(it.zone));
      }
      if (py1 - py0 > 2) ic.push(diff(union(fillPattern(res.roofPattern, gx, py0, Lr - gx, py1, lw, rr)), union([...noIce, ...patFree])));
      const plateG = diff(G(ring), ...slots.map(q => q.g), ...holes);
      const icing = cleanIcing(diff(inter(union(ic), plateG), union([...slots.map(q => q.zone), ...noIce])));
      const plate = cleanMP(tabs.length ? union([plateG, ...tabs]) : plateG);
      // ridge mitre: the top face reaches bev further than the bottom face at the ridge edge
      const topOf = poly => poly.map(r => r.map(q => (Math.abs(q[1] - S) < 1e-5 ? [q[0], S + bev] : q)));
      parts.push({
        id: s ? '06_roof_right' : '05_roof_left', name: s ? (side ? 'Front roof' : 'Right roof') : (side ? 'Back roof' : 'Left roof'), kind: 'roof',
        plate, icing, check: jointCheck(bRing, slots, [...noIce, ...patFree]),
        bodies: [
          ...plate.map(poly => ({ role: 'plaat', poly, top: topOf(poly), c0: 0, c1: t, M: ID })),
          ...icing.map(poly => ({ role: 'glazuur', poly, c0: t, c1: t + ih, M: ID })),
        ],
      });
    }

    // ---- chimney (a block lying on its side: profile u along roof fall line, v up, thickness = depth)
    if (chim) {
      const { cw, cd, Hc, ua, ub } = chim;
      const prof = ccw([[cw, 0], [cw, Hc], [0, Hc], [0, cw * tp]]);
      const bodyG = union([G(prof), G(rect(-0.8, Hc - 2, cw + 0.8, Hc))]);
      // tab on the slanted bottom, straight into the roof (inward roof normal), through the slot
      let tabG = [];
      if (J) {
        const E = u => [u, (cw - u) * tp], dn = [-sp, -cp];
        const at = (q, k) => [q[0] + dn[0] * k, q[1] + dn[1] * k];
        tabG = G(ccw([at(E(ua), -0.05), at(E(ub), -0.05), at(E(ub), tabP), at(E(ua), tabP)]));
      }
      const ic = [];
      if (res.chimneyPattern !== 'geen') {
        // whole face above the roof line; rows run down behind the slanted bottom (dots only where whole)
        const inner = offsetRing(prof, -0.9);
        const keep = (x, y, r) => pointInRing(inner, x, y) && distToRing(inner, x, y) >= r;
        const x0 = 0.9 + lw / 2, x1 = cw - 0.9 - lw / 2, y0 = 0.9 + lw, y1 = Hc - 2.3 - lw * 1.6;
        if (y1 - y0 > 2) {
          const pat = inter(union(fillPattern(res.chimneyPattern, x0, y0 - 3, x1 + 3, y1, lw, rnd, keep, { frame: false, scale: 0.62 })), G(inner));
          // drop fragments the slanted bottom clipped off: anything under ~40% of a full row (dots are whole via `keep`)
          const minA = res.chimneyPattern === 'stippen' ? 0 : Math.max(lw * lw * 2.6, 0.4 * (x1 - x0) * lw);
          ic.push(cleanMP(pat, minA).map(poly => poly.map(closeR)));
        }
      }
      ic.push(strokeSeg([-0.8, Hc - 2.3], [cw + 0.8, Hc - 2.3], lw * 0.9));
      parts.push({ id: '08_chimney', name: 'Chimney', kind: 'flat', thick: cd,
        plate: cleanMP(tabG.length ? union([bodyG, tabG]) : bodyG), icing: cleanIcing(inter(union(ic), bodyG)) });
    }

    // ---- horizontal board with tabs on its back edge (counter, balcony); local y = toward the wall
    function boardPart(id, name, b, extraSlots, deco) {
      const ring = rect(b.bx0, -b.dc, b.bx1, 0);
      const tabs = J ? b.tabs.map(tx => G(rect(tx - 3, -0.05, tx + 3, tabP))) : [];
      const slots = extraSlots || [];
      const ic = [strokeClosed(offsetRing(ring, -1.2), lw * 0.8)];
      if (deco === 'hartjes') {
        const xs = fitted(b.bx0 + 4, b.bx1 - 4, 5);
        xs.forEach((x, i) => ic.push(G(i % 2 ? star(x, -b.dc / 2, 1.5, 0.65, 5) : heart(x, -b.dc / 2 - 1.1, 2.6))));
      }
      const plateG = diff(G(ring), ...slots.map(q => q.g));
      const icing = cleanIcing(diff(inter(union(ic), plateG), union(slots.map(q => q.zone))));
      parts.push({ id, name, kind: 'flat', plate: cleanMP(union([plateG, ...tabs])), icing });
    }
    if (counter) boardPart('08_counter', 'Counter', counter, [], 'hartjes');
    if (balc) {
      const rSlots = J ? balc.rtabs.map(tx => slotItem(slotRect(tx - 2, -balc.dc + 1.4, tx + 2, -balc.dc + 1.4 + t))) : [];
      boardPart('08_balcony', 'Balcony', balc, rSlots, 'geen');
      // railing: posts with open gaps, tabs into the balcony board
      const L = balc.bx1 - balc.bx0 - 1, hr = 6.5, rx0 = balc.bx0 + 0.5;
      const holes = [];
      for (const x of fitted(1.6, L - 1.6, 2.4)) holes.push(G(rect(x - 0.7, 1.4, x + 0.7, hr - 1.6)));
      const plateG = diff(G(rect(0, 0, L, hr)), ...holes);
      const tabs = J ? balc.rtabs.map(tx => G(rect(tx - rx0 - 2, -tabP, tx - rx0 + 2, 0.05))) : [];
      const ic = [strokeSeg([0.5, hr - 0.75], [L - 0.5, hr - 0.75], lw)];
      parts.push({ id: '08_railing', name: 'Railing', kind: 'flat', plate: cleanMP(union([plateG, ...tabs])), icing: cleanIcing(inter(union(ic), plateG)) });
      balc.rx0 = rx0;
    }
    if (sign) {
      const { sw, sh, dleg, legW, legLen } = sign;
      const body = roundRect(-sw / 2, 0, sw / 2, sh, Math.min(3, sh * 0.25));
      // legs with chamfered tips (0.4 mm) so they find their way into the ridge notches
      const legPoly = (x0, x1) => G([[x0, 0.5], [x0, -legLen + 0.4], [x0 + 0.4, -legLen], [x1 - 0.4, -legLen], [x1, -legLen + 0.4], [x1, 0.5]]);
      const legs = J ? [-1, 1].map(s => legPoly(s * dleg - legW / 2, s * dleg + legW / 2))
        : [-1, 1].map(s => G(rect(s * dleg - legW / 2, -0.01, s * dleg + legW / 2, 0.5)));
      const ic = [strokeClosed(offsetRing(body, -1.3), lw * 0.9)];
      const txt = textRenderer && P.signText ? textRenderer(P.signText, sw - 7, sh - 5.5) : null;
      if (txt && txt.length) ic.push(xfG(txt, 1, 0, sh / 2));
      else for (const x of [-sw * 0.25, 0, sw * 0.25]) ic.push(G(star(x, sh / 2, sh * 0.22, sh * 0.1, 5)));
      const plateG = G(body);
      parts.push({ id: '08_sign', name: 'Sign', kind: 'flat', plate: cleanMP(union([plateG, ...legs])), icing: cleanIcing(inter(union(ic), plateG)) });
    }

    // ---- assembled placement of the building (house frame), then rotation for side-gable types
    const zb = t, c = cp, sn = sp;
    const byId = id => parts.find(q => q.id === id);
    byId(names.A[0]).place = frame([-W / 2, -D / 2 + t, zb], [1, 0, 0], [0, 0, 1], [0, -1, 0]);
    byId(names.B[0]).place = frame([W / 2, D / 2 - t, zb], [-1, 0, 0], [0, 0, 1], [0, 1, 0]);
    byId(names.L[0]).place = frame([-W / 2 + e + t, Lw / 2, zb], [0, -1, 0], [0, 0, 1], [-1, 0, 0]);
    byId(names.R[0]).place = frame([W / 2 - e - t, -Lw / 2, zb], [0, 1, 0], [0, 0, 1], [1, 0, 0]);
    byId('06_roof_right').place = frame([S * c, -Lr / 2, zb + Hp - S * sn], [0, 1, 0], [-c, 0, sn], [sn, 0, c]);
    byId('05_roof_left').place = frame([-S * c, Lr / 2, zb + Hp - S * sn], [0, -1, 0], [c, 0, sn], [-sn, 0, c]);
    if (chim) {
      const zr = x => zb + Hp + t / c - x * tp;
      byId('08_chimney').place = frame([chim.x1, chim.yc + chim.cd / 2, zr(chim.x1 + chim.cw)], [1, 0, 0], [0, 0, 1], [0, -1, 0]);
    }
    if (counter) byId('08_counter').place = frame([W / 2 - e, -Lw / 2, zb + counter.yb - t], [0, 1, 0], [-1, 0, 0], [0, 0, 1]);
    if (balc) {
      byId('08_balcony').place = frame([-W / 2, -D / 2, zb + balc.yb - t], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
      byId('08_railing').place = frame([-W / 2 + balc.rx0, -D / 2 - balc.dc + 1.4 + t, zb + balc.yb], [1, 0, 0], [0, 0, 1], [0, -1, 0]);
    }
    if (sign) byId('08_sign').place = frame([-t / 2, 0, zb + Hp + t / c], [0, 1, 0], [0, 0, 1], [1, 0, 0]);
    const houseParts = parts.slice();
    if (side) {
      const Rz = frame([0, 0, 0], [0, -1, 0], [1, 0, 0], [0, 0, 1]);   // house x -> -y (wall R faces the yard)
      for (const pt of houseParts) pt.place = compose(Rz, pt.place);
    }
    const Fx = side ? D : W, Fy = side ? W : D;                        // footprint in world coordinates
    const toWorld = (id, q) => apply(byId(id).place, q);

    // ---- yard figures: geometry first (their widths drive the yard layout)
    res.figures = [P.fig1, P.fig2, P.fig3, P.fig4].map(v => (v === 'willekeurig' ? rnd.pick(FIGURES) : v)).filter(v => v && v !== 'geen');
    const figs = res.figures.map(type => {
      const f = makeFigure(type, rnd, lw), cm = cleanMP(f.plate);
      const xs = cm.flatMap(poly => poly[0].map(q => q[0]));
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      return Object.assign(f, { type, x0, x1, cx: (x0 + x1) / 2 });
    });
    const mb = 7;
    const treeDims = figs.map(f => {
      const half = Math.max(f.x1 - f.cx, f.cx - f.x0, ...f.tabs.map(tx => Math.abs(tx - f.cx) + f.tabW / 2 + (J ? cl + 1.0 : 0)));
      return { tw: 2 * half };
    });
    const frontW = res.front ? toWorld(res.front.id, [res.front.x, 0, 0]) : [0, 0, 0];
    const doorOff = frontW[0], pathHalf = 3.8, treeGap = 2;
    const edgeM = 1.5 + bandW;                               // figures stay inside the base's border
    function rowLayout(idx) {
      const rel = {};
      let offL = pathHalf + treeGap, offR = pathHalf + treeGap;
      idx.forEach((fi, k) => {
        const w = treeDims[fi].tw + 1;
        const sd = k === 0 ? (doorOff > 0 ? -1 : 1) : (offL <= offR ? -1 : 1);
        if (sd < 0) { rel[fi] = -(offL + w / 2); offL += w + treeGap; } else { rel[fi] = offR + w / 2; offR += w + treeGap; }
      });
      return rel;
    }
    const needBw = rel => Object.keys(rel).reduce((bw, fi) =>
      Math.max(bw, 2 * (edgeM + treeDims[fi].tw / 2 + Math.abs(doorOff + rel[fi]))), Fx + 2 * mb);
    const all = figs.map((_, i) => i);
    let rows = [all], rels = [rowLayout(all)], Bw = needBw(rels[0]);
    if (figs.length >= 2 && Bw > Fx + 2 * mb + 12) {
      const a = [], b = [];
      let wa = 0, wb = 0;
      all.slice().sort((p1, q1) => treeDims[q1].tw - treeDims[p1].tw).forEach(i => { if (wa <= wb) { a.push(i); wa += treeDims[i].tw; } else { b.push(i); wb += treeDims[i].tw; } });
      const r2 = [rowLayout(a), rowLayout(b)], bw2 = Math.max(needBw(r2[0]), needBw(r2[1]));
      if (bw2 < Bw) { rows = [a, b]; rels = r2; Bw = bw2; }
    }
    const treeRow = {}, treeRel = [];
    rows.forEach((row, ri) => row.forEach(fi => { treeRow[fi] = ri; treeRel[fi] = rels[ri][fi]; }));
    // counters stick out of the front wall: the yard starts in front of them
    const stickOut = counter ? Math.max(0, counter.dc - e) : balc ? Math.max(0, balc.dc) : 0;
    const yard = (P.path || figs.length) ? (rows.length > 1 ? 26 : 16) + stickOut : stickOut + (stickOut ? 3 : 0);
    const Bd = Fy + 2 * mb + yard;
    const hx0 = (Bw - Fx) / 2, hy0 = mb + yard;              // footprint origin on the base
    const baseO = [-Bw / 2, -Fy / 2 - hy0];                  // world xy of the base's (0,0)
    const toBase = w => [w[0] - baseO[0], w[1] - baseO[1]];
    {
      const ring = roundRect(0, 0, Bw, Bd, 3);
      const ic = [], zones = [G(rect(hx0 - 0.5, hy0 - 0.5, hx0 + Fx + 0.5, hy0 + Fy + 0.5))];
      // keep icing off the ground under counters/balconies
      for (const id of ['08_counter', '08_balcony']) {
        const pt = byId(id);
        if (!pt) continue;
        const b = id === '08_counter' ? counter : balc;
        const cs = [[b.bx0, -b.dc, 0], [b.bx1, -b.dc, 0], [b.bx1, 0, 0], [b.bx0, 0, 0]].map(q => toBase(apply(pt.place, q)));
        zones.push(G(rect(Math.min(...cs.map(q => q[0])) - 0.5, Math.min(...cs.map(q => q[1])) - 0.5, Math.max(...cs.map(q => q[0])) + 0.5, Math.max(...cs.map(q => q[1])) + 0.5)));
      }
      ic.push(union(borderAlong(offsetRing(ring, -(m + bd)), res.border, lw)));
      const pathX = toBase(frontW)[0];
      if (P.path && res.front) {
        const pathEnd = hy0 - stickOut - 1.6;
        let y = m + 2 * bd + 2.6, k = 0;
        while (y < pathEnd) {
          const r = rnd.range(1.3, 1.9);
          ic.push(G(ellipse(pathX + (k % 2 ? 1 : -1) * rnd.range(0.4, 1.2), y, r * 1.25, r * 0.85, rnd.range(-0.3, 0.3))));
          zones.push(G(circle(pathX, y, r * 2)));
          y += r * 2 + 0.9; k++;
        }
      }
      // figure rows in the front yard; slots kept clear of the base border
      const ty0 = Math.max(rows.length > 1 ? m + 6 : (yard - stickOut) * 0.5 + m, t + cl + 1.0 + bandW + 0.3);
      res.treeSpots = treeRel.map((r, i) => [pathX + r, ty0 + treeRow[i] * 10]);
      res.treeSpots.forEach((s, i) => zones.push(G(rect(s[0] - treeDims[i].tw / 2 - 0.5, s[1] - 2, s[0] + treeDims[i].tw / 2 + 0.5, s[1] + 2))));
      if (J) {
        // gable bottom tabs: slot = the tab's footprint on the base, from its real position
        for (const id of [names.A[0], names.B[0]]) for (const [a, b] of byId(id).baseTabXs || []) {
          const cs = [[a, -tabP, 0], [b, -tabP, 0], [a, -tabP, t], [b, -tabP, t]].map(q => toBase(toWorld(id, q)));
          const xs = cs.map(q => q[0]), ys = cs.map(q => q[1]);
          baseSlots.push(slotItem(slotRect(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys))));
        }
        res.treeSpots.forEach((s, i) => {
          const f = figs[i], ox = s[0] - f.cx;
          for (const tx of f.tabs) baseSlots.push(slotItem(slotRect(ox + tx - f.tabW / 2, s[1] - t, ox + tx + f.tabW / 2, s[1])));
        });
        zones.push(...baseSlots.map(q => q.zone));
      }
      if (P.baseSnow) {
        // whole snow dots only, clear of everything and spaced apart so they never clump
        const innerRing = offsetRing(ring, -(bandW + Math.max(0.9, lw * 1.2)));
        const zoneRings = union(zones).map(poly => poly[0]);
        const placed = [];
        for (let i = 0; i < Bw * Bd / 14; i++) {
          const x = rnd.range(0, Bw), y = rnd.range(0, Bd), r = rnd.range(0.6, 1.0);
          if (!pointInRing(innerRing, x, y) || distToRing(innerRing, x, y) < r) continue;
          if (zoneRings.some(z => pointInRing(z, x, y) || distToRing(z, x, y) < r + 0.4)) continue;
          if (placed.some(q => Math.hypot(q[0] - x, q[1] - y) < q[2] + r + 1.6)) continue;
          placed.push([x, y, r]);
        }
        ic.push(union(placed.map(q => G(circle(q[0], q[1], q[2])))));
      }
      const plateG = diff(G(ring), ...baseSlots.map(q => q.g));
      const icing = diff(inter(union(ic), plateG), union(baseSlots.map(q => q.zone)));
      parts.push({ id: '07_base', name: 'Base plate', kind: 'flat', plate: cleanMP(plateG), icing: cleanIcing(icing), check: jointCheck(ring, baseSlots), place: frame([baseO[0], baseO[1], 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]) });
    }
    // ---- yard figures (tabs stay bare; numbered when a type repeats)
    const seen = {};
    figs.forEach((f, i) => {
      const tabs = J ? f.tabs.map(tx => G(rect(tx - f.tabW / 2, -tabP, tx + f.tabW / 2, 0.5))) : [];
      const icing = cleanIcing(inter(union(f.ic), f.plate));
      const total = res.figures.filter(v => v === f.type).length;
      seen[f.type] = (seen[f.type] || 0) + 1;
      const nm = FIGURE_NAMES[f.type] + (total > 1 ? ' ' + seen[f.type] : '');
      const id = `${String(9 + i).padStart(2, '0')}_${FIGURE_SLUGS[f.type]}${total > 1 ? '_' + seen[f.type] : ''}`;
      const s = res.treeSpots[i];
      parts.push({ id, name: nm, kind: 'flat', plate: cleanMP(union([f.plate, ...tabs])), icing,
        place: frame([baseO[0] + s[0] - f.cx, baseO[1] + s[1], zb], [1, 0, 0], [0, 0, 1], [0, -1, 0]) });
    });

    // ---- bodies for flat parts
    for (const pt of parts) {
      if (pt.bodies) continue;
      const th = pt.thick || t;
      pt.bodies = [
        ...pt.plate.map(poly => ({ role: 'plaat', poly, c0: 0, c1: th, M: ID })),
        ...pt.icing.map(poly => ({ role: 'glazuur', poly, c0: th, c1: th + ih, M: ID })),
      ];
    }
    // ---- bounding boxes (part-local, for layout and 2D export)
    for (const pt of parts) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const b of pt.bodies) for (const [rings, cc] of [[b.poly, b.c0], [b.top || b.poly, b.c1]])
        for (const ring of rings) for (const q of ring) {
          const v = apply(b.M, [q[0], q[1], cc]);
          x0 = Math.min(x0, v[0]); y0 = Math.min(y0, v[1]); x1 = Math.max(x1, v[0]); y1 = Math.max(y1, v[1]);
        }
      pt.bbox = [x0, y0, x1, y1];
    }
    return { params: P, resolved: res, parts, dims: { W, D, H, Hp, S, Lr, Lw, Bw, Bd, Fx, Fy } };
  }

  // ------------------------------------------------------------------ print layout (shelf packing)
  function layout(parts, bed) {
    const gap = 4, order = parts.slice().sort((a, b) => (b.bbox[3] - b.bbox[1]) - (a.bbox[3] - a.bbox[1]));
    let x = 0, y = 0, rowH = 0, maxW = 0;
    const width = Math.max(bed || 220, ...parts.map(q => q.bbox[2] - q.bbox[0]));
    const out = {};
    for (const pt of order) {
      const w = pt.bbox[2] - pt.bbox[0], h = pt.bbox[3] - pt.bbox[1];
      if (x > 0 && x + w > width) { x = 0; y += rowH + gap; rowH = 0; }
      out[pt.id] = frame([x - pt.bbox[0], y - pt.bbox[1], 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
      x += w + gap; rowH = Math.max(rowH, h); maxW = Math.max(maxW, x - gap);
    }
    return { frames: out, size: [maxW, y + rowH] };
  }

  // ------------------------------------------------------------------ meshing
  // earcut on a polygon with holes -> counter-clockwise index triples into the flattened vertex list
  function triangulate(poly) {
    const flat = [], holes = [];
    poly.forEach((ring, i) => { if (i) holes.push(flat.length / 2); for (const q of ring) flat.push(q[0], q[1]); });
    const idx = earcut(flat, holes.length ? holes : null, 2);
    const X = i => flat[2 * i], Y = i => flat[2 * i + 1];
    const cross = (a, b, c) => (X(b) - X(a)) * (Y(c) - Y(a)) - (Y(b) - Y(a)) * (X(c) - X(a));
    let tris = [];
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], cc = idx[i + 2];
      tris.push(cross(a, b, cc) >= 0 ? [a, b, cc] : [a, cc, b]);
    }
    // earcut may lay a triangle edge straight across other ring vertices (collinear slot edges).
    // Those T-junctions make the STL non-manifold: split every edge at any vertex lying on it.
    const nV = flat.length / 2, out = [];
    const onEdge = (p, q) => {
      const x0 = Math.min(X(p), X(q)) - 1e-9, x1 = Math.max(X(p), X(q)) + 1e-9, y0 = Math.min(Y(p), Y(q)) - 1e-9, y1 = Math.max(Y(p), Y(q)) + 1e-9;
      const L = Math.hypot(X(q) - X(p), Y(q) - Y(p));
      for (let v = 0; v < nV; v++) {
        if (v === p || v === q || X(v) < x0 || X(v) > x1 || Y(v) < y0 || Y(v) > y1) continue;
        if (Math.abs(cross(p, q, v)) / L > 1e-6) continue;
        const sameP = Math.abs(X(v) - X(p)) < 1e-9 && Math.abs(Y(v) - Y(p)) < 1e-9, sameQ = Math.abs(X(v) - X(q)) < 1e-9 && Math.abs(Y(v) - Y(q)) < 1e-9;
        if (!sameP && !sameQ) return v;
      }
      return -1;
    };
    const stack = tris.slice();
    let guard = 0;
    while (stack.length && guard++ < 200000) {
      const t = stack.pop();
      let split = false;
      for (let k = 0; k < 3 && !split; k++) {
        const p = t[k], q = t[(k + 1) % 3], o = t[(k + 2) % 3], v = onEdge(p, q);
        if (v < 0) continue;
        split = true;
        if (v !== o) stack.push([p, v, o], [v, q, o]);   // keeps counter-clockwise order
      }
      if (!split && Math.abs(cross(t[0], t[1], t[2])) > 1e-12) out.push(t);
    }
    return out;
  }
  const flatOf = rings => rings.flat();
  // returns {plaat: number[], glazuur: number[]} flat xyz triangle lists
  function meshPart(part, F) {
    F = F || ID;
    const out = { plaat: [], glazuur: [] };
    for (const b of part.bodies) {
      const arr = out[b.role], T = q => apply(F, apply(b.M, q));
      const push = (...v) => { for (const q of v) { const w = T(q); arr.push(w[0], w[1], w[2]); } };
      const top = b.top || b.poly, vb = flatOf(b.poly), vt = flatOf(top);
      for (const [a, bb, cc] of triangulate(b.poly)) {
        push([vt[a][0], vt[a][1], b.c1], [vt[bb][0], vt[bb][1], b.c1], [vt[cc][0], vt[cc][1], b.c1]);
        push([vb[a][0], vb[a][1], b.c0], [vb[cc][0], vb[cc][1], b.c0], [vb[bb][0], vb[bb][1], b.c0]);
      }
      b.poly.forEach((ring, ri) => {
        const tr = top[ri];
        for (let i = 0; i < ring.length; i++) {
          const j = (i + 1) % ring.length, q = ring[i], r = ring[j], qt = tr[i], rt = tr[j];
          push([q[0], q[1], b.c0], [r[0], r[1], b.c0], [rt[0], rt[1], b.c1]);
          push([q[0], q[1], b.c0], [rt[0], rt[1], b.c1], [qt[0], qt[1], b.c1]);
        }
      });
    }
    return out;
  }

  // ------------------------------------------------------------------ exporters
  function toSTL(triLists, name) {
    let n = 0;
    for (const l of triLists) n += l.length / 9;
    const buf = new ArrayBuffer(84 + 50 * n), dv = new DataView(buf);
    const head = ('gingerbread ' + (name || '')).slice(0, 79);
    for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i) & 0x7f);
    dv.setUint32(80, n, true);
    let o = 84;
    for (const l of triLists) for (let i = 0; i < l.length; i += 9) {
      const ux = l[i + 3] - l[i], uy = l[i + 4] - l[i + 1], uz = l[i + 5] - l[i + 2];
      const vx = l[i + 6] - l[i], vy = l[i + 7] - l[i + 1], vz = l[i + 8] - l[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const L = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / L, true); dv.setFloat32(o + 4, ny / L, true); dv.setFloat32(o + 8, nz / L, true); o += 12;
      for (let k = 0; k < 9; k++) { dv.setFloat32(o, l[i + k], true); o += 4; }
      dv.setUint16(o, 0, true); o += 2;
    }
    return buf;
  }

  // AP214 STEP with exact planar B-rep solids: one solid per plate/icing island
  function toSTEP(part, F) {
    F = F || ID;
    const L = [];
    let id = 0;
    const E = s => { id++; L.push('#' + id + '=' + s + ';'); return '#' + id; };
    const f = v => { const x = Math.abs(v) < 5e-7 ? 0 : v; return x.toFixed(6); };
    const dirE = d => { const l = Math.hypot(d[0], d[1], d[2]) || 1; return E(`DIRECTION('',(${f(d[0] / l)},${f(d[1] / l)},${f(d[2] / l)}))`); };
    const ptE = q => E(`CARTESIAN_POINT('',(${f(q[0])},${f(q[1])},${f(q[2])}))`);
    const esc = s => String(s).replace(/'/g, '');
    const appCtx = E("APPLICATION_CONTEXT('automotive design')");
    E(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${appCtx})`);
    const pCtx = E(`PRODUCT_CONTEXT('',${appCtx},'mechanical')`);
    const prod = E(`PRODUCT('${esc(part.id)}','${esc(part.name)}','',(${pCtx}))`);
    E(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${prod}))`);
    const pdf = E(`PRODUCT_DEFINITION_FORMATION('','',${prod})`);
    const pdCtx = E(`PRODUCT_DEFINITION_CONTEXT('part definition',${appCtx},'design')`);
    const pd = E(`PRODUCT_DEFINITION('design','',${pdf},${pdCtx})`);
    const pds = E(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
    const lenU = E('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))');
    const angU = E('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))');
    const solU = E('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())');
    const unc = E(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),${lenU},'distance_accuracy_value','confusion accuracy')`);
    const ctx = E(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${lenU},${angU},${solU}))REPRESENTATION_CONTEXT('Context3D','3D context'))`);
    const origin = E(`AXIS2_PLACEMENT_3D('',${ptE([0, 0, 0])},${dirE([0, 0, 1])},${dirE([1, 0, 0])})`);
    const items = [origin];
    const plane = (p0, n, rdir) => E(`PLANE('',${E(`AXIS2_PLACEMENT_3D('',${ptE(p0)},${dirE(n)},${dirE(rdir)})`)})`);
    let solidNo = 0;
    for (const b of part.bodies) {
      const T = q => apply(F, apply(b.M, q)), Td = d => applyDir(F, applyDir(b.M, d));
      const faces = [], topLoops = [], botLoops = [], topRings = b.top || b.poly;
      for (const [ri, ring] of b.poly.entries()) {
        const n = ring.length, tRing = topRings[ri];
        const VB = ring.map(q => E(`VERTEX_POINT('',${ptE(T([q[0], q[1], b.c0]))})`));
        const VT = tRing.map(q => E(`VERTEX_POINT('',${ptE(T([q[0], q[1], b.c1]))})`));
        const edge = (va, vb, pa, pb) => {
          const d = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], len = Math.hypot(...d);
          const line = E(`LINE('',${ptE(pa)},${E(`VECTOR('',${dirE(d)},${f(len)})`)})`);
          return E(`EDGE_CURVE('',${va},${vb},${line},.T.)`);
        };
        const P3 = (q, z) => T([q[0], q[1], z]);
        const eb = [], et = [], ev = [];
        for (let i = 0; i < n; i++) {
          const q = ring[i], r = ring[(i + 1) % n], qt = tRing[i], rt = tRing[(i + 1) % n];
          eb.push(edge(VB[i], VB[(i + 1) % n], P3(q, b.c0), P3(r, b.c0)));
          et.push(edge(VT[i], VT[(i + 1) % n], P3(qt, b.c1), P3(rt, b.c1)));
          ev.push(edge(VB[i], VT[i], P3(q, b.c0), P3(qt, b.c1)));
        }
        const oe = (e, s) => E(`ORIENTED_EDGE('',*,*,${e},${s ? '.T.' : '.F.'})`);
        topLoops.push({ outer: ri === 0, loop: E(`EDGE_LOOP('',(${et.map(e => oe(e, true)).join(',')}))`) });
        botLoops.push({ outer: ri === 0, loop: E(`EDGE_LOOP('',(${eb.slice().reverse().map(e => oe(e, false)).join(',')}))`) });
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n, q = ring[i], r = ring[j];
          // outward normal of the (planar) side quad via Newell's method
          const Q = [P3(q, b.c0), P3(r, b.c0), P3(tRing[j], b.c1), P3(tRing[i], b.c1)], nn = [0, 0, 0];
          for (let k = 0; k < 4; k++) {
            const a = Q[k], c2 = Q[(k + 1) % 4];
            nn[0] += (a[1] - c2[1]) * (a[2] + c2[2]); nn[1] += (a[2] - c2[2]) * (a[0] + c2[0]); nn[2] += (a[0] - c2[0]) * (a[1] + c2[1]);
          }
          const loop = E(`EDGE_LOOP('',(${oe(eb[i], true)},${oe(ev[j], true)},${oe(et[i], false)},${oe(ev[i], false)}))`);
          const pl = plane(Q[0], nn, [Q[1][0] - Q[0][0], Q[1][1] - Q[0][1], Q[1][2] - Q[0][2]]);
          faces.push(E(`ADVANCED_FACE('',(${E(`FACE_OUTER_BOUND('',${loop},.T.)`)}),${pl},.T.)`));
        }
      }
      const q0 = b.poly[0][0], qt0 = topRings[0][0];
      const bound = l => E(`${l.outer ? 'FACE_OUTER_BOUND' : 'FACE_BOUND'}('',${l.loop},.T.)`);
      faces.push(E(`ADVANCED_FACE('',(${topLoops.map(bound).join(',')}),${plane(T([qt0[0], qt0[1], b.c1]), Td([0, 0, 1]), Td([1, 0, 0]))},.T.)`));
      faces.push(E(`ADVANCED_FACE('',(${botLoops.map(bound).join(',')}),${plane(T([q0[0], q0[1], b.c0]), Td([0, 0, -1]), Td([1, 0, 0]))},.T.)`));
      const shell = E(`CLOSED_SHELL('',(${faces.join(',')}))`);
      items.push(E(`MANIFOLD_SOLID_BREP('${b.role}_${++solidNo}',${shell})`));
    }
    const rep = E(`ADVANCED_BREP_SHAPE_REPRESENTATION('${esc(part.name)}',(${items.join(',')}),${ctx})`);
    E(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);
    const now = new Date().toISOString().slice(0, 19);
    return ['ISO-10303-21;', 'HEADER;', "FILE_DESCRIPTION(('Gingerbread house part'),'2;1');",
      `FILE_NAME('${esc(part.id)}.step','${now}',(''),(''),'gingerbread house builder','','');`,
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));", 'ENDSEC;', 'DATA;', ...L, 'ENDSEC;', 'END-ISO-10303-21;', ''].join('\n');
  }

  // 2D sketch in R12 DXF: layer PLATE (outline + openings) and ICING
  function toDXF(part) {
    const o = [];
    const w = (c, v) => o.push(String(c), String(v));
    w(0, 'SECTION'); w(2, 'HEADER'); w(9, '$ACADVER'); w(1, 'AC1009'); w(9, '$INSUNITS'); w(70, 4); w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'TABLES'); w(0, 'TABLE'); w(2, 'LAYER'); w(70, 2);
    for (const [n, col] of [['PLATE', 30], ['ICING', 7]]) { w(0, 'LAYER'); w(2, n); w(70, 0); w(62, col); w(6, 'CONTINUOUS'); }
    w(0, 'ENDTAB'); w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'ENTITIES');
    const poly = (layer, ring) => {
      w(0, 'POLYLINE'); w(8, layer); w(66, 1); w(10, 0); w(20, 0); w(30, 0); w(70, 1);
      for (const q of ring) { w(0, 'VERTEX'); w(8, layer); w(10, q[0].toFixed(4)); w(20, q[1].toFixed(4)); w(30, 0); }
      w(0, 'SEQEND'); w(8, layer);
    };
    for (const p of part.plate) for (const r of p) poly('PLATE', r);
    for (const p of part.icing) for (const r of p) poly('ICING', r);
    w(0, 'ENDSEC'); w(0, 'EOF');
    return o.join('\n') + '\n';
  }

  function svgPath(mp, flipY) {
    let d = '';
    for (const p of mp) for (const r of p) {
      d += 'M' + r.map(q => q[0].toFixed(3) + ' ' + (flipY - q[1]).toFixed(3)).join('L') + 'Z';
    }
    return d;
  }
  function toSVG(part, colors) {
    colors = colors || { plaat: '#b8692e', glazuur: '#ffffff', rand: '#6b3a17' };
    const xs = [], ys = [];
    for (const p of part.plate) for (const r of p) for (const q of r) { xs.push(q[0]); ys.push(q[1]); }
    const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, y0 = Math.min(...ys) - 1, y1 = Math.max(...ys) + 1;
    const w = x1 - x0, h = y1 - y0;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(2)}mm" height="${h.toFixed(2)}mm" viewBox="${x0.toFixed(3)} ${(-1).toFixed(3)} ${w.toFixed(3)} ${h.toFixed(3)}">` +
      `<g id="plate"><path fill="${colors.plaat}" fill-rule="evenodd" stroke="${colors.rand}" stroke-width="0.15" d="${svgPath(part.plate, y1 - 1)}"/></g>` +
      `<g id="icing"><path fill="${colors.glazuur}" fill-rule="evenodd" d="${svgPath(part.icing, y1 - 1)}"/></g></svg>`;
  }

  return { DEFAULTS, CHOICES, FIGURES, FIGURE_NAMES, TYPES, setTextRenderer, randomParams, build, layout, meshPart, toSTL, toSTEP, toDXF, toSVG, apply, frame, ID };
});
