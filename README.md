# Gingerbread House Builder

Design 3D-printable gingerbread houses in the browser and download every part as **STEP, STL, DXF and SVG**.

**Live:** https://jasperdejonghe.github.io/gingerbread-house-builder/

Each part is a flat plate (the gingerbread) with raised icing on top, so it prints in two colours with one filament change. The parts slot together with tabs and slots, so you don't need glue.

## What you can make

- **Building types:** cottage, side-gable house, Glühwein stall (serving opening, seller, counter and a sign with your own text), tower, barn, chalet (balcony with railing)
- **Shape:** gable roof, stepped gable or bell gable; width, length, wall height, roof pitch, overhang, 1–3 floors
- **Doors and windows:** several door and window styles, a star, heart, clock or hay hatch in the gable top, a roof window, optional cut-outs for a tea light
- **Icing:** roof patterns, snow edges, borders, gable dividers, wall patterns, chimney patterns
- **Garden:** up to four figures (tree, snowman, gingerbread man, candy cane, street lamp, fence), a path, snow
- **Joints:** tabs and slots with adjustable play (0.1 mm per side by default, 0.25 mm for the sign on the ridge)

The interface is available in English and Dutch (switch in the top bar). **Surprise me** rolls a whole new building and **New variation** keeps your settings but changes the details. The seed makes every design reproducible. **Save settings** / **Load settings** store a design as `settings.json`.

## 3D print or laser cut

The switch in the top bar picks how you'll make the house:

- **3D print:** a gingerbread plate with raised icing, printed in two colours with one filament change.
- **Laser cut:**
  - Parts are cut from sheet material (thickness adjustable, 3 mm by default). The tabs and slots are sized for that sheet.
  - The icing becomes an engraving.
  - The roof halves meet square at the ridge, because a laser can't cut a bevel.
  - The chimney is left out, because it's a solid block.
  - The preview shows the wood with laser-burnt edges.
  - The zip contains a LightBurn-ready `laser_sheet.svg` / `laser_sheet.dxf` with every part laid out on a bed of your chosen width. Red hairlines are cuts and black filled shapes are engravings. In the DXF these are layers `CUT` (colour 1) and `ENGRAVE` (colour 7). In LightBurn, set the red layer to Line with a kerf offset, and the black layer to Fill.

## Downloads

In 3D-print mode, **Download everything** gives one zip with:

| Folder / file | Contents |
|---|---|
| `step/` | Exact planar B-rep solids, with plate and icing as separate bodies |
| `stl/` | One printable mesh per part |
| `dxf/` | 2D sketches with layers `PLATE` and `ICING` (Fusion: Insert DXF → one sketch per layer) |
| `svg/` | The same outlines as SVG |
| `print_plate.stl` | All parts laid out flat |
| `assembled.stl` | The building put together |
| `settings.json` | All settings, to load back into the builder |

## How it works

Everything runs in the browser, with no build step and no server.

- `gen.js` holds all the geometry: parts, icing patterns, joints, and the STEP/STL/DXF/SVG writers. It works in the browser (`window.GB`) and in Node.
- `index.html` is the interface: the controls, a three.js preview, zip export, and sign text traced from a script font on a canvas.
- Libraries are loaded from CDNs: [polygon-clipping](https://github.com/mfogel/polygon-clipping), [earcut](https://github.com/mapbox/earcut), [three.js](https://threejs.org/) and [JSZip](https://stuk.github.io/jszip/).

To run it locally, serve the folder with any static file server:

```
python -m http.server 8000
```

## Tests

`test/run.js` builds random houses of every type in Node. It writes all exports and checks that the joints never cut through the icing border and that there are no unprintable icing specks:

```
npm install
node test/run.js test/out 24
```

The Python checks need `cadquery`, `trimesh` and `manifold3d`:

- `test/validate.py test/out` opens every STEP file with OpenCascade and checks validity and volume.
- `test/fit.py test/out` assembles each house and checks that no two parts overlap, so every tab sits in its slot.
- `test/meshcheck.py <folder>` checks that STL meshes are closed.
